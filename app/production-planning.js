import {
  store,
  api,
  API_BASE,
  currentMachineSession,
  getMachine,
  minutesRemaining,
  parseNumber,
  parseCycle,
  formatNumber
} from './core.js';
import { escapeHtml } from './components.js';

const SETTINGS_KEY = 'neodent-mes:global-settings';
const DEFAULT_SETTINGS = Object.freeze({ barLengthMm: 3600, kerfMm: 1 });

let settings = loadLocalSettings();
let pendingPlanning = null;
let enhanceFrame = 0;

function positive(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegative(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeSettings(value = {}) {
  return {
    barLengthMm: positive(value.barLengthMm, DEFAULT_SETTINGS.barLengthMm),
    kerfMm: positive(value.kerfMm, DEFAULT_SETTINGS.kerfMm)
  };
}

function loadLocalSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings(next) {
  settings = normalizeSettings(next);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  store.update(state => { state.globalSettings = { ...settings }; }, 'global-settings');
}

function integer(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : NaN;
}

export function calculateProductionPlan(input = {}, globalSettings = settings) {
  const barLengthMm = positive(globalSettings.barLengthMm, DEFAULT_SETTINGS.barLengthMm);
  const kerfMm = positive(globalSettings.kerfMm, DEFAULT_SETTINGS.kerfMm);
  const cycleSeconds = positive(input.cycleSeconds);
  const availableMinutes = nonNegative(input.availableMinutes, 0);
  const opTarget = positive(input.opTarget);
  const producedSoFar = nonNegative(input.producedSoFar, 0);
  const pieceLengthMm = positive(input.pieceLengthMm);
  const currentBarPieces = nonNegative(input.currentBarPieces, 0);
  const feederBars = integer(nonNegative(input.feederBars, 0));
  const frequency1 = positive(input.frequency1);
  const frequency2 = positive(input.frequency2);

  const turnTarget = cycleSeconds > 0
    ? integer((availableMinutes * 60) / cycleSeconds)
    : NaN;
  const opRemaining = Number.isFinite(opTarget)
    ? integer(Math.max(opTarget - producedSoFar, 0))
    : NaN;
  const piecesPerFullBar = pieceLengthMm > 0
    ? integer(barLengthMm / (pieceLengthMm + kerfMm))
    : NaN;
  const materialPotential = Number.isFinite(piecesPerFullBar)
    ? integer(currentBarPieces + feederBars * piecesPerFullBar)
    : NaN;

  const limits = [turnTarget, opRemaining, materialPotential].filter(Number.isFinite);
  const plannedTarget = limits.length ? integer(Math.min(...limits)) : NaN;
  const measurement1 = frequency1 > 0 && Number.isFinite(plannedTarget)
    ? Math.ceil(plannedTarget / frequency1)
    : NaN;
  const measurement2 = frequency2 > 0 && Number.isFinite(plannedTarget)
    ? Math.ceil(plannedTarget / frequency2)
    : NaN;

  return {
    barLengthMm,
    kerfMm,
    turnTarget,
    opRemaining,
    piecesPerFullBar,
    materialPotential,
    plannedTarget,
    measurement1,
    measurement2
  };
}

function fieldHtml(id, label, value = '', options = {}) {
  const { suffix = '', hint = '', min = '0', step = 'any', required = true } = options;
  return `<div class="field planning-field">
    <label for="${id}">${label}${required ? '' : ' <span>(opcional)</span>'}</label>
    <div class="planning-input-wrap"><input id="${id}" inputmode="decimal" min="${min}" step="${step}" ${required ? 'required' : ''} value="${escapeHtml(value)}">${suffix ? `<span>${suffix}</span>` : ''}</div>
    ${hint ? `<small class="field-hint">${hint}</small>` : ''}
  </div>`;
}

function sessionPlanningSource(machineId) {
  const local = currentMachineSession(machineId) || {};
  const remote = store.state.sharedMachineStates?.[machineId] || {};
  return { ...remote, ...local };
}

function parseDisplayedNumber(value) {
  const normalized = String(value || '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function conferenceInput() {
  const known = document.getElementById('knownProduction');
  return {
    cycleSeconds: parseCycle(document.getElementById('confCycle')?.value || ''),
    availableMinutes: minutesRemaining(store.state.session?.shift),
    opTarget: parseNumber(document.getElementById('confOpTarget')?.value),
    producedSoFar: parseDisplayedNumber(known?.textContent),
    frequency1: parseNumber(document.getElementById('confFrequency1')?.value),
    frequency2: parseNumber(document.getElementById('confFrequency2')?.value),
    currentBarPieces: parseNumber(document.getElementById('confCurrentBarPieces')?.value),
    feederBars: parseNumber(document.getElementById('confFeederBars')?.value),
    pieceLengthMm: parseNumber(document.getElementById('confPieceLengthMm')?.value)
  };
}

function resultValue(value, suffix = '') {
  return Number.isFinite(value) ? `${formatNumber(value)}${suffix}` : '—';
}

function updatePlanningPreview() {
  const preview = document.getElementById('planningPreview');
  if (!preview) return;
  const plan = calculateProductionPlan(conferenceInput());
  const hasFrequency2 = positive(conferenceInput().frequency2) > 0;

  preview.innerHTML = `<div class="planning-preview__head">
      <div><strong>Planejamento calculado</strong><span>Baseado nos dados informados pelo operador</span></div>
      <span class="planning-manual-badge">Manual</span>
    </div>
    <div class="planning-preview__grid">
      <div><span>Meta teórica do turno</span><strong>${resultValue(plan.turnTarget)}</strong></div>
      <div><span>Meta considerada</span><strong>${resultValue(plan.plannedTarget)}</strong></div>
      <div><span>Restante da OP</span><strong>${resultValue(plan.opRemaining)}</strong></div>
      <div><span>Peças por barra inteira</span><strong>${resultValue(plan.piecesPerFullBar)}</strong></div>
      <div><span>Potencial informado</span><strong>${resultValue(plan.materialPotential, ' pç')}</strong></div>
      <div><span>Medições — Frequência I</span><strong>${resultValue(plan.measurement1)}</strong></div>
      ${hasFrequency2 ? `<div><span>Medições — Frequência II</span><strong>${resultValue(plan.measurement2)}</strong></div>` : ''}
    </div>
    <p>Barra padrão: ${formatNumber(plan.barLengthMm)} mm · Sangrador: ${formatNumber(plan.kerfMm, 2)} mm</p>`;
}

function showFrequency2() {
  const field = document.getElementById('confFrequency2')?.closest('.field');
  const button = document.getElementById('addFrequency2');
  if (!field) return;
  field.hidden = false;
  field.classList.add('planning-frequency-2');
  document.getElementById('confFrequency2')?.focus();
  if (button) button.hidden = true;
}

function validatePlanning(form) {
  const input = conferenceInput();
  const errors = [];
  if (!(input.opTarget > 0)) errors.push('Meta da OP');
  if (!(input.frequency1 > 0)) errors.push('Frequência de medição');
  if (!(input.currentBarPieces >= 0)) errors.push('Peças da barra atual');
  if (!(input.feederBars >= 0)) errors.push('Barras no alimentador');
  if (!(input.pieceLengthMm > 0)) errors.push('Comprimento da peça');
  if (errors.length) {
    const output = form.querySelector('#conferenceError');
    if (output) output.textContent = `Preencha corretamente: ${errors.join(', ')}.`;
    return null;
  }

  const plan = calculateProductionPlan(input);
  return {
    ...input,
    ...plan,
    opTarget: input.opTarget,
    currentBarPieces: input.currentBarPieces,
    feederBars: integer(input.feederBars),
    pieceLengthMm: input.pieceLengthMm,
    plannedAt: new Date().toISOString()
  };
}

function enhanceConference() {
  const form = document.getElementById('conferenceForm');
  if (!form || form.dataset.planningReady) return;
  form.dataset.planningReady = 'true';

  const machineId = store.state.activeMachineId;
  const source = sessionPlanningSource(machineId);
  const grid = form.querySelector('.ops-form-grid');
  const itemField = document.getElementById('confItem')?.closest('.field');
  const frequency1 = document.getElementById('confFrequency1');
  const frequency2 = document.getElementById('confFrequency2');
  if (!grid || !itemField || !frequency1 || !frequency2) return;

  const metaContainer = document.createElement('div');
  metaContainer.innerHTML = fieldHtml('confOpTarget', 'Meta da OP', Number.isFinite(Number(source.opTarget)) ? source.opTarget : '', { suffix: 'peças', step: '1' });
  itemField.insertAdjacentElement('afterend', metaContainer.firstElementChild);

  frequency1.required = true;
  frequency1.closest('.field').querySelector('label').textContent = 'Frequência de medição';
  frequency1.closest('.field').insertAdjacentHTML('beforeend', '<small class="field-hint">Informe de quantas em quantas peças deve ser feita a medição.</small>');

  const frequency2Field = frequency2.closest('.field');
  frequency2Field.classList.add('planning-frequency-2');
  frequency2Field.querySelector('label').innerHTML = 'Frequência II <span>(opcional)</span>';
  if (!(positive(source.frequency2) > 0) && !frequency2.value) frequency2Field.hidden = true;
  frequency1.closest('.field').insertAdjacentHTML('afterend', `<button id="addFrequency2" class="planning-add-frequency" type="button" ${frequency2Field.hidden ? '' : 'hidden'}>＋ Adicionar Frequência II</button>`);

  grid.insertAdjacentHTML('beforeend',
    fieldHtml('confCurrentBarPieces', 'Peças que a barra atual ainda fará', Number.isFinite(Number(source.currentBarPieces)) ? source.currentBarPieces : '', { suffix: 'peças', step: '1' }) +
    fieldHtml('confFeederBars', 'Barras inteiras no alimentador', Number.isFinite(Number(source.feederBars)) ? source.feederBars : '', { suffix: 'barras', hint: 'Sem contar a barra que já está em uso.', step: '1' }) +
    fieldHtml('confPieceLengthMm', 'Comprimento da peça', Number.isFinite(Number(source.pieceLengthMm)) ? source.pieceLengthMm : '', { suffix: 'mm', hint: `Cálculo: ${formatNumber(settings.barLengthMm)} ÷ (comprimento + ${formatNumber(settings.kerfMm, 2)} mm do sangrador).` })
  );

  const details = form.querySelector('.ops-details');
  const preview = document.createElement('section');
  preview.id = 'planningPreview';
  preview.className = 'planning-preview';
  details?.insertAdjacentElement('beforebegin', preview);

  form.addEventListener('input', updatePlanningPreview);
  form.addEventListener('submit', event => {
    const planning = validatePlanning(form);
    if (!planning) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    pendingPlanning = { machineId, planning };
  });
  document.getElementById('addFrequency2')?.addEventListener('click', showFrequency2);

  const known = document.getElementById('knownProduction');
  if (known) new MutationObserver(updatePlanningPreview).observe(known, { childList: true, characterData: true, subtree: true });
  updatePlanningPreview();
}

function planningPanel(session) {
  const plan = calculateProductionPlan({
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
    barLengthMm: session.barLengthMm || settings.barLengthMm,
    kerfMm: session.kerfMm || settings.kerfMm
  });

  const materialTone = Number.isFinite(plan.materialPotential) && Number.isFinite(plan.plannedTarget) && plan.materialPotential >= plan.plannedTarget
    ? 'success'
    : 'warning';
  return `<section class="planning-card-summary" data-tone="${materialTone}">
    <header><div><strong>Planejamento do turno</strong><span>Cálculo com informações lançadas pelo operador</span></div><span>Manual</span></header>
    <div class="planning-card-summary__grid">
      <div><span>Meta da OP</span><strong>${resultValue(positive(session.opTarget))}</strong></div>
      <div><span>Meta do turno</span><strong>${resultValue(plan.turnTarget)}</strong></div>
      <div><span>Medições I</span><strong>${resultValue(plan.measurement1)}</strong></div>
      ${positive(session.frequency2) > 0 ? `<div><span>Medições II</span><strong>${resultValue(plan.measurement2)}</strong></div>` : ''}
      <div><span>Barra atual</span><strong>${resultValue(nonNegative(session.currentBarPieces), ' pç')}</strong></div>
      <div><span>Barras no alimentador</span><strong>${resultValue(nonNegative(session.feederBars))}</strong></div>
      <div><span>Peças por barra</span><strong>${resultValue(plan.piecesPerFullBar)}</strong></div>
      <div><span>Potencial disponível</span><strong>${resultValue(plan.materialPotential, ' pç')}</strong></div>
    </div>
  </section>`;
}

function enhanceMachineCards() {
  document.querySelectorAll('.ops-machine-card').forEach((card, index) => {
    const assignment = store.state.assignments[index];
    const session = assignment ? currentMachineSession(assignment.machineId) : null;
    if (!session || !Number.isFinite(Number(session.opTarget))) return;
    if (card.querySelector('.planning-card-summary')) return;

    card.querySelectorAll('.ops-machine-facts dt').forEach(label => {
      if (label.textContent.trim() === 'Meta planejada') label.textContent = 'Meta do turno';
      if (label.textContent.trim() === 'Frequências I / II') label.textContent = 'Frequência(s)';
    });
    const situation = card.querySelector('.ops-situation');
    situation?.insertAdjacentHTML('beforebegin', planningPanel(session));
  });
}

function settingsCard() {
  return `<section class="ops-panel planning-settings-card">
    <p class="ops-eyebrow">Cálculo de matéria-prima</p>
    <h2>Ajustes globais</h2>
    <p>Usados no cálculo de peças por barra em todas as máquinas.</p>
    <div class="planning-settings-values"><div><span>Comprimento da barra</span><strong>${formatNumber(settings.barLengthMm)} mm</strong></div><div><span>Sangrador</span><strong>${formatNumber(settings.kerfMm, 2)} mm</strong></div></div>
    <button class="ops-btn ops-btn--soft ops-btn--full" type="button" data-planning-settings>Alterar ajustes</button>
  </section>`;
}

function enhanceMore() {
  const grid = document.querySelector('.ops-more-grid');
  if (!grid || grid.dataset.planningReady) return;
  grid.dataset.planningReady = 'true';
  grid.insertAdjacentHTML('beforeend', settingsCard());
}

function enhanceCellView() {
  const layer = document.getElementById('cellLayer');
  if (!layer || layer.dataset.planningReady) return;
  layer.dataset.planningReady = 'true';
  layer.querySelectorAll('.ops-cell-item').forEach((item, index) => {
    const assignment = store.state.assignments[index];
    const session = assignment
      ? (store.state.sharedMachineStates?.[assignment.machineId] || currentMachineSession(assignment.machineId))
      : null;
    if (!session?.opTarget) return;
    const plan = calculateProductionPlan(session, { barLengthMm: session.barLengthMm || settings.barLengthMm, kerfMm: session.kerfMm || settings.kerfMm });
    item.insertAdjacentHTML('beforeend', `<div class="planning-cell-meta"><span>Meta OP ${resultValue(positive(session.opTarget))}</span><span>Meta turno ${resultValue(plan.turnTarget)}</span><span>Medições ${resultValue(plan.measurement1)}${positive(session.frequency2) > 0 ? ` / ${resultValue(plan.measurement2)}` : ''}</span><span>Material ${resultValue(plan.materialPotential, ' pç')}</span></div>`);
  });
}

function openSettingsSheet() {
  const layers = document.getElementById('layers');
  layers.innerHTML = `<div class="ops-layer" id="planningSettingsLayer"><section class="ops-sheet" role="dialog" aria-modal="true" aria-labelledby="planningSettingsTitle">
    <header class="ops-sheet__head"><div><p class="ops-eyebrow">Configuração global</p><h2 id="planningSettingsTitle">Matéria-prima</h2></div><button class="ops-icon-btn" type="button" data-close-layer aria-label="Fechar">×</button></header>
    <div class="ops-sheet__body"><form id="planningSettingsForm">
      ${fieldHtml('settingBarLength', 'Comprimento padrão da barra', settings.barLengthMm, { suffix: 'mm' })}
      ${fieldHtml('settingKerf', 'Sangrador / bedame', settings.kerfMm, { suffix: 'mm' })}
      <p class="ops-help">Esses valores serão usados por todos os operadores quando o app estiver conectado ao Cloudflare.</p>
      <div class="field-error" id="planningSettingsError" role="alert"></div>
    </form></div>
    <footer class="ops-sheet__actions"><button class="ops-btn ops-btn--ghost" type="button" data-close-layer>Cancelar</button><button class="ops-btn ops-btn--primary" type="submit" form="planningSettingsForm">Salvar ajustes</button></footer>
  </section></div>`;
  document.body.classList.add('has-layer');
  document.getElementById('settingBarLength')?.focus();
}

async function saveSettings(form) {
  const next = normalizeSettings({
    barLengthMm: parseNumber(form.querySelector('#settingBarLength').value),
    kerfMm: parseNumber(form.querySelector('#settingKerf').value)
  });
  if (!(next.barLengthMm > 0) || !(next.kerfMm > 0)) {
    form.querySelector('#planningSettingsError').textContent = 'Informe valores maiores que zero.';
    return;
  }
  persistSettings(next);
  if (API_BASE) {
    try {
      const payload = await api.post('/api/v1/settings', next);
      persistSettings(payload.settings || next);
    } catch {
      // A fila offline já mantém a alteração pendente.
    }
  }
  document.getElementById('layers').innerHTML = '';
  document.body.classList.remove('has-layer');
}

async function loadCloudSettings() {
  const saved = store.state.globalSettings;
  if (saved) settings = normalizeSettings(saved);
  if (!API_BASE) {
    persistSettings(settings);
    return;
  }
  try {
    const payload = await api.get('/api/v1/settings');
    persistSettings(payload.settings || settings);
  } catch {
    persistSettings(settings);
  }
}

function scheduleEnhance() {
  cancelAnimationFrame(enhanceFrame);
  enhanceFrame = requestAnimationFrame(() => {
    enhanceConference();
    enhanceMachineCards();
    enhanceMore();
    enhanceCellView();
  });
}

store.subscribe((_state, reason) => {
  if (reason === 'conference-save' && pendingPlanning) {
    const { machineId, planning } = pendingPlanning;
    pendingPlanning = null;
    queueMicrotask(() => {
      store.update(state => {
        const session = state.machineSessions[machineId];
        if (!session) return;
        state.machineSessions[machineId] = {
          ...session,
          ...planning,
          barLengthMm: settings.barLengthMm,
          kerfMm: settings.kerfMm,
          target: planning.turnTarget,
          measurement1: planning.measurement1,
          measurement2: planning.measurement2,
          materialPotential: planning.materialPotential,
          piecesPerFullBar: planning.piecesPerFullBar,
          plannedShiftTarget: planning.plannedTarget
        };
      }, 'planning-save');
    });
  }
  scheduleEnhance();
});

document.addEventListener('click', event => {
  if (event.target.closest('[data-planning-settings]')) openSettingsSheet();
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'planningSettingsForm') return;
  event.preventDefault();
  saveSettings(event.target);
});

new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true });
loadCloudSettings().finally(scheduleEnhance);
