import {
  store,
  api,
  API_BASE,
  currentMachineSession,
  getMachine,
  minutesRemaining,
  parseNumber,
  parseCycle,
  formatNumber,
  localDateKey
} from './core.js';
import { calculateProductionPlan } from './production-planning.js';
import { calculateMeasurementPlans } from './measurement-engine.js';

const SETTINGS_KEY = 'neodent-mes:global-settings';
const PLAN_VERSION = 2;
let enhanceFrame = 0;
let publishTimer = 0;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

function nonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function parseDisplayedNumber(value) {
  const normalized = String(value || '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function globalSettings() {
  if (store.state.globalSettings) return store.state.globalSettings;
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

function conferenceSource() {
  return {
    cycleSeconds: parseCycle(document.getElementById('confCycle')?.value || ''),
    availableMinutes: minutesRemaining(store.state.session?.shift),
    opTarget: parseNumber(document.getElementById('confOpTarget')?.value),
    producedSoFar: parseDisplayedNumber(document.getElementById('knownProduction')?.textContent),
    frequency1: parseNumber(document.getElementById('confFrequency1')?.value),
    frequency2: parseNumber(document.getElementById('confFrequency2')?.value),
    currentBarPieces: parseNumber(document.getElementById('confCurrentBarPieces')?.value),
    feederBars: parseNumber(document.getElementById('confFeederBars')?.value),
    pieceLengthMm: parseNumber(document.getElementById('confPieceLengthMm')?.value)
  };
}

function plansFromInput(input) {
  const production = calculateProductionPlan(input, globalSettings());
  const measurements = calculateMeasurementPlans({
    opTarget: input.opTarget,
    producedSoFar: input.producedSoFar,
    shiftTarget: production.plannedTarget,
    frequency1: input.frequency1,
    frequency2: input.frequency2
  });
  return { production, measurements };
}

function plansFromSession(session) {
  const production = calculateProductionPlan({
    cycleSeconds: session.cycleSeconds,
    availableMinutes: session.availableMinutes,
    opTarget: session.opTarget,
    producedSoFar: session.producedSoFar,
    frequency1: session.frequency1,
    frequency2: session.frequency2,
    currentBarPieces: session.currentBarPieces,
    feederBars: session.feederBars,
    pieceLengthMm: session.pieceLengthMm
  }, {
    barLengthMm: session.barLengthMm || globalSettings().barLengthMm,
    kerfMm: session.kerfMm || globalSettings().kerfMm
  });
  const shiftTarget = Number.isFinite(Number(session.plannedShiftTarget))
    ? Number(session.plannedShiftTarget)
    : production.plannedTarget;
  const measurements = calculateMeasurementPlans({
    opTarget: session.opTarget,
    producedSoFar: session.producedSoFar,
    shiftTarget,
    frequency1: session.frequency1,
    frequency2: session.frequency2
  });
  return { production, measurements };
}

function measurementLabel(plan) {
  return `${formatNumber(plan.measurementsThisShift)} neste turno · ${formatNumber(plan.totalMeasurements)} na OP`;
}

function pointRows(plan, compact = false) {
  if (!plan.points.length) {
    const complete = plan.totalMeasurements > 0 && plan.previousMeasurements >= plan.totalMeasurements;
    return `<div class="measurement-empty"><strong>${complete ? 'Plano de medições concluído pela produção informada' : 'Nenhuma medição prevista neste turno'}</strong><span>${complete ? `${formatNumber(plan.totalMeasurements)} medições previstas na OP.` : 'A próxima frequência não será atingida dentro da meta considerada.'}</span></div>`;
  }

  const visible = compact ? plan.points.slice(0, 3) : plan.points;
  return `<div class="measurement-points">${visible.map((point, index) => `<div class="measurement-point ${index === 0 ? 'is-next' : ''}">
    <div class="measurement-point__quantity"><strong>${formatNumber(point.shiftPiece)}</strong><span>peças no turno</span></div>
    <div><strong>Faça a medição ${formatNumber(point.measurementNumber)} de ${formatNumber(point.totalMeasurements)}</strong><span>${formatNumber(point.shiftSequence)}ª medição prevista neste turno · acumulado da OP: ${formatNumber(point.accumulatedPiece)}</span></div>
  </div>`).join('')}</div>`;
}

function frequencyBlock(plan, label, compact = false) {
  if (!(plan.frequency > 0)) return '';
  const fullPlan = compact && plan.points.length > 3
    ? `<details class="measurement-details"><summary>Ver plano completo (${formatNumber(plan.points.length)})</summary>${pointRows(plan, false)}</details>`
    : '';
  return `<article class="measurement-frequency" data-has-points="${plan.points.length ? 'true' : 'false'}">
    <header><div><p>${label}</p><strong>A cada ${formatNumber(plan.frequency, 3)} peças</strong></div><span>${measurementLabel(plan)}</span></header>
    <dl class="measurement-totals">
      <div><dt>Total da OP</dt><dd>${formatNumber(plan.totalMeasurements)}</dd></div>
      <div><dt>Anteriores esperadas</dt><dd>${formatNumber(plan.previousMeasurements)}</dd></div>
      <div><dt>Neste turno</dt><dd>${formatNumber(plan.measurementsThisShift)}</dd></div>
      <div><dt>Depois do turno</dt><dd>${formatNumber(plan.remainingAfterShift)}</dd></div>
    </dl>
    ${pointRows(plan, compact)}
    ${fullPlan}
  </article>`;
}

function updateLegacyMeasurementTiles(measurements) {
  const preview = document.getElementById('planningPreview');
  preview?.querySelectorAll('.planning-preview__grid > div').forEach(tile => {
    const label = tile.querySelector('span');
    const value = tile.querySelector('strong');
    if (!label || !value) return;
    if (label.textContent.includes('Frequência I')) {
      label.textContent = 'Medições I neste turno';
      value.textContent = formatNumber(measurements.frequency1.measurementsThisShift);
    }
    if (label.textContent.includes('Frequência II')) {
      label.textContent = 'Medições II neste turno';
      value.textContent = formatNumber(measurements.frequency2.measurementsThisShift);
    }
  });
}

function updateConferencePlan() {
  const basePreview = document.getElementById('planningPreview');
  if (!basePreview) return;
  let preview = document.getElementById('measurementPlanPreview');
  if (!preview) {
    preview = document.createElement('section');
    preview.id = 'measurementPlanPreview';
    preview.className = 'measurement-plan-preview';
    basePreview.insertAdjacentElement('afterend', preview);
  }

  const { production, measurements } = plansFromInput(conferenceSource());
  updateLegacyMeasurementTiles(measurements);
  const hasPrimary = measurements.frequency1.frequency > 0;
  if (!hasPrimary) {
    preview.innerHTML = '<div class="measurement-plan-head"><div><strong>Plano de medições</strong><span>Preencha a Meta da OP e a Frequência de medição.</span></div></div>';
    return;
  }

  preview.innerHTML = `<div class="measurement-plan-head">
      <div><strong>Plano de medições da OP</strong><span>Orientações convertidas para peças produzidas neste turno</span></div>
      <span>${formatNumber(nonNegative(production.plannedTarget))} peças planejadas</span>
    </div>
    ${frequencyBlock(measurements.frequency1, 'Frequência I')}
    ${frequencyBlock(measurements.frequency2, 'Frequência II')}`;
}

function enhanceConference() {
  const form = document.getElementById('conferenceForm');
  if (!form || form.dataset.measurementPlanReady) return;
  form.dataset.measurementPlanReady = 'true';
  form.addEventListener('input', () => queueMicrotask(updateConferencePlan));
  const known = document.getElementById('knownProduction');
  if (known) new MutationObserver(updateConferencePlan).observe(known, { childList: true, characterData: true, subtree: true });
  updateConferencePlan();
}

function storedPlans(session) {
  if (session.measurementPlanVersion === PLAN_VERSION && session.measurementPlan1) {
    return {
      frequency1: session.measurementPlan1,
      frequency2: session.measurementPlan2 || calculateMeasurementPlans({}).frequency2
    };
  }
  return plansFromSession(session).measurements;
}

function updateCardLegacyTiles(card, measurements) {
  card.querySelectorAll('.planning-card-summary__grid > div').forEach(tile => {
    const label = tile.querySelector('span');
    const value = tile.querySelector('strong');
    if (!label || !value) return;
    if (label.textContent.trim() === 'Medições I') {
      label.textContent = 'Medições I no turno';
      value.textContent = formatNumber(measurements.frequency1.measurementsThisShift);
    }
    if (label.textContent.trim() === 'Medições II') {
      label.textContent = 'Medições II no turno';
      value.textContent = formatNumber(measurements.frequency2.measurementsThisShift);
    }
  });
}

function enhanceMachineCards() {
  document.querySelectorAll('.ops-machine-card').forEach((card, index) => {
    const assignment = store.state.assignments[index];
    const session = assignment ? currentMachineSession(assignment.machineId) : null;
    if (!session?.opTarget || !session?.frequency1) return;
    const measurements = storedPlans(session);
    updateCardLegacyTiles(card, measurements);

    let panel = card.querySelector('.measurement-card-plan');
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'measurement-card-plan';
      const planning = card.querySelector('.planning-card-summary');
      planning?.insertAdjacentElement('afterend', panel);
    }
    if (!panel) return;
    panel.innerHTML = `<header class="measurement-card-plan__head"><div><strong>Plano de medições</strong><span>Baseado no acumulado da OP e na meta deste turno</span></div><span>Manual</span></header>
      ${frequencyBlock(measurements.frequency1, 'Frequência I', true)}
      ${frequencyBlock(measurements.frequency2, 'Frequência II', true)}`;
  });
}

function enhanceCellView() {
  document.querySelectorAll('#cellLayer .ops-cell-item').forEach((item, index) => {
    const assignment = store.state.assignments[index];
    const session = assignment
      ? (store.state.sharedMachineStates?.[assignment.machineId] || currentMachineSession(assignment.machineId))
      : null;
    if (!session?.opTarget || !session?.frequency1) return;
    const measurements = storedPlans(session);
    const legacy = item.querySelector('.planning-cell-meta');
    legacy?.querySelectorAll('span').forEach(span => {
      if (!span.textContent.trim().startsWith('Medições')) return;
      span.textContent = `F1 ${measurements.frequency1.measurementsThisShift}/${measurements.frequency1.totalMeasurements}${measurements.frequency2.frequency > 0 ? ` · F2 ${measurements.frequency2.measurementsThisShift}/${measurements.frequency2.totalMeasurements}` : ''}`;
    });
    let row = item.querySelector('.measurement-cell-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'measurement-cell-row';
      item.appendChild(row);
    }
    const next1 = measurements.frequency1.points[0];
    const next2 = measurements.frequency2.points[0];
    row.innerHTML = `${next1 ? `<span>Próxima F1: ${formatNumber(next1.shiftPiece)} pç do turno · ${formatNumber(next1.measurementNumber)}/${formatNumber(next1.totalMeasurements)}</span>` : '<span>F1 sem medição prevista no turno</span>'}${measurements.frequency2.frequency > 0 ? (next2 ? `<span>Próxima F2: ${formatNumber(next2.shiftPiece)} pç do turno · ${formatNumber(next2.measurementNumber)}/${formatNumber(next2.totalMeasurements)}</span>` : '<span>F2 sem medição prevista no turno</span>') : ''}`;
  });
}

function sessionPlanPayload(session) {
  const measurements = plansFromSession(session).measurements;
  const signature = [
    session.op,
    session.opTarget,
    session.producedSoFar,
    session.plannedShiftTarget,
    session.frequency1,
    session.frequency2
  ].join('|');
  return {
    measurementPlanVersion: PLAN_VERSION,
    measurementPlanSignature: signature,
    measurementPlan1: measurements.frequency1,
    measurementPlan2: measurements.frequency2,
    measurement1: measurements.frequency1.measurementsThisShift,
    measurement2: measurements.frequency2.measurementsThisShift,
    totalMeasurements1: measurements.frequency1.totalMeasurements,
    totalMeasurements2: measurements.frequency2.totalMeasurements,
    previousMeasurements1: measurements.frequency1.previousMeasurements,
    previousMeasurements2: measurements.frequency2.previousMeasurements
  };
}

async function publishMeasurementPlan(machineId) {
  if (!API_BASE) return;
  const session = currentMachineSession(machineId);
  const machine = getMachine(machineId);
  const operator = store.state.session;
  if (!session || !machine || !operator) return;
  try {
    await api.post('/api/v1/machine-states', {
      ...session,
      machineId: machine.id,
      machineName: machine.name,
      lineId: machine.lineId,
      lineName: machine.lineName,
      operatorName: operator.name,
      registration: operator.registration,
      shift: String(operator.shift),
      productionDate: localDateKey(),
      updatedAt: session.updatedAt || new Date().toISOString()
    });
  } catch {
    // A API já mantém o lançamento na fila offline.
  }
}

function savePlansAfterConference() {
  const machineId = store.state.activeMachineId;
  const session = currentMachineSession(machineId);
  if (!machineId || !session?.opTarget || !session?.frequency1) return;
  const payload = sessionPlanPayload(session);
  store.update(state => {
    const current = state.machineSessions[machineId];
    if (!current) return;
    state.machineSessions[machineId] = { ...current, ...payload };
  }, 'measurement-plan-save');
  clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => publishMeasurementPlan(machineId), 220);
}

function scheduleEnhance() {
  cancelAnimationFrame(enhanceFrame);
  enhanceFrame = requestAnimationFrame(() => {
    enhanceConference();
    enhanceMachineCards();
    enhanceCellView();
  });
}

store.subscribe((_state, reason) => {
  if (reason === 'planning-save') queueMicrotask(savePlansAfterConference);
  scheduleEnhance();
});

new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true });
scheduleEnhance();
