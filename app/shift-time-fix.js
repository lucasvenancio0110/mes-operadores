import {
  store,
  currentMachineSession,
  parseCycle,
  parseNumber,
  formatNumber
} from './core.js';
import { calculateProductionPlan } from './production-planning.js';
import {
  FULL_SHIFT_MINUTES,
  calculateFullShiftTarget,
  cycleSecondsToDecimalMinutes
} from './shift-time-engine.js';

let frame = 0;
let normalizing = false;

function displayedNumber(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function conferencePlanningInput() {
  const cycleSeconds = parseCycle(document.getElementById('confCycle')?.value || '');
  return {
    cycleSeconds,
    availableMinutes: FULL_SHIFT_MINUTES,
    opTarget: parseNumber(document.getElementById('confOpTarget')?.value),
    producedSoFar: displayedNumber(document.getElementById('knownProduction')?.textContent),
    frequency1: parseNumber(document.getElementById('confFrequency1')?.value),
    frequency2: parseNumber(document.getElementById('confFrequency2')?.value),
    currentBarPieces: parseNumber(document.getElementById('confCurrentBarPieces')?.value),
    feederBars: parseNumber(document.getElementById('confFeederBars')?.value),
    pieceLengthMm: parseNumber(document.getElementById('confPieceLengthMm')?.value)
  };
}

function formatPlanValue(value) {
  return Number.isFinite(Number(value)) ? formatNumber(Number(value), 1) : '—';
}

function replaceTileValue(preview, label, value) {
  for (const tile of preview.querySelectorAll('.planning-preview__grid > div')) {
    if (tile.querySelector('span')?.textContent.trim() !== label) continue;
    const output = tile.querySelector('strong');
    const next = formatPlanValue(value);
    if (output && output.textContent !== next) output.textContent = next;
  }
}

function correctConferencePreview() {
  const form = document.getElementById('conferenceForm');
  const preview = document.getElementById('planningPreview');
  if (!form || !preview) return;

  const input = conferencePlanningInput();
  const plan = calculateProductionPlan(input);
  replaceTileValue(preview, 'Meta teórica do turno', plan.turnTarget);
  replaceTileValue(preview, 'Meta considerada', plan.plannedTarget);

  const subtitle = preview.querySelector('.planning-preview__head span');
  if (subtitle && subtitle.textContent !== 'Turno completo de 480 minutos') {
    subtitle.textContent = 'Turno completo de 480 minutos';
  }

  const cycleHint = document.getElementById('confCycle')?.closest('.field')?.querySelector('.field-hint');
  if (cycleHint && Number.isFinite(input.cycleSeconds)) {
    const decimalMinutes = cycleSecondsToDecimalMinutes(input.cycleSeconds);
    const normalized = `Ciclo normalizado: ${formatNumber(decimalMinutes, 4)} min · Meta baseada em 480 min.`;
    if (cycleHint.textContent !== normalized) cycleHint.textContent = normalized;
  }
}

function normalizedSession(session) {
  if (!session) return null;
  const cycleSeconds = Number(session.cycleSeconds);
  if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0) return null;

  const target = calculateFullShiftTarget(cycleSeconds);
  const plan = calculateProductionPlan({
    ...session,
    availableMinutes: FULL_SHIFT_MINUTES
  }, {
    barLengthMm: session.barLengthMm || 3600,
    kerfMm: session.kerfMm || 1
  });

  return {
    ...session,
    availableMinutes: FULL_SHIFT_MINUTES,
    shiftDurationMinutes: FULL_SHIFT_MINUTES,
    cycleMinutesDecimal: cycleSecondsToDecimalMinutes(cycleSeconds),
    target,
    turnTarget: plan.turnTarget,
    plannedShiftTarget: plan.plannedTarget,
    measurement1: plan.measurement1,
    measurement2: plan.measurement2,
    materialPotential: plan.materialPotential,
    piecesPerFullBar: plan.piecesPerFullBar
  };
}

function needsUpdate(current, next) {
  const keys = [
    'availableMinutes',
    'shiftDurationMinutes',
    'cycleMinutesDecimal',
    'target',
    'turnTarget',
    'plannedShiftTarget',
    'measurement1',
    'measurement2',
    'materialPotential',
    'piecesPerFullBar'
  ];
  return keys.some(key => {
    const a = Number(current?.[key]);
    const b = Number(next?.[key]);
    if (Number.isNaN(a) && Number.isNaN(b)) return false;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return String(current?.[key] ?? '') !== String(next?.[key] ?? '');
    return Math.abs(a - b) > 0.000001;
  });
}

function normalizeSessions(reason = 'shift-time-normalized') {
  if (normalizing) return;
  const changes = [];
  for (const [machineId, session] of Object.entries(store.state.machineSessions || {})) {
    const next = normalizedSession(session);
    if (next && needsUpdate(session, next)) changes.push([machineId, next]);
  }
  if (!changes.length) return;

  normalizing = true;
  store.update(state => {
    for (const [machineId, session] of changes) state.machineSessions[machineId] = session;
  }, reason);
  normalizing = false;
}

function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    correctConferencePreview();
  });
}

store.subscribe((_state, reason) => {
  if (normalizing || reason === 'shift-time-normalized') return schedule();
  if (['conference-save', 'planning-save', 'conference-reconciled', 'login', 'assignments'].includes(reason)) {
    queueMicrotask(() => normalizeSessions());
  }
  schedule();
});

document.addEventListener('input', event => {
  if (event.target.closest('#conferenceForm')) schedule();
});

document.addEventListener('change', event => {
  if (event.target.closest('#conferenceForm')) schedule();
});

new MutationObserver(schedule).observe(document.body, { childList:true, subtree:true });
normalizeSessions();
schedule();
