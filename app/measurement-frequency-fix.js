import { store } from './core.js';
import { calculateMeasurementPlans } from './measurement-engine.js';
import { parseFrequencyPair } from './measurement-frequency-parser.js';

const FIXED_PLAN_VERSION = 3;
let frame = 0;
let normalizing = false;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

function displayedInteger(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function planIsBalanced(plan) {
  if (!plan) return false;
  return Number(plan.previousMeasurements || 0)
    + Number(plan.measurementsThisShift || 0)
    + Number(plan.remainingAfterShift || 0)
    === Number(plan.totalMeasurements || 0);
}

function correctedSession(session) {
  if (!session?.opTarget) return null;

  const pair = parseFrequencyPair(session.frequency1);
  const frequency1 = pair?.frequency1 || positive(session.frequency1);
  const frequency2 = pair?.frequency2 || positive(session.frequency2);
  if (!(frequency1 > 0)) return null;

  const shiftTarget = [session.plannedShiftTarget, session.turnTarget, session.target]
    .map(positive)
    .find(Number.isFinite) || 0;

  const measurements = calculateMeasurementPlans({
    opTarget: session.opTarget,
    producedSoFar: session.producedSoFar,
    shiftTarget,
    frequency1,
    frequency2
  });

  return {
    ...session,
    frequency1,
    frequency2: Number.isFinite(frequency2) ? frequency2 : null,
    measurementPlanVersion: FIXED_PLAN_VERSION,
    measurementPlanSignature: [
      session.op,
      session.opTarget,
      session.producedSoFar,
      shiftTarget,
      frequency1,
      Number.isFinite(frequency2) ? frequency2 : ''
    ].join('|'),
    measurementPlan1: measurements.frequency1,
    measurementPlan2: measurements.frequency2,
    measurement1: measurements.frequency1.measurementsThisShift,
    measurement2: measurements.frequency2.measurementsThisShift,
    totalMeasurements1: measurements.frequency1.totalMeasurements,
    totalMeasurements2: measurements.frequency2.totalMeasurements,
    previousMeasurements1: measurements.frequency1.previousMeasurements,
    previousMeasurements2: measurements.frequency2.previousMeasurements,
    remainingMeasurementsAfterShift1: measurements.frequency1.remainingAfterShift,
    remainingMeasurementsAfterShift2: measurements.frequency2.remainingAfterShift
  };
}

function sessionNeedsCorrection(current, next) {
  if (!next) return false;
  if (Number(current.measurementPlanVersion) !== FIXED_PLAN_VERSION) return true;
  if (String(current.frequency1) !== String(next.frequency1)) return true;
  if (String(current.frequency2 ?? '') !== String(next.frequency2 ?? '')) return true;
  if (!planIsBalanced(current.measurementPlan1) || !planIsBalanced(current.measurementPlan2)) return true;
  return current.measurementPlanSignature !== next.measurementPlanSignature;
}

function normalizeStoredPlans() {
  if (normalizing) return;
  const changes = [];
  for (const [machineId, session] of Object.entries(store.state.machineSessions || {})) {
    const next = correctedSession(session);
    if (sessionNeedsCorrection(session, next)) changes.push([machineId, next]);
  }
  if (!changes.length) return;

  normalizing = true;
  store.update(state => {
    for (const [machineId, session] of changes) state.machineSessions[machineId] = session;
  }, 'measurement-frequency-fixed');
  normalizing = false;
}

function revealSecondFrequency(field, button) {
  if (field) field.hidden = false;
  if (button) button.hidden = true;
}

function enhanceFrequencyFields() {
  const form = document.getElementById('conferenceForm');
  const frequency1 = document.getElementById('confFrequency1');
  const frequency2 = document.getElementById('confFrequency2');
  if (!form || !frequency1 || !frequency2) return;

  const field1 = frequency1.closest('.field');
  const field2 = frequency2.closest('.field');
  const button = document.getElementById('addFrequency2');
  const label1 = field1?.querySelector('label');
  const label2 = field2?.querySelector('label');

  if (label1) label1.textContent = 'Frequência I';
  if (label2) label2.innerHTML = 'Frequência II <span>(opcional)</span>';
  if (button) button.textContent = '＋ Adicionar segunda frequência';

  const pair = parseFrequencyPair(frequency1.value);
  if (pair) {
    frequency1.value = pair.display1;
    frequency2.value = pair.display2;
    revealSecondFrequency(field2, button);
    frequency1.dispatchEvent(new Event('input', { bubbles: true }));
    frequency2.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (positive(String(frequency2.value).replace(',', '.')) > 0) {
    revealSecondFrequency(field2, button);
  }

  if (field1 && !field1.querySelector('[data-frequency-separate-hint]')) {
    const hint = document.createElement('small');
    hint.className = 'field-hint';
    hint.dataset.frequencySeparateHint = 'true';
    hint.textContent = 'Caso exista outra frequência, use “Adicionar segunda frequência”.';
    field1.appendChild(hint);
  }
}

function repairRenderedTotals() {
  for (const card of document.querySelectorAll('.measurement-frequency')) {
    const values = new Map();
    for (const item of card.querySelectorAll('.measurement-totals > div')) {
      const label = item.querySelector('dt')?.textContent.trim();
      const output = item.querySelector('dd');
      if (label && output) values.set(label, output);
    }

    const total = displayedInteger(values.get('Total da OP')?.textContent);
    const previous = displayedInteger(values.get('Anteriores esperadas')?.textContent);
    const current = displayedInteger(values.get('Neste turno')?.textContent);
    const remaining = Math.max(total - previous - current, 0);
    const output = values.get('Depois do turno');
    if (output && displayedInteger(output.textContent) !== remaining) {
      output.textContent = remaining.toLocaleString('pt-BR');
    }
  }
}

function enhance() {
  enhanceFrequencyFields();
  repairRenderedTotals();
}

function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(enhance);
}

store.subscribe((_state, reason) => {
  if (!normalizing && reason !== 'measurement-frequency-fixed') {
    queueMicrotask(normalizeStoredPlans);
  }
  schedule();
});

document.addEventListener('input', event => {
  if (event.target.id === 'confFrequency1' || event.target.id === 'confFrequency2') schedule();
});

document.addEventListener('change', event => {
  if (event.target.id === 'confFrequency1' || event.target.id === 'confFrequency2') schedule();
});

new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
normalizeStoredPlans();
schedule();
