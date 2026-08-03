import {
  store,
  api,
  API_BASE,
  calculateSession,
  currentMachineSession,
  getMachine,
  localDateKey
} from './core.js';

const PERFORMANCE_VERSION = 1;
const SYNC_DELAY_MS = 900;
let enrichmentScheduled = false;
let enriching = false;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseLocaleNumber(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  if (!normalized) return NaN;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

export function calculateShiftPerformance({ pieces, cycleSeconds, availableMinutes, target }) {
  const produced = finite(pieces, NaN);
  const cycle = finite(cycleSeconds, NaN);
  const available = finite(availableMinutes, NaN);
  const plannedTarget = finite(target, NaN);

  if (![produced, cycle, available, plannedTarget].every(Number.isFinite) || produced < 0 || cycle <= 0 || available <= 0 || plannedTarget <= 0) {
    return {
      valid: false,
      produced,
      target: plannedTarget,
      productiveSeconds: NaN,
      stoppageSeconds: NaN,
      differencePieces: NaN,
      performancePercent: NaN,
      targetReached: false,
      status: 'unknown',
      label: 'Dados insuficientes'
    };
  }

  const productiveSeconds = produced * cycle;
  const availableSeconds = available * 60;
  const stoppageSeconds = Math.max(0, availableSeconds - productiveSeconds);
  const differencePieces = produced - plannedTarget;
  const performancePercent = produced / plannedTarget * 100;
  const targetReached = produced >= plannedTarget;

  return {
    valid: true,
    produced,
    target: plannedTarget,
    availableMinutes: available,
    productiveSeconds,
    stoppageSeconds,
    differencePieces,
    performancePercent,
    targetReached,
    status: targetReached ? 'above-target' : 'below-target',
    label: targetReached
      ? produced > plannedTarget ? 'Acima da meta' : 'Meta atingida'
      : 'Abaixo da meta'
  };
}

function performanceForSession(session, pieces) {
  const calculation = calculateSession(session);
  return calculateShiftPerformance({
    pieces,
    cycleSeconds: session?.cycleSeconds,
    availableMinutes: session?.availableMinutes || 480,
    target: calculation.target
  });
}

function performanceForRecord(record) {
  if (!record) return calculateShiftPerformance({});
  return calculateShiftPerformance({
    pieces: record.producedThisShift ?? record.finalProduction,
    cycleSeconds: record.cycleTimeSeconds,
    availableMinutes: record.availableMinutes || 480,
    target: record.target
  });
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  return `${hours}h ${String(minutes).padStart(2, '0')}min`;
}

function formatPieces(value, decimals = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('pt-BR', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0
  });
}

function performanceMarkup(performance, compact = false) {
  if (!performance.valid) {
    return `<section class="shift-performance-card is-empty" aria-live="polite">
      <div><strong>Desempenho do turno</strong><span>Informe a produção para calcular o tempo de parada.</span></div>
    </section>`;
  }

  const tone = performance.targetReached ? 'success' : 'danger';
  const difference = performance.differencePieces >= 0
    ? `+${formatPieces(performance.differencePieces, 1)}`
    : formatPieces(performance.differencePieces, 1);

  return `<section class="shift-performance-card${compact ? ' is-compact' : ''}" data-tone="${tone}" aria-label="${performance.label}">
    <header>
      <div><span>Desempenho do turno</span><strong>${performance.label}</strong></div>
      <b aria-hidden="true">${performance.targetReached ? '✓' : '!'}</b>
    </header>
    <dl>
      <div><dt>Tempo produtivo</dt><dd>${formatDuration(performance.productiveSeconds)}</dd></div>
      <div class="shift-performance-card__stoppage"><dt>Tempo de parada</dt><dd>${formatDuration(performance.stoppageSeconds)}</dd></div>
      <div><dt>Produção / Meta</dt><dd>${formatPieces(performance.produced)} / ${formatPieces(performance.target, 1)}</dd></div>
      <div><dt>Diferença</dt><dd>${difference} peça${Math.abs(performance.differencePieces) === 1 ? '' : 's'}</dd></div>
    </dl>
    <p>${formatPieces(performance.performancePercent, 1)}% da meta planejada</p>
  </section>`;
}

