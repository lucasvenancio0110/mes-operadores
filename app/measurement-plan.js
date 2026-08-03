import {
  store, api, API_BASE, currentMachineSession, getMachine, minutesRemaining,
  parseNumber, parseCycle, formatNumber, localDateKey
} from './core.js';
import { calculateProductionPlan } from './production-planning.js';
import { calculateMeasurementPlans } from './measurement-engine.js';

const SETTINGS_KEY = 'neodent-mes:global-settings';
const PLAN_VERSION = 2;
let frame = 0;
let publishTimer = 0;

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function displayedNumber(value) {
  const parsed = Number(String(value || '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function settings() {
  if (store.state.globalSettings) return store.state.globalSettings;
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
}

function conferenceInput() {
  return {
    cycleSeconds: parseCycle(document.getElementById('confCycle')?.value || ''),
    availableMinutes: minutesRemaining(store.state.session?.shift),
    opTarget: parseNumber(document.getElementById('confOpTarget')?.value),
    producedSoFar: displayedNumber(document.getElementById('knownProduction')?.textContent),
    frequency1: parseNumber(document.getElementById('confFrequency1')?.value),
    frequency2: parseNumber(document.getElementById('confFrequency2')?.value),
    currentBarPieces: parseNumber(document.getElementById('confCurrentBarPieces')?.value),
    feederBars: parseNumber(document.getElementById('confFeederBars')?.value),
    pieceLengthMm: parseNumber(document.getElementById('confPieceLengthMm')?.value)
  };
}

function calculateFromInput(input) {
  const production = calculateProductionPlan(input, settings());
  const measurements = calculateMeasurementPlans({
    opTarget: input.opTarget,
    producedSoFar: input.producedSoFar,
    shiftTarget: production.plannedTarget,
    frequency1: input.frequency1,
    frequency2: input.frequency2
  });
  return { production, measurements };
}

function calculateFromSession(session) {
  const source = {
    cycleSeconds: session.cycleSeconds,
    availableMinutes: session.availableMinutes,
    opTarget: session.opTarget,
    producedSoFar: session.producedSoFar,
    frequency1: session.frequency1,
    frequency2: session.frequency2,
    currentBarPieces: session.currentBarPieces,
    feederBars: session.feederBars,
    pieceLengthMm: session.pieceLengthMm
  };
  const production = calculateProductionPlan(source, {
    barLengthMm: session.barLengthMm || settings().barLengthMm,
    kerfMm: session.kerfMm || settings().kerfMm
  });
  const shiftTarget = Number.isFinite(Number(session.plannedShiftTarget))
    ? Number(session.plannedShiftTarget)
    : production.plannedTarget;
  return {
    production,
    measurements: calculateMeasurementPlans({
      opTarget: session.opTarget,
      producedSoFar: session.producedSoFar,
      shiftTarget,
      frequency1: session.frequency1,
      frequency2: session.frequency2
    })
  };
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function pointList(plan, compact = false) {
  if (!plan.points.length) {
    const complete = plan.totalMeasurements > 0 && plan.previousMeasurements >= plan.totalMeasurements;
    return `<div class="measurement-empty"><strong>${complete ? 'Todas as medições previstas da OP já foram alcançadas' : 'Nenhuma medição prevista neste turno'}</strong><span>${complete ? `${formatNumber(plan.totalMeasurements)} medições previstas na OP.` : 'A próxima frequência não será atingida dentro da meta considerada.'}</span></div>`;
  }
  const points = compact ? plan.points.slice(0, 3) : plan.points;
  return `<div class="measurement-points">${points.map((point, index) => `<div class="measurement-point ${index === 0 ? 'is-next' : ''}">
    <div class="measurement-point__quantity"><strong>${formatNumber(point.shiftPiece)}</strong><span>peças no turno</span></div>
    <div><strong>Faça a medição ${formatNumber(point.measurementNumber)} de ${formatNumber(point.totalMeasurements)}</strong><span>${formatNumber(point.shiftSequence)}ª medição deste turno · acumulado da OP: ${formatNumber(point.accumulatedPiece)}</span></div>
  </div>`).join('')}</div>`;
}

function frequencyCard(plan, label, compact = false) {
  if (!(plan.frequency > 0)) return '';
  const complete = compact && plan.points.length > 3
    ? `<details class="measurement-details"><summary>Ver plano completo (${formatNumber(plan.points.length)})</summary>${pointList(plan)}</details>`
    : '';
  return `<article class="measurement-frequency">
    <header><div><p>${label}</p><strong>A cada ${formatNumber(plan.frequency, 3)} peças</strong></div><span>${formatNumber(plan.measurementsThisShift)} neste turno · ${formatNumber(plan.totalMeasurements)} na OP</span></header>
    <dl class="measurement-totals">
      <div><dt>Total da OP</dt><dd>${formatNumber(plan.totalMeasurements)}</dd></div>
      <div><dt>Anteriores esperadas</dt><dd>${formatNumber(plan.previousMeasurements)}</dd></div>
      <div><dt>Neste turno</dt><dd>${formatNumber(plan.measurementsThisShift)}</dd></div>
      <div><dt>Depois do turno</dt><dd>${formatNumber(plan.remainingAfterShift)}</dd></div>
    </dl>
    ${pointList(plan, compact)}${complete}
  </article>`;
}

function replacePreviewCounters(measurements) {
  document.querySelectorAll('#planningPreview .planning-preview__grid > div').forEach(tile => {
    const label = tile.querySelector('span');
    const value = tile.querySelector('strong');
    if (!label || !value) return;
    if (label.textContent.includes('Frequência I')) {
      setText(label, 'Medições I neste turno');
      setText(value, formatNumber(measurements.frequency1.measurementsThisShift));
    }
    if (label.textContent.includes('Frequência II')) {
      setText(label, 'Medições II neste turno');
      setText(value, formatNumber(measurements.frequency2.measurementsThisShift));
    }
  });
}

function updateConferencePreview() {
  const planning = document.getElementById('planningPreview');
  if (!planning) return;
  let panel = document.getElementById('measurementPlanPreview');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'measurementPlanPreview';
    panel.className = 'measurement-plan-preview';
    planning.insertAdjacentElement('afterend', panel);
  }
  const { production, measurements } = calculateFromInput(conferenceInput());
  replacePreviewCounters(measurements);
  const html = measurements.frequency1.frequency > 0
    ? `<div class="measurement-plan-head"><div><strong>Plano de medições da OP</strong><span>Orientações convertidas para peças produzidas neste turno</span></div><span>${formatNumber(number(production.plannedTarget))} peças planejadas</span></div>${frequencyCard(measurements.frequency1, 'Frequência I')}${frequencyCard(measurements.frequency2, 'Frequência II')}`
    : '<div class="measurement-plan-head"><div><strong>Plano de medições</strong><span>Preencha a Meta da OP e a Frequência de medição.</span></div></div>';
  if (panel.dataset.content !== html) {
    panel.dataset.content = html;
    panel.innerHTML = html;
  }
}

function enhanceConference() {
  const form = document.getElementById('conferenceForm');
  if (!form || form.dataset.measurementPlanReady) return;
  form.dataset.measurementPlanReady = 'true';
  form.addEventListener('input', () => queueMicrotask(updateConferencePreview));
  const known = document.getElementById('knownProduction');
  if (known) new MutationObserver(updateConferencePreview).observe(known, { childList: true, characterData: true, subtree: true });
  updateConferencePreview();
}

function plansForCard(session) {
  if (session.measurementPlanVersion === PLAN_VERSION && session.measurementPlan1) {
    return {
      frequency1: session.measurementPlan1,
      frequency2: session.measurementPlan2 || calculateMeasurementPlans({}).frequency2
    };
  }
  return calculateFromSession(session).measurements;
}

function replaceCardCounters(card, measurements) {
  card.querySelectorAll('.planning-card-summary__grid > div').forEach(tile => {
    const label = tile.querySelector('span');
    const value = tile.querySelector('strong');
    if (!label || !value) return;
    if (label.textContent.trim() === 'Medições I') {
      setText(label, 'Medições I no turno');
      setText(value, formatNumber(measurements.frequency1.measurementsThisShift));
    }
    if (label.textContent.trim() === 'Medições II') {
      setText(label, 'Medições II no turno');
      setText(value, formatNumber(measurements.frequency2.measurementsThisShift));
    }
  });
}

function enhanceCards() {
  document.querySelectorAll('.ops-machine-card').forEach((card, index) => {
    const assignment = store.state.assignments[index];
    const session = assignment ? currentMachineSession(assignment.machineId) : null;
    if (!session?.opTarget || !session?.frequency1) return;
    const measurements = plansForCard(session);
    replaceCardCounters(card, measurements);
    let panel = card.querySelector('.measurement-card-plan');
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'measurement-card-plan';
      card.querySelector('.planning-card-summary')?.insertAdjacentElement('afterend', panel);
    }
    if (!panel) return;
    const html = `<header class="measurement-card-plan__head"><div><strong>Plano de medições</strong><span>Baseado no acumulado da OP e na meta deste turno</span></div><span>Manual</span></header>${frequencyCard(measurements.frequency1, 'Frequência I', true)}${frequencyCard(measurements.frequency2, 'Frequência II', true)}`;
    const signature = [session.op, session.opTarget, session.producedSoFar, session.plannedShiftTarget, session.frequency1, session.frequency2, session.status].join('|');
    if (panel.dataset.signature !== signature) {
      panel.dataset.signature = signature;
      panel.innerHTML = html;
    }
  });
}

function enhanceCellView() {
  document.querySelectorAll('#cellLayer .ops-cell-item').forEach((item, index) => {
    const assignment = store.state.assignments[index];
    const session = assignment ? (store.state.sharedMachineStates?.[assignment.machineId] || currentMachineSession(assignment.machineId)) : null;
    if (!session?.opTarget || !session?.frequency1) return;
    const measurements = plansForCard(session);
    item.querySelectorAll('.planning-cell-meta span').forEach(span => {
      if (span.textContent.trim().startsWith('Medições')) {
        setText(span, `F1 ${measurements.frequency1.measurementsThisShift}/${measurements.frequency1.totalMeasurements}${measurements.frequency2.frequency > 0 ? ` · F2 ${measurements.frequency2.measurementsThisShift}/${measurements.frequency2.totalMeasurements}` : ''}`);
      }
    });
    let row = item.querySelector('.measurement-cell-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'measurement-cell-row';
      item.appendChild(row);
    }
    const next1 = measurements.frequency1.points[0];
    const next2 = measurements.frequency2.points[0];
    const html = `${next1 ? `<span>Próxima F1: ${formatNumber(next1.shiftPiece)} pç do turno · medição ${formatNumber(next1.measurementNumber)}/${formatNumber(next1.totalMeasurements)}</span>` : '<span>F1 sem medição prevista no turno</span>'}${measurements.frequency2.frequency > 0 ? (next2 ? `<span>Próxima F2: ${formatNumber(next2.shiftPiece)} pç do turno · medição ${formatNumber(next2.measurementNumber)}/${formatNumber(next2.totalMeasurements)}</span>` : '<span>F2 sem medição prevista no turno</span>') : ''}`;
    if (row.dataset.content !== html) {
      row.dataset.content = html;
      row.innerHTML = html;
    }
  });
}

function persistedPlan(session) {
  const measurements = calculateFromSession(session).measurements;
  return {
    measurementPlanVersion: PLAN_VERSION,
    measurementPlanSignature: [session.op, session.opTarget, session.producedSoFar, session.plannedShiftTarget, session.frequency1, session.frequency2].join('|'),
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

async function publish(machineId) {
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
    // O cliente da API mantém a alteração na fila offline.
  }
}

function saveAfterConference() {
  const machineId = store.state.activeMachineId;
  const session = currentMachineSession(machineId);
  if (!machineId || !session?.opTarget || !session?.frequency1) return;
  const payload = persistedPlan(session);
  store.update(state => {
    if (state.machineSessions[machineId]) state.machineSessions[machineId] = { ...state.machineSessions[machineId], ...payload };
  }, 'measurement-plan-save');
  clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => publish(machineId), 220);
}

function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    enhanceConference();
    enhanceCards();
    enhanceCellView();
  });
}

store.subscribe((_state, reason) => {
  if (reason === 'planning-save') queueMicrotask(saveAfterConference);
  schedule();
});

new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
schedule();
