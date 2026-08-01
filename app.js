'use strict';

const APP_STORAGE_KEY = 'mes-operadores:v2';
const SLOT_IDS = ['m1', 'm2', 'm3', 'm4'];
const CLOUD_API_URL = String(window.APP_CONFIG?.cloudApiUrl || '').replace(/\/$/, '');

// Cadastro inicial confirmado. Outras linhas e máquinas podem ser adicionadas
// pelo botão "+ Cadastrar", sem inventar ou ocultar equipamentos.
const DEFAULT_CATALOG = [
  {
    id: 'linha-05',
    name: 'Linha 5',
    machines: ['069', '083', '085', '087', '090', '091', '092', '094', '095']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  }
];

const FORM_FIELD_IDS = [
  'f_op', 'f_item', 'f_pecas', 'f_tempo', 'f_seq',
  'f_final', 'f_freq1', 'f_freq2', 'f_minutos', 'f_obs'
];

const initialState = () => ({
  schemaVersion: 2,
  activeView: 'register',
  activeSlot: 'm1',
  operatorName: '',
  shift: detectShift(),
  period: 'today',
  catalog: structuredCloneSafe(DEFAULT_CATALOG),
  slots: Object.fromEntries(SLOT_IDS.map(id => [id, { lineId: '', machineId: '' }])),
  drafts: Object.fromEntries(SLOT_IDS.map(id => [id, {}])),
  records: []
});

let state = loadState();
let toastTimer = null;

const el = id => document.getElementById(id);

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return initialState();
    const saved = JSON.parse(raw);
    const base = initialState();
    return {
      ...base,
      ...saved,
      catalog: Array.isArray(saved.catalog) && saved.catalog.length ? saved.catalog : base.catalog,
      slots: { ...base.slots, ...(saved.slots || {}) },
      drafts: { ...base.drafts, ...(saved.drafts || {}) },
      records: Array.isArray(saved.records) ? saved.records : []
    };
  } catch (error) {
    console.error('Falha ao carregar dados locais:', error);
    return initialState();
  }
}

function persistState() {
  try {
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Falha ao salvar no aparelho:', error);
    setCloudStatus('err', 'Não foi possível salvar neste aparelho. Verifique o espaço do navegador.');
  }
}

function detectShift(date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 390 && minutes < 870) return '1';
  if (minutes >= 870 && minutes < 1350) return '2';
  return '3';
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `rec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `id-${Date.now()}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeMachineName(value) {
  const clean = String(value || '').trim().toUpperCase();
  if (!clean) return '';
  const digits = clean.match(/\d+/)?.[0];
  if (/^\d+$/.test(clean) && digits) return `TNL ${digits.padStart(3, '0')}`;
  if (/^TNL\s*\d+$/.test(clean) && digits) return `TNL ${digits.padStart(3, '0')}`;
  return clean;
}