function hasPointing(machineId) {
  const machineSession = currentMachineSession(machineId);
  if (['pointed', 'closed'].includes(machineSession?.status)) return true;
  const operatorSession = store.state.session;
  if (!operatorSession) return false;
  return store.state.records.some(record =>
    record.status !== 'cancelled' &&
    record.machineId === machineId &&
    String(record.productionDate || '') === String(operatorSession.productionDate || localDateKey()) &&
    String(record.shift || '') === String(operatorSession.shift) &&
    ['shift-pointing', 'order-close'].includes(record.eventType)
  );
}

function eligibleMachines() {
  return store.state.assignments.filter(item => currentMachineSession(item.machineId) && !hasPointing(item.machineId));
}

function updateEntryPreview(row, input) {
  const machineId = input.dataset.batchPieces;
  const session = currentMachineSession(machineId);
  if (!session) return;
  let mount = row.querySelector('[data-shift-performance-preview]');
  if (!mount) {
    mount = document.createElement('div');
    mount.dataset.shiftPerformancePreview = machineId;
    const details = row.querySelector('details');
    if (details) details.insertAdjacentElement('beforebegin', mount);
    else row.appendChild(mount);
  }
  const pieces = parseLocaleNumber(input.value);
  mount.innerHTML = performanceMarkup(performanceForSession(session, pieces), true);
}

function enhanceBatchEntry(root) {
  for (const row of root.querySelectorAll('.ops-batch-row')) {
    const input = row.querySelector('[data-batch-pieces]');
    if (!input) continue;
    if (!input.dataset.performanceBound) {
      input.dataset.performanceBound = 'true';
      input.addEventListener('input', () => updateEntryPreview(row, input));
      input.addEventListener('change', () => updateEntryPreview(row, input));
    }
    updateEntryPreview(row, input);
  }
}

function enhanceBatchReview(root) {
  const eligible = eligibleMachines();
  const articles = root.querySelectorAll('.ops-batch-review > article');
  articles.forEach((article, index) => {
    if (article.querySelector('[data-shift-performance-review]')) return;
    const machineId = eligible[index]?.machineId;
    const session = currentMachineSession(machineId);
    const productionText = article.querySelector('.ops-review dd')?.textContent || '';
    const pieces = parseLocaleNumber(productionText);
    if (!session) return;
    const mount = document.createElement('div');
    mount.dataset.shiftPerformanceReview = machineId;
    mount.innerHTML = performanceMarkup(performanceForSession(session, pieces));
    article.appendChild(mount);
  });
}

