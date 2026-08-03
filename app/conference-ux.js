import {
  store,
  currentMachineSession,
  getMachine,
  formatNumber,
  formatCycle,
  parseNumber
} from './core.js';

let frame = 0;
let pendingReconciliation = null;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function text(value) {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim();
  return ['null', 'undefined', 'nan'].includes(normalized.toLowerCase()) ? '' : normalized;
}

function inheritedValue(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}

function previousOpenSession(machineId) {
  const local = currentMachineSession(machineId);
  if (local) return { source: local, mode: 'edit' };

  const remote = store.state.sharedMachineStates?.[machineId];
  const closed = remote?.status === 'closed' || remote?.orderStatus === 'closed';
  const op = inheritedValue(remote, 'op', 'opNumber');
  if (remote && op && !closed) return { source: remote, mode: 'continuity' };
  return { source: null, mode: 'new' };
}

function setInput(id, value, force = false) {
  const input = document.getElementById(id);
  if (!input) return;
  const normalized = text(value);
  if (!force && text(input.value)) return;
  input.value = normalized;
}

function productionFrom(source) {
  const candidates = [
    source?.producedSoFar,
    source?.totalAfterPointing,
    source?.finalProduction,
    source?.openingProduction
  ];
  for (const candidate of candidates) {
    const value = finite(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function hydrateContinuity(source) {
  if (!source) return;
  setInput('confOp', inheritedValue(source, 'op', 'opNumber'), true);
  setInput('confItem', inheritedValue(source, 'item', 'itemNumber'), true);
  setInput('confOpTarget', inheritedValue(source, 'opTarget'), true);

  const cycle = finite(inheritedValue(source, 'cycleSeconds', 'cycleTimeSeconds'));
  setInput('confCycle', Number.isFinite(cycle) && cycle > 0 ? formatCycle(cycle) : '', true);
  setInput('confFrequency1', inheritedValue(source, 'frequency1'), true);
  setInput('confFrequency2', inheritedValue(source, 'frequency2'), true);
  setInput('confCurrentBarPieces', inheritedValue(source, 'currentBarPieces'), false);
  setInput('confFeederBars', inheritedValue(source, 'feederBars'), false);
  setInput('confPieceLengthMm', inheritedValue(source, 'pieceLengthMm'), false);

  const status = document.getElementById('confStatus');
  const inheritedStatus = inheritedValue(source, 'status');
  if (status && [...status.options].some(option => option.value === inheritedStatus)) status.value = inheritedStatus;
  else if (status && inheritedStatus === 'pointed') status.value = 'producing';

  const produced = productionFrom(source);
  const known = document.getElementById('knownProduction');
  if (known) known.textContent = formatNumber(produced);

  window.setTimeout(() => {
    document.getElementById('confOp')?.dispatchEvent(new Event('blur'));
    document.getElementById('confItem')?.dispatchEvent(new Event('blur'));
  }, 40);
}

function compactOrderSummary(source, mode) {
  const op = text(document.getElementById('confOp')?.value) || inheritedValue(source, 'op', 'opNumber') || '—';
  const item = text(document.getElementById('confItem')?.value) || inheritedValue(source, 'item', 'itemNumber') || '—';
  const target = text(document.getElementById('confOpTarget')?.value) || inheritedValue(source, 'opTarget') || '—';
  const cycle = text(document.getElementById('confCycle')?.value) || '—';
  const frequency1 = text(document.getElementById('confFrequency1')?.value) || '—';
  const frequency2 = text(document.getElementById('confFrequency2')?.value);

  return `<section class="conference-order-summary" data-mode="${mode}">
    <header>
      <div><span>${mode === 'continuity' ? 'Dados herdados do turno anterior' : 'Dados atuais da ordem'}</span><strong>OP ${op}</strong></div>
      <span class="conference-inherited-badge">${mode === 'continuity' ? 'Continuidade' : 'Conferida'}</span>
    </header>
    <dl>
      <div><dt>Item</dt><dd>${item}</dd></div>
      <div><dt>Meta da OP</dt><dd>${target}</dd></div>
      <div><dt>Ciclo</dt><dd>${cycle}</dd></div>
      <div><dt>Frequência I</dt><dd>${frequency1}</dd></div>
      ${frequency2 ? `<div><dt>Frequência II</dt><dd>${frequency2}</dd></div>` : ''}
    </dl>
    <button type="button" class="conference-edit-order" data-conference-edit-order>Corrigir dados da OP</button>
  </section>`;
}

function makeStatusButtons(select) {
  if (!select || select.dataset.segmentedReady) return;
  select.dataset.segmentedReady = 'true';
  select.hidden = true;
  const wrap = document.createElement('div');
  wrap.className = 'conference-status-buttons';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Situação encontrada');
  wrap.innerHTML = [...select.options].map(option => `<button type="button" data-status-value="${option.value}" aria-pressed="${select.value === option.value}">${option.textContent}</button>`).join('');
  select.insertAdjacentElement('afterend', wrap);
}

function buildStepper(input) {
  if (!input || input.dataset.stepperReady) return;
  input.dataset.stepperReady = 'true';
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.inputMode = 'numeric';
  input.readOnly = true;
  if (!text(input.value)) input.value = '0';
  const wrap = document.createElement('div');
  wrap.className = 'conference-stepper';
  input.parentNode.insertBefore(wrap, input);
  wrap.append(
    Object.assign(document.createElement('button'), { type: 'button', textContent: '−', ariaLabel: 'Diminuir barras' }),
    input,
    Object.assign(document.createElement('button'), { type: 'button', textContent: '+', ariaLabel: 'Aumentar barras' })
  );
  const buttons = wrap.querySelectorAll('button');
  buttons[0].dataset.stepValue = '-1';
  buttons[1].dataset.stepValue = '1';
}

function moveField(id, container) {
  const field = document.getElementById(id)?.closest('.field');
  if (field && field.parentElement !== container) container.appendChild(field);
  return field;
}

function organizeForm(form, source, mode) {
  const originalGrid = form.querySelector('.ops-form-grid');
  if (!originalGrid) return;

  const orderSection = document.createElement('section');
  orderSection.className = 'conference-section conference-order-fields';
  orderSection.innerHTML = '<header><div><span>1</span><strong>Ordem em produção</strong></div><small>Confira os dados técnicos</small></header><div class="conference-fields-grid"></div>';
  const orderGrid = orderSection.querySelector('.conference-fields-grid');

  ['confOp', 'confItem', 'confOpTarget', 'confCycle', 'confFrequency1', 'confFrequency2'].forEach(id => moveField(id, orderGrid));
  const addFrequency = document.getElementById('addFrequency2');
  if (addFrequency) orderGrid.appendChild(addFrequency);

  const liveSection = document.createElement('section');
  liveSection.className = 'conference-section conference-live-section';
  liveSection.innerHTML = `<header><div><span>2</span><strong>Conferir agora</strong></div><small>Atualize apenas o que muda no turno</small></header>
    <div class="conference-reconcile">
      <label for="confReconciledProduction">Produção atual na máquina</label>
      <div><input id="confReconciledProduction" inputmode="numeric" min="0" step="1" value="${formatNumber(productionFrom(source)).replace(/\./g, '')}"><span>peças</span></div>
      <small>Compare com o contador e corrija somente se houver divergência.</small>
    </div>
    <div class="conference-live-grid"></div>`;
  const liveGrid = liveSection.querySelector('.conference-live-grid');
  ['confCurrentBarPieces', 'confFeederBars', 'confPieceLengthMm'].forEach(id => moveField(id, liveGrid));

  const statusField = document.getElementById('confStatus')?.closest('.field');
  if (statusField) {
    statusField.classList.add('conference-status-field');
    liveSection.appendChild(statusField);
    makeStatusButtons(document.getElementById('confStatus'));
  }

  originalGrid.insertAdjacentElement('beforebegin', orderSection);
  orderSection.insertAdjacentElement('afterend', liveSection);
  originalGrid.hidden = true;

  buildStepper(document.getElementById('confFeederBars'));

  const currentBar = document.getElementById('confCurrentBarPieces');
  const length = document.getElementById('confPieceLengthMm');
  [currentBar, length].forEach(input => {
    if (!input) return;
    input.type = 'number';
    input.min = '0';
    input.inputMode = 'decimal';
  });

  if (mode !== 'new') {
    orderSection.insertAdjacentHTML('beforebegin', compactOrderSummary(source, mode));
    orderSection.hidden = true;
    form.dataset.orderCollapsed = 'true';
  }
}

function compactPlanning(form) {
  const planning = document.getElementById('planningPreview');
  if (planning) {
    planning.classList.add('conference-planning-compact');
    planning.querySelectorAll('.planning-preview__grid > div').forEach(tile => {
      const label = tile.querySelector('span')?.textContent.trim() || '';
      const visible = ['Meta considerada', 'Peças por barra inteira', 'Potencial informado'].includes(label);
      tile.hidden = !visible;
    });
    const title = planning.querySelector('.planning-preview__head strong');
    const subtitle = planning.querySelector('.planning-preview__head span');
    if (title) title.textContent = 'Resumo calculado';
    if (subtitle) subtitle.textContent = 'Com os dados informados acima';
  }

  const measurements = document.getElementById('measurementPlanPreview');
  if (measurements) {
    measurements.classList.add('conference-measurements-compact');
    if (!measurements.querySelector('[data-measurement-expand]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'conference-measurement-expand';
      button.dataset.measurementExpand = 'true';
      button.textContent = 'Ver detalhes do plano';
      measurements.appendChild(button);
    }
  }

  const known = form.querySelector('.ops-known-production');
  if (known) known.hidden = true;
}

function updateOrderSummary(form) {
  const summary = form.querySelector('.conference-order-summary');
  if (!summary) return;
  const mode = summary.dataset.mode || 'continuity';
  const source = previousOpenSession(store.state.activeMachineId).source;
  const replacement = document.createElement('div');
  replacement.innerHTML = compactOrderSummary(source, mode);
  summary.replaceWith(replacement.firstElementChild);
}

function enhanceConference() {
  const form = document.getElementById('conferenceForm');
  if (!form) return;

  const requiredIds = ['confOpTarget', 'confCurrentBarPieces', 'confFeederBars', 'confPieceLengthMm', 'planningPreview'];
  if (requiredIds.some(id => !document.getElementById(id))) return;

  const frequency2 = document.getElementById('confFrequency2');
  if (frequency2 && !text(frequency2.value)) {
    frequency2.value = '';
    frequency2.closest('.field').hidden = true;
  }

  if (!form.dataset.compactConferenceReady) {
    form.dataset.compactConferenceReady = 'true';
    const machineId = store.state.activeMachineId;
    const inherited = previousOpenSession(machineId);
    if (inherited.source) hydrateContinuity(inherited.source);
    organizeForm(form, inherited.source, inherited.mode);

    const title = document.querySelector('#conferenceLayer .ops-sheet__head h2');
    const eyebrow = document.querySelector('#conferenceLayer .ops-sheet__head .ops-eyebrow');
    const machine = getMachine(machineId);
    if (inherited.mode === 'continuity') {
      if (title) title.textContent = `Continuar ${machine?.name || 'máquina'}`;
      if (eyebrow) eyebrow.textContent = 'Continuidade da OP';
    }

    form.addEventListener('input', event => {
      if (event.target.id === 'confReconciledProduction') {
        const value = Math.max(0, parseNumber(event.target.value) || 0);
        const known = document.getElementById('knownProduction');
        if (known) known.textContent = formatNumber(value);
      }
      if (['confOp', 'confItem', 'confOpTarget', 'confCycle', 'confFrequency1', 'confFrequency2'].includes(event.target.id)) {
        window.setTimeout(() => updateOrderSummary(form), 0);
      }
    });

    form.addEventListener('submit', event => {
      const input = document.getElementById('confReconciledProduction');
      const value = parseNumber(input?.value);
      if (!Number.isFinite(value) || value < 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const error = document.getElementById('conferenceError');
        if (error) error.textContent = 'Informe a produção atual da máquina.';
        input?.focus();
        return;
      }
      const known = document.getElementById('knownProduction');
      if (known) known.textContent = formatNumber(value);
      pendingReconciliation = { machineId: store.state.activeMachineId, value };
    }, true);
  }

  compactPlanning(form);
}

function stepBars(button) {
  const input = document.getElementById('confFeederBars');
  if (!input) return;
  const delta = Number(button.dataset.stepValue || 0);
  const current = Math.max(0, Math.floor(parseNumber(input.value) || 0));
  input.value = String(Math.max(0, current + delta));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  navigator.vibrate?.(10);
}

function toggleOrder(form) {
  const fields = form.querySelector('.conference-order-fields');
  if (!fields) return;
  fields.hidden = !fields.hidden;
  form.dataset.orderCollapsed = fields.hidden ? 'true' : 'false';
  if (!fields.hidden) document.getElementById('confOp')?.focus();
}

function toggleMeasurements(panel, button) {
  const expanded = panel.classList.toggle('is-expanded');
  button.textContent = expanded ? 'Ocultar detalhes' : 'Ver detalhes do plano';
  button.setAttribute('aria-expanded', String(expanded));
}

function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(enhanceConference);
}

store.subscribe((_state, reason) => {
  if (reason === 'conference-save' && pendingReconciliation) {
    const { machineId, value } = pendingReconciliation;
    pendingReconciliation = null;
    store.update(state => {
      const session = state.machineSessions[machineId];
      if (!session) return;
      state.machineSessions[machineId] = {
        ...session,
        producedSoFar: value,
        reconciledProduction: value,
        reconciledAt: new Date().toISOString(),
        reconciledBy: state.session?.name || ''
      };
    }, 'conference-reconciled');
  }
  schedule();
});

document.addEventListener('click', event => {
  const step = event.target.closest('[data-step-value]');
  if (step) return stepBars(step);

  const status = event.target.closest('[data-status-value]');
  if (status) {
    const select = document.getElementById('confStatus');
    if (!select) return;
    select.value = status.dataset.statusValue;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    status.parentElement.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button === status)));
    return;
  }

  if (event.target.closest('[data-conference-edit-order]')) return toggleOrder(document.getElementById('conferenceForm'));

  const measurementButton = event.target.closest('[data-measurement-expand]');
  if (measurementButton) return toggleMeasurements(measurementButton.closest('.measurement-plan-preview'), measurementButton);
});

new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
schedule();