function parseTempo(value) {
  if (value === null || value === undefined) return NaN;
  const input = String(value).trim();
  if (!input) return NaN;

  let match = input.match(/^(\d+)\s*[:m]\s*(\d{1,2})\s*s?$/i);
  if (match) {
    const minutes = Number.parseInt(match[1], 10);
    const seconds = Number.parseInt(match[2], 10);
    if (seconds >= 60) return NaN;
    return minutes + seconds / 60;
  }

  match = input.match(/^(\d+)\s*s$/i);
  if (match) return Number.parseInt(match[1], 10) / 60;

  const parsed = Number.parseFloat(input.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toNum(value) {
  if (value === null || value === undefined) return NaN;
  const input = String(value).trim().replace(',', '.');
  if (!input) return NaN;
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function fmtTimeFromMinutes(decimalMinutes) {
  if (!Number.isFinite(decimalMinutes) || decimalMinutes <= 0) return '0:00';
  return fmtTimeFromSeconds(Math.round(decimalMinutes * 60));
}

function fmtTimeFromSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function fmtNum(number, decimals = 1) {
  if (!Number.isFinite(number)) return '–';
  return number.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = localDateKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const prefix = dateKey === today ? 'Hoje' : dateKey === localDateKey(yesterdayDate) ? 'Ontem' : '';
  const formatted = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return prefix ? `${prefix} · ${formatted}` : formatted;
}

function formatTimeLabel(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '–' : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function calculate(fields) {
  const base = Number.isFinite(fields.availableMinutes) && fields.availableMinutes > 0
    ? fields.availableMinutes
    : 480;
  const target = fields.cycleMinutes > 0 ? base / fields.cycleMinutes : NaN;
  const expectedProduction = Number.isFinite(fields.pieces) && Number.isFinite(target)
    ? fields.pieces + target
    : NaN;
  const release1 = Number.isFinite(expectedProduction) && fields.frequency1 > 0
    ? expectedProduction / fields.frequency1
    : NaN;
  const release2 = Number.isFinite(expectedProduction) && fields.frequency2 > 0
    ? expectedProduction / fields.frequency2
    : NaN;
  const balance = Number.isFinite(fields.finalProduction) && Number.isFinite(target)
    ? fields.finalProduction - target
    : NaN;
  const balanceMinutes = Number.isFinite(balance) && Number.isFinite(fields.cycleMinutes)
    ? balance * fields.cycleMinutes
    : NaN;
  return { base, target, expectedProduction, release1, release2, balance, balanceMinutes };
}

function getFormFields() {
  return {
    op: el('f_op').value.trim(),
    item: el('f_item').value.trim(),
    pieces: toNum(el('f_pecas').value),
    cycleMinutes: parseTempo(el('f_tempo').value),
    sequence: el('f_seq').value.trim(),
    finalProduction: toNum(el('f_final').value),
    frequency1: toNum(el('f_freq1').value),
    frequency2: toNum(el('f_freq2').value),
    availableMinutes: toNum(el('f_minutos').value),
    notes: el('f_obs').value.trim()
  };
}

function getLine(lineId) {
  return state.catalog.find(line => line.id === lineId) || null;
}

function getMachine(lineId, machineId) {
  return getLine(lineId)?.machines?.find(machine => machine.id === machineId) || null;
}

function currentSlot() {
  return state.slots[state.activeSlot];
}

function getCurrentContext() {
  const slot = currentSlot();
  const line = getLine(slot.lineId);
  const machine = getMachine(slot.lineId, slot.machineId);
  return { slot, line, machine };
}

function saveDraft() {
  const draft = {};
  FORM_FIELD_IDS.forEach(id => { draft[id] = el(id).value; });
  state.drafts[state.activeSlot] = draft;
  persistState();
}

function loadDraft() {
  const draft = state.drafts[state.activeSlot] || {};
  FORM_FIELD_IDS.forEach(id => { el(id).value = draft[id] || ''; });
}

function setFormMessage(message = '', type = 'error') {
  const box = el('formMessage');
  box.textContent = message;
  box.className = `form-message${message ? ` show ${type}` : ''}`;
}

function showToast(message) {
  const toast = el('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function setCloudStatus(stateName, customText = '') {
  const status = el('cloudStatus');
  if (customText) {
    status.textContent = customText;
    status.className = `cloud-status ${stateName}`;
    return;
  }

  if (stateName === 'ok') {
    status.textContent = '☁️ Cloudflare conectado · dados sincronizados';
    status.className = 'cloud-status ok';
  } else if (stateName === 'err') {
    status.textContent = '🔴 Falha na nuvem · dados preservados neste aparelho';
    status.className = 'cloud-status err';
  } else {
    status.textContent = '📱 Salvo neste aparelho · Cloudflare ainda não conectado';
    status.className = 'cloud-status off';
  }
}

function renderNavigation() {
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  el(state.activeView === 'history' ? 'viewHistory' : 'viewRegister').classList.add('active');
  document.querySelector(`.nav-item[data-view="${state.activeView}"]`)?.classList.add('active');
  if (state.activeView === 'history') renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderMachineTabs() {
  const container = el('machineTabs');
  container.innerHTML = SLOT_IDS.map((slotId, index) => {
    const slot = state.slots[slotId];
    const machine = getMachine(slot.lineId, slot.machineId);
    const line = getLine(slot.lineId);
    const active = slotId === state.activeSlot ? ' active' : '';
    return `
      <button class="machine-tab${active}" type="button" data-slot="${slotId}">
        <strong>${escapeHtml(machine?.name || `Máquina ${index + 1}`)}</strong>
        <span>${escapeHtml(line?.name || 'não definida')}</span>
      </button>`;
  }).join('');

  container.querySelectorAll('[data-slot]').forEach(button => {
    button.addEventListener('click', () => switchSlot(button.dataset.slot));
  });
}

function fillLineSelect(select, selectedValue = '', includeAll = false) {
  const options = [];
  if (includeAll) options.push('<option value="">Todas as linhas</option>');
  else options.push('<option value="">Selecione a linha</option>');

  state.catalog.forEach(line => {
    options.push(`<option value="${escapeHtml(line.id)}">${escapeHtml(line.name)}</option>`);
  });
  select.innerHTML = options.join('');
  select.value = selectedValue;
}

function fillMachineSelect(select, lineId, selectedValue = '', includeAll = false) {
  const line = getLine(lineId);
  const options = [];
  if (includeAll) options.push('<option value="">Todas as máquinas</option>');
  else options.push(`<option value="">${lineId ? 'Selecione a máquina' : 'Selecione uma linha primeiro'}</option>`);

  (line?.machines || []).forEach(machine => {
    options.push(`<option value="${escapeHtml(machine.id)}">${escapeHtml(machine.name)}</option>`);
  });
  select.innerHTML = options.join('');
  select.disabled = !includeAll && !lineId;
  select.value = selectedValue;
}

function renderContextSelectors() {
  const slot = currentSlot();
  fillLineSelect(el('f_line'), slot.lineId, false);
  fillMachineSelect(el('f_machine'), slot.lineId, slot.machineId, false);
  const line = getLine(slot.lineId);
  const machine = getMachine(slot.lineId, slot.machineId);
  el('machineContextHint').textContent = machine
    ? `${machine.name} vinculada à ${line.name} neste posto.`
    : 'Selecione a linha e depois a máquina deste posto.';
}

function switchSlot(slotId) {
  if (!SLOT_IDS.includes(slotId) || slotId === state.activeSlot) return;
  saveDraft();
  state.activeSlot = slotId;
  loadDraft();
  renderMachineTabs();
  renderContextSelectors();
  updateCalculations();
  renderLatest();
  persistState();
}

function updateCalculations() {
  const fields = getFormFields();
  const calc = calculate(fields);
  el('readoutTime').textContent = fmtTimeFromMinutes(fields.cycleMinutes);
  el('readoutDecimal').textContent = Number.isFinite(fields.cycleMinutes) ? fmtNum(fields.cycleMinutes, 2) : '0';
  el('c_meta').textContent = fmtNum(calc.target, 1);
  el('c_esperada').textContent = fmtNum(calc.expectedProduction, 1);
  el('c_lib1').textContent = fmtNum(calc.release1, 2);
  el('c_lib2').textContent = fmtNum(calc.release2, 2);

  const balanceElement = el('c_saldo');
  balanceElement.textContent = fmtNum(calc.balance, 1);
  balanceElement.className = `v${calc.balance > 0 ? ' pos' : calc.balance < 0 ? ' neg' : ''}`;

  const balanceMinutesElement = el('c_tempomin');
  balanceMinutesElement.textContent = Number.isFinite(calc.balanceMinutes)
    ? `${calc.balanceMinutes >= 0 ? '+' : ''}${fmtNum(calc.balanceMinutes, 1)} min`
    : '–';
  balanceMinutesElement.className = `v${calc.balanceMinutes > 0 ? ' pos' : calc.balanceMinutes < 0 ? ' neg' : ''}`;

  const used = minutesUsedTodayForCurrentMachine();
  const remaining = Math.max(480 - used, 0);
  el('hintRestante').innerHTML = `Já apontados hoje: <b>${fmtNum(used, 0)} min</b> · Restam <b>${fmtNum(remaining, 0)} min</b>`;
}

function minutesUsedTodayForCurrentMachine() {
  const { line, machine } = getCurrentContext();
  if (!line || !machine) return 0;
  return state.records
    .filter(record => record.status !== 'cancelled')
    .filter(record => record.productionDate === localDateKey())
    .filter(record => record.lineId === line.id && record.machineId === machine.id)
    .reduce((sum, record) => sum + (Number(record.availableMinutes) || 0), 0);
}

function validateRecord(fields) {
  const { line, machine } = getCurrentContext();
  if (!state.operatorName.trim()) return 'Informe o nome do operador.';
  if (!line) return 'Selecione a linha.';
  if (!machine) return 'Selecione a máquina.';
  if (!fields.op) return 'Informe a OP.';
  if (!fields.item) return 'Informe o número do item.';
  if (!Number.isFinite(fields.cycleMinutes) || fields.cycleMinutes <= 0) return 'Informe um tempo de ciclo válido.';
  if (!Number.isFinite(fields.finalProduction)) return 'Informe a produção final.';
  return '';
}

function buildRecord(fields) {
  const { line, machine } = getCurrentContext();
  const calc = calculate(fields);
  const now = new Date();
  return {
    id: createId(),
    schemaVersion: 2,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    productionDate: localDateKey(now),
    source: 'mes-operadores',
    operatorName: state.operatorName.trim(),
    shift: state.shift,
    slotId: state.activeSlot,
    lineId: line.id,
    lineName: line.name,
    machineId: machine.id,
    machineName: machine.name,
    op: fields.op,
    item: fields.item,
    sequence: fields.sequence,
    pieces: Number.isFinite(fields.pieces) ? fields.pieces : null,
    finalProduction: Number.isFinite(fields.finalProduction) ? fields.finalProduction : null,
    cycleTimeSeconds: Math.round(fields.cycleMinutes * 60),
    availableMinutes: calc.base,
    frequency1: Number.isFinite(fields.frequency1) ? fields.frequency1 : null,
    frequency2: Number.isFinite(fields.frequency2) ? fields.frequency2 : null,
    target: Number.isFinite(calc.target) ? calc.target : null,
    expectedProduction: Number.isFinite(calc.expectedProduction) ? calc.expectedProduction : null,
    release1: Number.isFinite(calc.release1) ? calc.release1 : null,
    release2: Number.isFinite(calc.release2) ? calc.release2 : null,
    balance: Number.isFinite(calc.balance) ? calc.balance : null,
    balanceMinutes: Number.isFinite(calc.balanceMinutes) ? calc.balanceMinutes : null,
    notes: fields.notes,
    status: 'active',
    syncStatus: CLOUD_API_URL ? 'pending' : 'local'
  };
}

async function saveRecord() {
  setFormMessage();
  const fields = getFormFields();
  const validationError = validateRecord(fields);
  if (validationError) {
    setFormMessage(validationError, 'error');
    return;
  }

  const record = buildRecord(fields);
  state.records.push(record);
  state.drafts[state.activeSlot] = {};
  FORM_FIELD_IDS.forEach(id => { el(id).value = ''; });
  persistState();
  updateCalculations();
  renderMachineTabs();
  renderLatest();
  setFormMessage('Registro salvo com sucesso neste aparelho.', 'success');
  showToast(`${record.machineName} · OP ${record.op} salva`);

  if (CLOUD_API_URL) await syncRecord(record);
}

function recordsForCurrentMachine() {
  const { line, machine } = getCurrentContext();
  if (!line || !machine) return [];
  return state.records
    .filter(record => record.lineId === line.id && record.machineId === machine.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function balanceClass(balance) {
  if (Number(balance) > 0) return 'pos';
  if (Number(balance) < 0) return 'neg';
  return '';
}

function renderLatest() {
  const list = el('latestList');
  const records = recordsForCurrentMachine().slice(0, 5);
  el('latestCount').textContent = String(records.length);

  if (!getCurrentContext().machine) {
    list.innerHTML = '<div class="empty">Selecione uma linha e uma máquina para visualizar os últimos lançamentos.</div>';
    return;
  }
  if (!records.length) {
    list.innerHTML = '<div class="empty">Nenhum lançamento nesta máquina.<br>O primeiro registro aparecerá aqui.</div>';
    return;
  }

  list.innerHTML = records.map(record => {
    const cancelled = record.status === 'cancelled';
    return `
      <article class="entry ${balanceClass(record.balance)}${cancelled ? ' cancelled' : ''}">
        <div class="entry-top">
          <div class="entry-title">${escapeHtml(record.machineName)} · OP ${escapeHtml(record.op)}<br>Item ${escapeHtml(record.item)}</div>
          <div class="entry-time">${escapeHtml(formatTimeLabel(record.createdAt))}</div>
        </div>
        <div class="entry-grid">
          <div>Tempo<span>${escapeHtml(fmtTimeFromSeconds(record.cycleTimeSeconds))}</span></div>
          <div>Prod. final<span>${escapeHtml(fmtNum(record.finalProduction, 0))}</span></div>
          <div>Meta<span>${escapeHtml(fmtNum(record.target, 1))}</span></div>
          <div>Saldo<span class="${record.balance > 0 ? 'positive' : record.balance < 0 ? 'negative' : ''}">${escapeHtml(fmtNum(record.balance, 1))}</span></div>
          <div>Turno<span>${escapeHtml(record.shift)}º</span></div>
          <div>Operador<span>${escapeHtml(record.operatorName)}</span></div>
        </div>
        ${record.notes ? `<div class="entry-obs"><b>Obs.:</b> ${escapeHtml(record.notes)}</div>` : ''}
        ${cancelled ? '<span class="status-pill">REGISTRO CANCELADO</span>' : `
          <div class="entry-actions"><button class="cancel-button" type="button" data-cancel-record="${escapeHtml(record.id)}">Cancelar registro</button></div>`}
      </article>`;
  }).join('');
  bindCancelButtons(list);
}

function getAllHistoryLines() {
  const map = new Map(state.catalog.map(line => [line.id, { id: line.id, name: line.name }]));
  state.records.forEach(record => {
    if (record.lineId && !map.has(record.lineId)) map.set(record.lineId, { id: record.lineId, name: record.lineName || record.lineId });
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
}

function getAllHistoryMachines(lineId) {
  const map = new Map();
  const catalogLines = lineId ? state.catalog.filter(line => line.id === lineId) : state.catalog;
  catalogLines.forEach(line => (line.machines || []).forEach(machine => map.set(machine.id, { ...machine, lineId: line.id })));
  state.records.forEach(record => {
    if ((!lineId || record.lineId === lineId) && record.machineId && !map.has(record.machineId)) {
      map.set(record.machineId, { id: record.machineId, name: record.machineName || record.machineId, lineId: record.lineId });
    }
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
}

function renderHistoryFilters(preserve = true) {
  const lineSelect = el('historyLine');
  const machineSelect = el('historyMachine');
  const oldLine = preserve ? lineSelect.value : '';
  const oldMachine = preserve ? machineSelect.value : '';

  lineSelect.innerHTML = '<option value="">Todas as linhas</option>' + getAllHistoryLines()
    .map(line => `<option value="${escapeHtml(line.id)}">${escapeHtml(line.name)}</option>`)
    .join('');
  lineSelect.value = oldLine;

  const machines = getAllHistoryMachines(lineSelect.value);
  machineSelect.innerHTML = '<option value="">Todas as máquinas</option>' + machines
    .map(machine => `<option value="${escapeHtml(machine.id)}">${escapeHtml(machine.name)}</option>`)
    .join('');
  machineSelect.value = machines.some(machine => machine.id === oldMachine) ? oldMachine : '';
}

function isRecordInPeriod(record, period) {
  if (period === 'all') return true;
  const date = new Date(`${record.productionDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (period === 'today') return record.productionDate === localDateKey(today);
  if (period === '7days') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return date >= start && date <= today;
  }
  if (period === 'month') return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  return true;
}

function filteredHistoryRecords() {
  const lineId = el('historyLine').value;
  const machineId = el('historyMachine').value;
  const query = el('historySearch').value.trim().toLocaleLowerCase('pt-BR');

  return state.records
    .filter(record => isRecordInPeriod(record, state.period))
    .filter(record => !lineId || record.lineId === lineId)
    .filter(record => !machineId || record.machineId === machineId)
    .filter(record => {
      if (!query) return true;
      return [record.op, record.item, record.operatorName, record.lineName, record.machineName, record.notes]
        .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query));
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderHistory() {
  renderHistoryFilters(true);
  document.querySelectorAll('.period-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.period === state.period);
  });

  const records = filteredHistoryRecords();
  const activeRecords = records.filter(record => record.status !== 'cancelled');
  const totalProduction = activeRecords.reduce((sum, record) => sum + (Number(record.finalProduction) || 0), 0);
  const totalTarget = activeRecords.reduce((sum, record) => sum + (Number(record.target) || 0), 0);
  const totalBalance = activeRecords.reduce((sum, record) => sum + (Number(record.balance) || 0), 0);

  el('summaryRecords').textContent = fmtNum(activeRecords.length, 0);
  el('summaryProduction').textContent = fmtNum(totalProduction, 0);
  el('summaryTarget').textContent = fmtNum(totalTarget, 1);
  el('summaryBalance').textContent = `${totalBalance > 0 ? '+' : ''}${fmtNum(totalBalance, 1)}`;
  el('summaryBalance').className = totalBalance > 0 ? 'positive' : totalBalance < 0 ? 'negative' : '';
  el('historyResultLabel').textContent = records.length === 1 ? '1 registro encontrado' : `${records.length} registros encontrados`;

  const list = el('historyList');
  if (!records.length) {
    list.innerHTML = '<div class="empty">Nenhum registro encontrado com esses filtros.</div>';
    return;
  }

  const groups = records.reduce((accumulator, record) => {
    (accumulator[record.productionDate] ||= []).push(record);
    return accumulator;
  }, {});

  list.innerHTML = Object.entries(groups).map(([dateKey, dayRecords]) => `
    <div class="history-day">${escapeHtml(formatDateLabel(dateKey))}</div>
    ${dayRecords.map(renderHistoryEntry).join('')}
  `).join('');
  bindCancelButtons(list);
}

function renderHistoryEntry(record) {
  const cancelled = record.status === 'cancelled';
  const balanceText = `${record.balance > 0 ? '+' : ''}${fmtNum(record.balance, 1)}`;
  return `
    <details class="history-entry ${balanceClass(record.balance)}${cancelled ? ' cancelled' : ''}">
      <summary>
        <div class="history-summary-row">
          <div class="history-main">
            <strong>${escapeHtml(record.machineName)} · OP ${escapeHtml(record.op)}</strong>
            <span>${escapeHtml(record.lineName)} · Item ${escapeHtml(record.item)} · ${escapeHtml(record.operatorName)}</span>
          </div>
          <div class="history-side">
            <strong class="${record.balance > 0 ? 'positive' : record.balance < 0 ? 'negative' : ''}">${escapeHtml(balanceText)}</strong>
            <span>${escapeHtml(formatTimeLabel(record.createdAt))}</span>
          </div>
        </div>
        ${cancelled ? '<span class="status-pill">CANCELADO</span>' : ''}
      </summary>
      <div class="history-details">
        <div class="detail-grid">
          <div class="detail-cell"><span>Linha</span><strong>${escapeHtml(record.lineName)}</strong></div>
          <div class="detail-cell"><span>Máquina</span><strong>${escapeHtml(record.machineName)}</strong></div>
          <div class="detail-cell"><span>Operador</span><strong>${escapeHtml(record.operatorName)}</strong></div>
          <div class="detail-cell"><span>Turno</span><strong>${escapeHtml(record.shift)}º turno</strong></div>
          <div class="detail-cell"><span>OP</span><strong>${escapeHtml(record.op)}</strong></div>
          <div class="detail-cell"><span>Item</span><strong>${escapeHtml(record.item)}</strong></div>
          <div class="detail-cell"><span>Sequência</span><strong>${escapeHtml(record.sequence || '–')}</strong></div>
          <div class="detail-cell"><span>Tempo de ciclo</span><strong>${escapeHtml(fmtTimeFromSeconds(record.cycleTimeSeconds))}</strong></div>
          <div class="detail-cell"><span>Peças feitas</span><strong>${escapeHtml(fmtNum(record.pieces, 0))}</strong></div>
          <div class="detail-cell"><span>Produção final</span><strong>${escapeHtml(fmtNum(record.finalProduction, 0))}</strong></div>
          <div class="detail-cell"><span>Meta</span><strong>${escapeHtml(fmtNum(record.target, 1))}</strong></div>
          <div class="detail-cell"><span>Saldo</span><strong>${escapeHtml(balanceText)}</strong></div>
          <div class="detail-cell"><span>Liberação I</span><strong>${escapeHtml(fmtNum(record.release1, 2))}</strong></div>
          <div class="detail-cell"><span>Liberação II</span><strong>${escapeHtml(fmtNum(record.release2, 2))}</strong></div>
          <div class="detail-cell"><span>Minutos disponíveis</span><strong>${escapeHtml(fmtNum(record.availableMinutes, 0))}</strong></div>
          <div class="detail-cell"><span>Ganho/perda</span><strong>${escapeHtml(fmtNum(record.balanceMinutes, 1))} min</strong></div>
        </div>
        ${record.notes ? `<div class="entry-obs"><b>Observações:</b> ${escapeHtml(record.notes)}</div>` : ''}
        ${!cancelled ? `<div class="entry-actions"><button class="cancel-button" type="button" data-cancel-record="${escapeHtml(record.id)}">Cancelar registro</button></div>` : ''}
      </div>
    </details>`;
}

function bindCancelButtons(container) {
  container.querySelectorAll('[data-cancel-record]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      cancelRecord(button.dataset.cancelRecord);
    });
  });
}

async function cancelRecord(recordId) {
  const record = state.records.find(item => item.id === recordId);
  if (!record || record.status === 'cancelled') return;
  const reason = prompt('Motivo do cancelamento deste registro:');
  if (reason === null) return;
  if (!reason.trim()) {
    showToast('Informe o motivo do cancelamento.');
    return;
  }
  record.status = 'cancelled';
  record.cancelReason = reason.trim();
  record.cancelledAt = new Date().toISOString();
  record.updatedAt = new Date().toISOString();
  record.syncStatus = CLOUD_API_URL ? 'pending' : 'local';
  persistState();
  renderLatest();
  renderHistory();
  updateCalculations();
  showToast('Registro cancelado e mantido no histórico.');
  if (CLOUD_API_URL) await syncRecord(record);
}

function openCatalogDialog() {
  const existing = el('catalogExistingLine');
  existing.innerHTML = '<option value="">Selecione uma linha existente</option>' + state.catalog
    .map(line => `<option value="${escapeHtml(line.id)}">${escapeHtml(line.name)}</option>`)
    .join('');
  existing.value = currentSlot().lineId || '';
  el('catalogNewLine').value = '';
  el('catalogMachine').value = '';
  el('catalogMessage').textContent = '';
  el('catalogMessage').className = 'form-message';
  el('catalogDialog').showModal();
}

function addCatalogItem(event) {
  event.preventDefault();
  const existingLineId = el('catalogExistingLine').value;
  const newLineName = el('catalogNewLine').value.trim();
  const machineName = normalizeMachineName(el('catalogMachine').value);
  const message = el('catalogMessage');

  if (!existingLineId && !newLineName) {
    message.textContent = 'Selecione uma linha existente ou informe uma nova linha.';
    message.className = 'form-message show error';
    return;
  }
  if (!machineName) {
    message.textContent = 'Informe a máquina/TNL.';
    message.className = 'form-message show error';
    return;
  }

  let line = getLine(existingLineId);
  if (!line) {
    const baseId = slugify(newLineName);
    let lineId = baseId;
    let counter = 2;
    while (getLine(lineId)) lineId = `${baseId}-${counter++}`;
    line = { id: lineId, name: newLineName, machines: [] };
    state.catalog.push(line);
  }

  let machine = line.machines.find(item => item.name.toLocaleLowerCase('pt-BR') === machineName.toLocaleLowerCase('pt-BR'));
  if (!machine) {
    const baseId = slugify(machineName);
    let machineId = baseId;
    let counter = 2;
    while (line.machines.some(item => item.id === machineId)) machineId = `${baseId}-${counter++}`;
    machine = { id: machineId, name: machineName };
    line.machines.push(machine);
    line.machines.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  }

  state.slots[state.activeSlot] = { lineId: line.id, machineId: machine.id };
  persistState();
  el('catalogDialog').close();
  renderMachineTabs();
  renderContextSelectors();
  renderHistoryFilters(false);
  renderLatest();
  updateCalculations();
  showToast(`${machine.name} cadastrada em ${line.name}`);
}

function clearHistoryFilters() {
  el('historyLine').value = '';
  renderHistoryFilters(true);
  el('historyMachine').value = '';
  el('historySearch').value = '';
  state.period = 'today';
  persistState();
  renderHistory();
}

async function checkCloudConnection() {
  if (!CLOUD_API_URL) {
    setCloudStatus('off');
    return;
  }
  try {
    const response = await fetch(`${CLOUD_API_URL}/health`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setCloudStatus('ok');
    await pullCloudRecords();
    await syncPendingRecords();
  } catch (error) {
    console.error('Cloudflare indisponível:', error);
    setCloudStatus('err');
  }
}

async function pullCloudRecords() {
  if (!CLOUD_API_URL) return;
  try {
    const response = await fetch(`${CLOUD_API_URL}/api/v1/records`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const cloudRecords = Array.isArray(payload) ? payload : payload.records;
    if (!Array.isArray(cloudRecords)) return;

    const map = new Map(state.records.map(record => [record.id, record]));
    cloudRecords.forEach(record => {
      const local = map.get(record.id);
      if (!local || new Date(record.updatedAt || record.createdAt) >= new Date(local.updatedAt || local.createdAt)) {
        map.set(record.id, { ...record, syncStatus: 'synced' });
      }
    });
    state.records = [...map.values()];
    persistState();
    renderLatest();
    if (state.activeView === 'history') renderHistory();
  } catch (error) {
    console.error('Falha ao baixar histórico:', error);
  }
}

async function syncRecord(record) {
  if (!CLOUD_API_URL) return;
  try {
    const response = await fetch(`${CLOUD_API_URL}/api/v1/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(record)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    record.syncStatus = 'synced';
    persistState();
    setCloudStatus('ok');
  } catch (error) {
    record.syncStatus = 'error';
    persistState();
    setCloudStatus('err');
    console.error('Falha ao sincronizar registro:', error);
  }
}

async function syncPendingRecords() {
  const pending = state.records.filter(record => record.syncStatus !== 'synced');
  for (const record of pending) await syncRecord(record);
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => {
      state.activeView = button.dataset.view;
      persistState();
      renderNavigation();
    });
  });

  FORM_FIELD_IDS.forEach(id => {
    el(id).addEventListener('input', () => {
      updateCalculations();
      saveDraft();
      setFormMessage();
    });
  });

  el('f_operator').addEventListener('input', event => {
    state.operatorName = event.target.value;
    persistState();
  });

  el('f_shift').addEventListener('change', event => {
    state.shift = event.target.value;
    el('activeShiftBadge').textContent = `${state.shift}º turno`;
    persistState();
  });

  el('f_line').addEventListener('change', event => {
    const slot = currentSlot();
    slot.lineId = event.target.value;
    slot.machineId = '';
    persistState();
    renderMachineTabs();
    renderContextSelectors();
    renderLatest();
    updateCalculations();
  });

  el('f_machine').addEventListener('change', event => {
    currentSlot().machineId = event.target.value;
    persistState();
    renderMachineTabs();
    renderContextSelectors();
    renderLatest();
    updateCalculations();
  });

  el('btnSave').addEventListener('click', saveRecord);
  el('btnTrocarOp').addEventListener('click', () => {
    const remaining = Math.max(480 - minutesUsedTodayForCurrentMachine(), 0);
    ['f_op', 'f_pecas', 'f_final', 'f_obs'].forEach(id => { el(id).value = ''; });
    el('f_minutos').value = String(remaining);
    saveDraft();
    updateCalculations();
    el('f_op').focus();
  });

  el('btnOpenCatalog').addEventListener('click', openCatalogDialog);
  el('catalogForm').addEventListener('submit', addCatalogItem);

  el('historyLine').addEventListener('change', () => {
    renderHistoryFilters(true);
    renderHistory();
  });
  el('historyMachine').addEventListener('change', renderHistory);
  el('historySearch').addEventListener('input', renderHistory);
  el('periodTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-period]');
    if (!button) return;
    state.period = button.dataset.period;
    persistState();
    renderHistory();
  });
  el('btnClearHistoryFilters').addEventListener('click', clearHistoryFilters);
  el('btnRefreshHistory').addEventListener('click', async () => {
    if (CLOUD_API_URL) await pullCloudRecords();
    renderHistory();
    showToast(CLOUD_API_URL ? 'Histórico atualizado.' : 'Histórico local atualizado.');
  });
}

function initialize() {
  el('f_operator').value = state.operatorName;
  el('f_shift').value = state.shift;
  el('activeShiftBadge').textContent = `${state.shift}º turno`;
  loadDraft();
  renderMachineTabs();
  renderContextSelectors();
  renderHistoryFilters(false);
  updateCalculations();
  renderLatest();
  bindEvents();
  renderNavigation();
  checkCloudConnection();
}

initialize();