function latestCurrentShiftRecord(machineId) {
  const operatorSession = store.state.session;
  if (!operatorSession) return null;
  return store.state.records
    .filter(record =>
      record.status !== 'cancelled' &&
      record.machineId === machineId &&
      String(record.productionDate || '') === String(operatorSession.productionDate || localDateKey()) &&
      String(record.shift || '') === String(operatorSession.shift) &&
      ['shift-pointing', 'order-close'].includes(record.eventType)
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function enhanceMachineCards(root) {
  const cards = root.querySelectorAll('.ops-machine-list > .ops-machine-card');
  cards.forEach((card, index) => {
    if (card.querySelector('[data-shift-performance-machine]')) return;
    const machineId = store.state.assignments[index]?.machineId;
    const record = latestCurrentShiftRecord(machineId);
    if (!record) return;
    const performance = performanceForRecord(record);
    if (!performance.valid) return;
    const mount = document.createElement('div');
    mount.className = 'shift-performance-machine';
    mount.dataset.shiftPerformanceMachine = machineId;
    mount.dataset.tone = performance.targetReached ? 'success' : 'danger';
    mount.innerHTML = `<span>${performance.targetReached ? '✓' : '!'} ${performance.label}</span><strong>Parada: ${formatDuration(performance.stoppageSeconds)}</strong>`;
    const footer = card.querySelector('.ops-machine-card__actions');
    if (footer) footer.insertAdjacentElement('beforebegin', mount);
    else card.appendChild(mount);
  });
}

function historyPeriodRecords() {
  const period = store.state.ui?.historyPeriod || 'today';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return store.state.records
    .filter(record => record.status !== 'cancelled')
    .filter(record => {
      const date = new Date(record.createdAt || `${record.productionDate}T12:00:00`);
      if (period === 'all') return true;
      if (period === 'month') return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      if (period === '7d') return date >= new Date(startToday.getTime() - 6 * 86400000);
      return String(record.productionDate || '') === localDateKey();
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function enhanceHistory(root) {
  const records = historyPeriodRecords();
  root.querySelectorAll('.ops-history-item').forEach((article, index) => {
    if (article.querySelector('[data-shift-performance-history]')) return;
    const record = records[index];
    if (!record || !['shift-pointing', 'order-close'].includes(record.eventType)) return;
    const performance = performanceForRecord(record);
    if (!performance.valid) return;
    const mount = document.createElement('div');
    mount.className = 'shift-performance-history';
    mount.dataset.shiftPerformanceHistory = record.id;
    mount.dataset.tone = performance.targetReached ? 'success' : 'danger';
    mount.innerHTML = `<span>${performance.label}</span><strong>Tempo parado: ${formatDuration(performance.stoppageSeconds)}</strong><small>${formatPieces(performance.performancePercent, 1)}% da meta</small>`;
    article.appendChild(mount);
  });
}

function enhanceInterface() {
  const layers = document.getElementById('layers');
  const app = document.getElementById('app');
  if (layers) {
    enhanceBatchEntry(layers);
    enhanceBatchReview(layers);
  }
  if (app) {
    enhanceMachineCards(app);
    enhanceHistory(app);
  }
}

function enrichedRecord(record) {
  const performance = performanceForRecord(record);
  if (!performance.valid) return null;
  return {
    ...record,
    updatedAt: new Date().toISOString(),
    productiveTimeSeconds: Math.round(performance.productiveSeconds),
    productiveTimeMinutes: Number((performance.productiveSeconds / 60).toFixed(2)),
    stoppageTimeSeconds: Math.round(performance.stoppageSeconds),
    stoppageTimeMinutes: Number((performance.stoppageSeconds / 60).toFixed(2)),
    targetReached: performance.targetReached,
    performanceStatus: performance.status,
    performanceLabel: performance.label,
    performancePercent: Number(performance.performancePercent.toFixed(2)),
    differenceToTarget: Number(performance.differencePieces.toFixed(2)),
    performanceVersion: PERFORMANCE_VERSION,
    performanceCalculatedAt: new Date().toISOString()
  };
}

function scheduleCloudUpdate(records) {
  if (!API_BASE || !records.length) return;
  window.setTimeout(() => {
    records.forEach(record => {
      api.post('/api/v1/records', record).catch(() => {});
    });
  }, SYNC_DELAY_MS);
}

function enrichPointingRecords() {
  if (enriching) return;
  enriching = true;
  const updates = new Map();
  for (const record of store.state.records) {
    if (!['shift-pointing', 'order-close'].includes(record.eventType)) continue;
    if (record.performanceVersion === PERFORMANCE_VERSION) continue;
    const enriched = enrichedRecord(record);
    if (enriched) updates.set(record.id, enriched);
  }

  if (!updates.size) {
    enriching = false;
    return;
  }

  const updatedRecords = [...updates.values()];
  store.update(state => {
    state.records = state.records.map(record => updates.get(record.id) || record);
    for (const record of updatedRecords) {
      const machineSession = state.machineSessions[record.machineId];
      if (!machineSession) continue;
      state.machineSessions[record.machineId] = {
        ...machineSession,
        shiftPerformance: {
          productiveTimeSeconds: record.productiveTimeSeconds,
          stoppageTimeSeconds: record.stoppageTimeSeconds,
          targetReached: record.targetReached,
          performanceStatus: record.performanceStatus,
          performancePercent: record.performancePercent,
          differenceToTarget: record.differenceToTarget,
          calculatedAt: record.performanceCalculatedAt
        }
      };
    }
  }, 'shift-performance-enriched');
  scheduleCloudUpdate(updatedRecords);
  enriching = false;
}

function scheduleEnrichment(reason) {
  if (reason !== 'pointing-normalized' || enrichmentScheduled) return;
  enrichmentScheduled = true;
  window.setTimeout(() => {
    enrichmentScheduled = false;
    enrichPointingRecords();
  }, 0);
}

store.subscribe((_state, reason) => {
  scheduleEnrichment(reason);
  window.requestAnimationFrame(enhanceInterface);
});

const observer = new MutationObserver(() => window.requestAnimationFrame(enhanceInterface));
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('input', event => {
  const input = event.target.closest?.('[data-batch-pieces]');
  if (!input) return;
  const row = input.closest('.ops-batch-row');
  if (row) updateEntryPreview(row, input);
});

window.requestAnimationFrame(enhanceInterface);
