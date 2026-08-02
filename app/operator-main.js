import {
  store, api, API_BASE, uid, localDateKey, formatDate, formatClock, formatNumber,
  parseNumber, parseCycle, formatCycle, detectShift, minutesRemaining, getLine,
  getMachine, currentMachineSession, calculateSession, loadCloudCatalog,
  loadCloudRecords, loginOperator, loadAssignments, saveAssignments,
  getShiftContext, productionTotalFromRecords
} from './core.js';
import { escapeHtml, icon, statusMeta } from './components.js';

const app = document.getElementById('app');
const layers = document.getElementById('layers');
const toastRegion = document.getElementById('toastRegion');

const ROUTES = new Set(['turn', 'history', 'more']);
const STATUS_OPTIONS = [
  ['producing', 'Produzindo', 'Operação normal informada'],
  ['setup', 'Setup', 'Preparação ou troca em andamento'],
  ['adjustment', 'Ajuste', 'Correção ou regulagem em andamento'],
  ['stopped', 'Parada', 'Máquina sem produzir'],
  ['maintenance', 'Manutenção', 'Atendimento técnico ou manutenção']
];

let returnFocus = null;
let toastTimer = null;
let installPrompt = null;
let assignmentDraft = [];
let assignmentStage = 'review';
let assignmentLineId = '';
let conferenceDraft = null;
let batchDraft = {};
let batchStage = 'entry';
let nextOrderPreset = null;

function activeRoute() {
  const route = store.state.ui?.route;
  return ROUTES.has(route) ? route : 'turn';
}

function setRoute(route) {
  if (!ROUTES.has(route)) return;
  store.update(state => {
    state.ui ||= {};
    state.ui.route = route;
  }, 'route');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message) {
  clearTimeout(toastTimer);
  toastRegion.innerHTML = `<div class="toast is-visible" role="status">${escapeHtml(message)}</div>`;
  toastTimer = window.setTimeout(() => { toastRegion.innerHTML = ''; }, 2800);
}

function closeLayer(restore = true) {
  layers.innerHTML = '';
  document.body.classList.remove('has-layer');
  if (restore) returnFocus?.focus?.({ preventScroll: true });
}

function openLayer(content, id = 'opsLayer') {
  closeLayer(false);
  returnFocus = document.activeElement;
  layers.innerHTML = `<div class="ops-layer" id="${id}">${content}</div>`;
  document.body.classList.add('has-layer');
  window.setTimeout(() => {
    layers.querySelector('input, select, textarea, button')?.focus?.({ preventScroll: true });
  }, 30);
}

function sheet({ title, eyebrow = '', body = '', actions = '', size = 'normal' }) {
  return `<section class="ops-sheet ops-sheet--${size}" role="dialog" aria-modal="true" aria-labelledby="opsSheetTitle">
    <header class="ops-sheet__head">
      <div>${eyebrow ? `<p class="ops-eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h2 id="opsSheetTitle">${escapeHtml(title)}</h2></div>
      <button class="ops-icon-btn" type="button" data-close-layer aria-label="Fechar">×</button>
    </header>
    <div class="ops-sheet__body">${body}</div>
    ${actions ? `<footer class="ops-sheet__actions">${actions}</footer>` : ''}
  </section>`;
}

function syncMeta(state) {
  if (!API_BASE) return { state: 'local', label: 'Modo local' };
  if (!state.sync.online) return { state: 'offline', label: 'Sem conexão' };
  if (state.syncQueue.length) return { state: 'pending', label: `${state.syncQueue.length} pendência${state.syncQueue.length === 1 ? '' : 's'}` };
  if (state.sync.status === 'error') return { state: 'error', label: 'Erro ao sincronizar' };
  return { state: 'synced', label: 'Sincronizado' };
}

function flowState(session) {
  if (!session) return { key: 'conference', label: 'Conferência pendente', tone: 'warning' };
  if (session.status === 'pointed') return { key: 'pointed', label: 'Apontamento concluído', tone: 'brand' };
  if (session.status === 'closed') return { key: 'closed', label: 'OP encerrada', tone: 'neutral' };
  return { key: 'ready', label: 'Pronta para o turno', tone: 'success' };
}

function situationLabel(session) {
  if (!session) return 'Não informada';
  return statusMeta(session.status || 'producing').label;
}

function manualUpdateText(session) {
  if (!session) return '';
  const when = session.updatedAt || session.checkedAt;
  const who = session.operatorName || store.state.session?.name || '';
  return `Informada ${when ? `às ${formatClock(when)}` : ''}${who ? ` por ${who}` : ''}`.trim();
}

function currentShiftRecords(machineId) {
  const session = store.state.session;
  if (!session) return [];
  return store.state.records.filter(record =>
    record.status !== 'cancelled' &&
    record.machineId === machineId &&
    String(record.productionDate || '') === String(session.productionDate || localDateKey()) &&
    String(record.shift || '') === String(session.shift)
  );
}

function hasPointing(machineId) {
  const session = currentMachineSession(machineId);
  if (['pointed', 'closed'].includes(session?.status)) return true;
  return currentShiftRecords(machineId).some(record => ['shift-pointing', 'order-close'].includes(record.eventType));
}

function pendingCounts() {
  const assignments = store.state.assignments;
  const conference = assignments.filter(item => !currentMachineSession(item.machineId)).length;
  const pointing = assignments.filter(item => currentMachineSession(item.machineId) && !hasPointing(item.machineId)).length;
  return { conference, pointing, sync: store.state.syncQueue.length };
}

function renderHeader() {
  const state = store.state;
  const session = state.session;
  const sync = syncMeta(state);
  return `<header class="ops-header">
    <div class="ops-brand">
      <div class="ops-brand__mark">NM</div>
      <div><strong>NEODENT MES</strong><span>Registro operacional do turno</span></div>
    </div>
    <div class="ops-header__actions">
      <button class="ops-shift" type="button" data-action="change-shift">${escapeHtml(session?.shift || '—')}º turno</button>
      <button class="ops-sync" type="button" data-action="sync" data-state="${sync.state}" aria-label="${escapeHtml(sync.label)}"><span></span></button>
      <button class="ops-icon-btn" type="button" data-action="menu" aria-label="Abrir menu">${icon('menu')}</button>
    </div>
  </header>`;
}

function renderConnection() {
  const sync = syncMeta(store.state);
  if (sync.state === 'synced') return '';
  const details = {
    local: 'Os dados ficam somente neste aparelho. Use o endereço Cloudflare para compartilhar.',
    offline: 'Os lançamentos ficarão pendentes e serão enviados quando a internet voltar.',
    pending: 'Existem registros aguardando envio para a nuvem.',
    error: store.state.sync.error || 'Não foi possível sincronizar.'
  };
  return `<div class="ops-connection" data-state="${sync.state}">
    <div><strong>${escapeHtml(sync.label)}</strong><span>${escapeHtml(details[sync.state] || '')}</span></div>
    <button type="button" data-action="sync">Tentar agora</button>
  </div>`;
}

function renderSessionLine() {
  const session = store.state.session;
  if (!session) return '';
  return `<section class="ops-session">
    <div>
      <strong>${escapeHtml(session.name)}</strong>
      <span>Matrícula ${escapeHtml(session.registration)} · ${escapeHtml(session.shift)}º turno · ${formatDate(session.productionDate)}</span>
    </div>
    <button type="button" data-action="assign-machines">${store.state.assignments.length} máquina${store.state.assignments.length === 1 ? '' : 's'}</button>
  </section>`;
}

function renderPendingSummary() {
  const counts = pendingCounts();
  const total = counts.conference + counts.pointing + counts.sync;
  if (!total) return `<section class="ops-ready">
    <span aria-hidden="true">✓</span>
    <div><strong>Turno organizado</strong><p>Não há pendências de preenchimento neste momento.</p></div>
  </section>`;
  const rows = [];
  if (counts.conference) rows.push(`${counts.conference} conferência${counts.conference === 1 ? '' : 's'} pendente${counts.conference === 1 ? '' : 's'}`);
  if (counts.pointing) rows.push(`${counts.pointing} apontamento${counts.pointing === 1 ? '' : 's'} para o fechamento`);
  if (counts.sync) rows.push(`${counts.sync} registro${counts.sync === 1 ? '' : 's'} aguardando sincronização`);
  return `<section class="ops-pending">
    <div><p class="ops-eyebrow">Próximas ações</p><strong>${rows.join(' · ')}</strong></div>
    ${counts.conference ? '<button type="button" data-action="open-first-conference">Conferir agora</button>' : ''}
  </section>`;
}

function renderMachineCard(assignment) {
  const machine = getMachine(assignment.machineId);
  const session = currentMachineSession(assignment.machineId);
  if (!machine) return '';
  const flow = flowState(session);

  if (!session) return `<article class="ops-machine-card" data-flow="conference">
    <header class="ops-machine-card__head">
      <div><h2>${escapeHtml(machine.name)}</h2><p>${escapeHtml(machine.lineName)}</p></div>
      <span class="ops-flow-badge" data-tone="${flow.tone}">${flow.label}</span>
    </header>
    <div class="ops-empty-machine">
      <p>Confirme a OP, o item, o ciclo e as frequências desta máquina.</p>
      <button class="ops-btn ops-btn--primary" type="button" data-action="open-conference" data-machine-id="${escapeHtml(machine.id)}">Fazer conferência</button>
    </div>
  </article>`;

  const calc = calculateSession(session);
  const pointed = hasPointing(machine.id);
  const producedInShift = Number(session.producedThisShift || 0);
  const target = Number.isFinite(calc.target) ? calc.target : Number(session.target);
  return `<article class="ops-machine-card" data-flow="${flow.key}">
    <header class="ops-machine-card__head">
      <div><h2>${escapeHtml(machine.name)}</h2><p>${escapeHtml(machine.lineName)}</p></div>
      <span class="ops-flow-badge" data-tone="${flow.tone}">${flow.label}</span>
    </header>

    <div class="ops-order">
      <strong>OP ${escapeHtml(session.op || 'não informada')}</strong>
      <span>Item ${escapeHtml(session.item || 'não informado')}${session.description ? ` · ${escapeHtml(session.description)}` : ''}</span>
    </div>

    <dl class="ops-machine-facts">
      <div><dt>Ciclo</dt><dd>${formatCycle(session.cycleSeconds)}</dd></div>
      <div><dt>Meta planejada</dt><dd>${formatNumber(target, 1)}</dd></div>
      <div><dt>Produzidas até agora</dt><dd>${formatNumber(session.producedSoFar)}</dd></div>
      <div><dt>Frequências I / II</dt><dd>${formatNumber(session.frequency1, 3)} / ${formatNumber(session.frequency2, 3)}</dd></div>
      ${pointed ? `<div class="is-wide"><dt>Produção apontada neste turno</dt><dd>${formatNumber(producedInShift)}</dd></div>` : ''}
    </dl>

    <div class="ops-situation" data-status="${escapeHtml(session.status || 'producing')}">
      <span class="ops-status-dot"></span>
      <div><strong>Última situação informada: ${escapeHtml(situationLabel(session))}</strong><small>${escapeHtml(manualUpdateText(session))}${session.statusNote ? ` · ${escapeHtml(session.statusNote)}` : ''}</small></div>
    </div>

    <footer class="ops-machine-card__actions">
      ${!pointed && session.status !== 'closed' ? `<button class="ops-btn ops-btn--soft" type="button" data-action="update-status" data-machine-id="${escapeHtml(machine.id)}">Informar situação</button>` : ''}
      <button class="ops-btn ops-btn--ghost" type="button" data-action="edit-conference" data-machine-id="${escapeHtml(machine.id)}">Editar dados</button>
      ${!pointed && session.status !== 'closed' ? `<button class="ops-btn ops-btn--danger-text" type="button" data-action="close-order" data-machine-id="${escapeHtml(machine.id)}">Encerrar OP</button>` : ''}
    </footer>
  </article>`;
}

function renderTurn() {
  if (!store.state.assignments.length) return `<section class="ops-empty">
    <div class="ops-empty__icon">＋</div>
    <h2>Selecione suas máquinas</h2>
    <p>Escolha as máquinas que estarão sob sua responsabilidade neste turno.</p>
    <button class="ops-btn ops-btn--primary" type="button" data-action="assign-machines">Selecionar máquinas</button>
  </section>`;

  const cards = store.state.assignments.map(renderMachineCard).join('');
  const closable = store.state.assignments.filter(item => currentMachineSession(item.machineId) && !hasPointing(item.machineId));
  return `${renderPendingSummary()}
    <div class="ops-machine-list">${cards}</div>
    <div class="ops-turn-action">
      <div><strong>Fechamento manual do turno</strong><span>A produção só será registrada quando você confirmar o fechamento.</span></div>
      <button class="ops-btn ops-btn--primary" type="button" data-action="close-shift" ${closable.length ? '' : 'disabled'}>
        ${closable.length ? `Fechar produção (${closable.length})` : 'Produção já apontada'}
      </button>
    </div>`;
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

function renderHistory() {
  const records = historyPeriodRecords();
  const groups = new Map();
  for (const record of records) {
    const key = `${record.productionDate || localDateKey()}|${record.shift || '—'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const filters = [['today', 'Hoje'], ['7d', '7 dias'], ['month', 'Este mês'], ['all', 'Tudo']]
    .map(([value, label]) => `<button type="button" data-history-period="${value}" aria-pressed="${(store.state.ui?.historyPeriod || 'today') === value}">${label}</button>`).join('');

  const content = [...groups.entries()].map(([key, items]) => {
    const [date, shift] = key.split('|');
    return `<section class="ops-history-group">
      <header><div><p class="ops-eyebrow">${formatDate(date)}</p><h2>${escapeHtml(shift)}º turno</h2></div><span>${items.length} registro${items.length === 1 ? '' : 's'}</span></header>
      <div>${items.map(record => `<article class="ops-history-item">
        <div><strong>${escapeHtml(record.machineName || getMachine(record.machineId)?.name || record.machineId || 'Máquina')}</strong><span>OP ${escapeHtml(record.op || '—')} · Item ${escapeHtml(record.item || '—')}</span></div>
        <div class="ops-history-item__result"><strong>${formatNumber(record.producedThisShift ?? record.finalProduction)} peças</strong><span>${record.eventType === 'order-close' ? 'OP encerrada' : 'Apontamento do turno'} · ${formatClock(record.createdAt)}</span></div>
        ${record.notes ? `<p>${escapeHtml(record.notes)}</p>` : ''}
      </article>`).join('')}</div>
    </section>`;
  }).join('');

  return `<div class="ops-history-filters" aria-label="Período do histórico">${filters}</div>
    ${content || `<section class="ops-empty"><h2>Nenhum apontamento neste período</h2><p>Os registros aparecerão aqui após o fechamento manual da produção.</p></section>`}`;
}

function renderMore() {
  const session = store.state.session;
  const sync = syncMeta(store.state);
  return `<div class="ops-more-grid">
    <section class="ops-panel">
      <p class="ops-eyebrow">Sessão atual</p>
      <h2>${escapeHtml(session?.name || 'Sem operador')}</h2>
      <dl class="ops-review">
        <div><dt>Matrícula</dt><dd>${escapeHtml(session?.registration || '—')}</dd></div>
        <div><dt>Turno</dt><dd>${escapeHtml(session?.shift || '—')}º</dd></div>
        <div><dt>Data</dt><dd>${formatDate(session?.productionDate)}</dd></div>
        <div><dt>Sincronização</dt><dd>${escapeHtml(sync.label)}</dd></div>
      </dl>
    </section>

    <section class="ops-panel">
      <p class="ops-eyebrow">Organização do turno</p>
      <div class="action-list">
        <button class="action-row" type="button" data-action="assign-machines"><div><strong>Alterar máquinas</strong><span>Adicionar, remover ou substituir máquinas</span></div>${icon('chevron')}</button>
        <button class="action-row" type="button" data-action="change-shift"><div><strong>Alterar turno</strong><span>Trocar o turno desta sessão</span></div>${icon('chevron')}</button>
        <button class="action-row" type="button" data-action="cell-view"><div><strong>Situação informada da célula</strong><span>Últimos estados registrados manualmente</span></div>${icon('chevron')}</button>
      </div>
    </section>

    <section class="ops-panel">
      <p class="ops-eyebrow">Relatórios e aplicativo</p>
      <div class="action-list">
        <button class="action-row" type="button" data-action="sync"><div><strong>Sincronizar agora</strong><span>${store.state.syncQueue.length ? `${store.state.syncQueue.length} pendências` : 'Sem pendências locais'}</span></div>${icon('sync')}</button>
        <button class="action-row" type="button" data-action="copy-summary"><div><strong>Copiar resumo do turno</strong><span>Texto pronto para compartilhamento</span></div>${icon('download')}</button>
        <button class="action-row" type="button" data-action="export-csv"><div><strong>Exportar CSV</strong><span>Registros de produção</span></div>${icon('download')}</button>
        <button class="action-row" type="button" data-action="install-app"><div><strong>Instalar aplicativo</strong><span>Adicionar à tela inicial</span></div>${icon('download')}</button>
        <button class="action-row" type="button" data-action="logout"><div><strong class="ops-danger">Sair</strong><span>Trocar operador neste aparelho</span></div>${icon('logout')}</button>
      </div>
    </section>
  </div>`;
}

function renderNavigation(route) {
  const items = [
    ['turn', 'overview', 'Turno'],
    ['history', 'clock', 'Histórico'],
    ['more', 'more', 'Mais']
  ];
  const buttons = items.map(([value, iconName, label]) => `<button type="button" class="ops-nav__item" data-route="${value}" aria-current="${route === value ? 'page' : 'false'}">${icon(iconName)}<span>${label}</span></button>`).join('');
  return `<nav class="ops-nav" aria-label="Navegação principal">${buttons}</nav>`;
}

function render() {
  const route = activeRoute();
  const titles = {
    turn: ['Meu turno', 'Conferir, registrar exceções e fechar a produção'],
    history: ['Histórico', 'Apontamentos e encerramentos já registrados'],
    more: ['Mais', 'Configurações, relatórios e sincronização']
  };
  const [title, subtitle] = titles[route];
  const content = route === 'turn' ? renderTurn() : route === 'history' ? renderHistory() : renderMore();

  app.innerHTML = `<div class="ops-shell">
    ${renderHeader()}
    ${renderConnection()}
    <main class="ops-page">
      ${renderSessionLine()}
      <header class="ops-page-head"><div><p class="ops-eyebrow">Operação manual</p><h1>${title}</h1><p>${subtitle}</p></div></header>
      <section>${content}</section>
    </main>
    ${renderNavigation(route)}
  </div>`;
}

function loginSheet() {
  const previous = store.state.session;
  const shift = previous?.shift || detectShift();
  const known = previous?.name && previous?.registration;
  const body = `<form id="loginForm" novalidate>
    ${known ? `<div class="ops-recognized"><strong>${escapeHtml(previous.name)}</strong><span>Matrícula ${escapeHtml(previous.registration)}</span></div>` : ''}
    <div class="field"><label for="loginRegistration">Matrícula</label><input id="loginRegistration" inputmode="numeric" autocomplete="username" required value="${escapeHtml(previous?.registration || '')}"></div>
    <div class="field"><label for="loginName">Nome</label><input id="loginName" autocomplete="name" required value="${escapeHtml(previous?.name || '')}"></div>
    <div class="field"><label for="loginShift">Turno</label><select id="loginShift"><option value="1" ${shift === '1' ? 'selected' : ''}>1º turno</option><option value="2" ${shift === '2' ? 'selected' : ''}>2º turno</option><option value="3" ${shift === '3' ? 'selected' : ''}>3º turno</option></select></div>
    <p class="field-hint">Seus dados ficarão salvos neste aparelho.</p>
    <div class="field-error" id="loginError" role="alert"></div>
  </form>`;
  openLayer(sheet({
    title: known ? `Continuar como ${previous.name.split(' ')[0]}` : 'Entrar no turno',
    eyebrow: 'Identificação',
    body,
    actions: `<button class="ops-btn ops-btn--primary" type="submit" form="loginForm">Entrar no turno</button>`
  }), 'loginLayer');
}

async function submitLogin(form) {
  const registration = form.querySelector('#loginRegistration').value.trim();
  const name = form.querySelector('#loginName').value.trim();
  const shift = form.querySelector('#loginShift').value;
  if (!registration || !name) {
    form.querySelector('#loginError').textContent = 'Informe matrícula e nome.';
    return;
  }
  const button = layers.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Entrando…';
  await loginOperator({ registration, name, shift });
  closeLayer(false);
  render();
  if (!store.state.assignments.length) openAssignments();
}

function menuSheet() {
  const session = store.state.session;
  const body = `<div class="ops-menu-user"><strong>${escapeHtml(session?.name || 'Sem operador')}</strong><span>${session ? `Matrícula ${escapeHtml(session.registration)} · ${escapeHtml(session.shift)}º turno` : ''}</span></div>
    <div class="action-list">
      <button class="action-row" type="button" data-action="assign-machines"><div><strong>Máquinas do turno</strong><span>Consultar ou alterar a seleção</span></div>${icon('chevron')}</button>
      <button class="action-row" type="button" data-action="change-shift"><div><strong>Alterar turno</strong><span>Trocar o turno ativo</span></div>${icon('chevron')}</button>
      <button class="action-row" type="button" data-action="sync"><div><strong>Sincronizar agora</strong><span>${store.state.syncQueue.length ? `${store.state.syncQueue.length} pendências` : 'Sem pendências'}</span></div>${icon('sync')}</button>
      <button class="action-row" type="button" data-action="logout"><div><strong class="ops-danger">Sair</strong><span>Trocar operador neste aparelho</span></div>${icon('logout')}</button>
    </div>`;
  openLayer(sheet({ title: 'Menu', eyebrow: 'NEODENT MES', body }), 'menuLayer');
}

function shiftSheet() {
  const current = String(store.state.session?.shift || detectShift());
  const body = `<p class="ops-help">Escolha o turno desta sessão.</p>
    <div class="ops-option-grid">${['1', '2', '3'].map(value => `<button class="ops-option" type="button" data-shift-choice="${value}" aria-pressed="${value === current}"><strong>${value}º turno</strong><span>${value === '1' ? '06:30–14:30' : value === '2' ? '14:30–22:30' : '22:30–06:30'}</span></button>`).join('')}</div>`;
  openLayer(sheet({
    title: 'Alterar turno',
    eyebrow: 'Sessão do operador',
    body,
    actions: `<button class="ops-btn ops-btn--ghost" type="button" data-close-layer>Cancelar</button><button class="ops-btn ops-btn--primary" type="button" data-action="confirm-shift" data-value="${current}">Confirmar turno</button>`
  }), 'shiftLayer');
}

function openAssignments() {
  if (!store.state.session) return loginSheet();
  assignmentDraft = store.state.assignments.map(item => ({ lineId: item.lineId, machineId: item.machineId }));
  assignmentStage = assignmentDraft.length ? 'review' : 'lines';
  assignmentLineId = '';
  renderAssignments();
}

function assignmentBody() {
  if (assignmentStage === 'review') {
    const selected = assignmentDraft.map((item, index) => {
      const machine = getMachine(item.machineId);
      return `<div class="ops-selected-machine"><span>${index + 1}</span><div><strong>${escapeHtml(machine?.name || item.machineId)}</strong><small>${escapeHtml(machine?.lineName || '')}</small></div><button type="button" data-remove-assignment="${index}" aria-label="Remover ${escapeHtml(machine?.name || 'máquina')}">×</button></div>`;
    }).join('');
    return `<p class="ops-help">Confirme as máquinas do turno. O padrão operacional é três máquinas, com opção de adicionar outras.</p>
      <div class="ops-selected-list">${selected || '<p class="ops-help">Nenhuma máquina selecionada.</p>'}</div>
      <button class="ops-btn ops-btn--soft ops-btn--full" type="button" data-assignment-add>＋ Adicionar máquina</button>`;
  }
  if (assignmentStage === 'lines') return `<p class="ops-help">Escolha a linha.</p><div class="ops-select-grid">${store.state.catalog.map(line => `<button class="ops-select-card" type="button" data-assignment-line="${escapeHtml(line.id)}"><strong>${escapeHtml(line.name)}</strong><span>${line.machines.length} equipamentos</span></button>`).join('')}</div>`;

  const line = getLine(assignmentLineId);
  const used = new Set(assignmentDraft.map(item => item.machineId));
  return `<p class="ops-help">${escapeHtml(line?.name || '')} · toque na máquina para adicionar.</p>
    <label class="ops-search">${icon('search')}<input id="assignmentSearch" type="search" placeholder="Buscar TNL" aria-label="Buscar máquina"></label>
    <div class="ops-select-grid" id="assignmentMachineGrid">${(line?.machines || []).map(machine => `<button class="ops-select-card" type="button" data-assignment-machine="${escapeHtml(machine.id)}" ${used.has(machine.id) ? 'disabled' : ''}><strong>${escapeHtml(machine.name)}</strong><span>${escapeHtml(machine.equipmentType || 'TNL')}</span></button>`).join('')}</div>`;
}

function renderAssignments() {
  const review = assignmentStage === 'review';
  openLayer(sheet({
    title: 'Máquinas do turno',
    eyebrow: review ? 'Revisão' : assignmentStage === 'lines' ? 'Escolha a linha' : 'Escolha a máquina',
    body: assignmentBody(),
    actions: review
      ? `<button class="ops-btn ops-btn--ghost" type="button" data-close-layer>Cancelar</button><button class="ops-btn ops-btn--primary" type="button" data-assignment-save ${assignmentDraft.length >= 3 ? '' : 'disabled'}>Confirmar máquinas</button>`
      : `<button class="ops-btn ops-btn--ghost" type="button" data-assignment-back>Voltar</button>`
  }), 'assignmentLayer');
  const search = document.getElementById('assignmentSearch');
  search?.addEventListener('input', event => {
    const query = event.target.value.toLowerCase();
    layers.querySelectorAll('[data-assignment-machine]').forEach(button => {
      button.hidden = !button.textContent.toLowerCase().includes(query);
    });
  });
}

async function finishAssignments() {
  if (assignmentDraft.length < 3) return;
  const assignments = assignmentDraft.map((item, index) => ({
    id: `assignment-${localDateKey()}-${index + 1}`,
    slotOrder: index + 1,
    ...item
  }));
  await saveAssignments(assignments);
  closeLayer(false);
  setRoute('turn');
  const first = assignments.find(item => !currentMachineSession(item.machineId));
  if (first) openConference(first.machineId);
}

function conferenceDefaults(machineId, preset = {}) {
  const machine = getMachine(machineId);
  const saved = currentMachineSession(machineId);
  return {
    machineId,
    lineId: machine?.lineId || '',
    machineName: machine?.name || '',
    lineName: machine?.lineName || '',
    op: '', item: '', description: '', cycleSeconds: null, frequency1: null, frequency2: null,
    producedSoFar: 0, availableMinutes: minutesRemaining(store.state.session?.shift || detectShift()),
    status: 'producing', statusNote: '', notes: '',
    checkedAt: null, updatedAt: new Date().toISOString(),
    ...(saved || {}),
    ...preset
  };
}

function savedTitle(draft) {
  return draft.checkedAt ? `Editar ${draft.machineName}` : `Conferir ${draft.machineName}`;
}

function openConference(machineId = store.state.activeMachineId, preset = {}) {
  if (!machineId) return openAssignments();
  store.update(state => { state.activeMachineId = machineId; }, 'active-machine');
  conferenceDraft = conferenceDefaults(machineId, preset);
  const body = `<form id="conferenceForm" novalidate>
    <div class="ops-context"><strong>${escapeHtml(conferenceDraft.machineName)}</strong><span>${escapeHtml(conferenceDraft.lineName)}</span></div>
    <div class="ops-form-grid">
      <div class="field"><label for="confOp">OP</label><input id="confOp" inputmode="numeric" required value="${escapeHtml(conferenceDraft.op)}"></div>
      <div class="field"><label for="confItem">Item</label><input id="confItem" inputmode="numeric" required value="${escapeHtml(conferenceDraft.item)}"></div>
      <div class="field"><label for="confCycle">Tempo de ciclo</label><input id="confCycle" required value="${conferenceDraft.cycleSeconds ? formatCycle(conferenceDraft.cycleSeconds) : ''}" placeholder="Ex.: 5:04"><span class="field-hint">Aceita 90, 1:30, 1,30 ou 1m30s.</span></div>
      <div class="field"><label for="confStatus">Situação encontrada</label><select id="confStatus">${STATUS_OPTIONS.map(([value, label]) => `<option value="${value}" ${conferenceDraft.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label for="confFrequency1">Frequência I <span>(opcional)</span></label><input id="confFrequency1" inputmode="decimal" value="${Number.isFinite(Number(conferenceDraft.frequency1)) ? conferenceDraft.frequency1 : ''}"></div>
      <div class="field"><label for="confFrequency2">Frequência II <span>(opcional)</span></label><input id="confFrequency2" inputmode="decimal" value="${Number.isFinite(Number(conferenceDraft.frequency2)) ? conferenceDraft.frequency2 : ''}"></div>
    </div>
    <div class="ops-known-production"><span>Peças produzidas até agora</span><strong id="knownProduction">${formatNumber(conferenceDraft.producedSoFar)}</strong><small>Calculado pelos apontamentos anteriores desta OP</small></div>
    <details class="ops-details">
      <summary>Adicionar descrição ou observação</summary>
      <div class="field"><label for="confDescription">Descrição do item</label><input id="confDescription" value="${escapeHtml(conferenceDraft.description || '')}"></div>
      <div class="field"><label for="confNotes">Observação da conferência</label><textarea id="confNotes">${escapeHtml(conferenceDraft.notes || '')}</textarea></div>
    </details>
    <div class="field-error" id="conferenceError" role="alert"></div>
  </form>`;
  openLayer(sheet({
    title: savedTitle(conferenceDraft),
    eyebrow: 'Conferência do turno',
    body,
    actions: `<button class="ops-btn ops-btn--ghost" type="button" data-close-layer>Cancelar</button><button class="ops-btn ops-btn--primary" type="submit" form="conferenceForm">Confirmar dados</button>`,
    size: 'wide'
  }), 'conferenceLayer');
  document.getElementById('confOp')?.addEventListener('blur', hydrateConferenceFromCloud);
  document.getElementById('confItem')?.addEventListener('blur', hydrateItemParameters);
}

async function hydrateConferenceFromCloud() {
  const op = document.getElementById('confOp')?.value.trim();
  if (!op || !conferenceDraft) return;
  conferenceDraft.op = op;
  let total = productionTotalFromRecords(conferenceDraft.machineId, op);
  const context = await getShiftContext(conferenceDraft.machineId, op);
  if (context?.lastSession?.finalProduction !== null && context?.lastSession?.finalProduction !== undefined) total = Math.max(total, Number(context.lastSession.finalProduction) || 0);
  else if (context?.producedTotal) total = Math.max(total, Number(context.producedTotal) || 0);
  conferenceDraft.producedSoFar = total;
  const display = document.getElementById('knownProduction');
  if (display) display.textContent = formatNumber(total);
  if (!API_BASE) return;
  try {
    const payload = await api.get(`/api/v1/orders?op=${encodeURIComponent(op)}`);
    const itemInput = document.getElementById('confItem');
    if (payload.order?.item && itemInput && !itemInput.value) {
      itemInput.value = payload.order.item;
      conferenceDraft.item = payload.order.item;
      await hydrateItemParameters();
    }
  } catch {}
}

async function hydrateItemParameters() {
  const item = document.getElementById('confItem')?.value.trim();
  if (!item || !conferenceDraft || !API_BASE) return;
  conferenceDraft.item = item;
  try {
    const payload = await api.get(`/api/v1/items?itemNumber=${encodeURIComponent(item)}&machineId=${encodeURIComponent(conferenceDraft.machineId)}`);
    const known = payload.items?.[0];
    if (!known) return;
    const description = document.getElementById('confDescription');
    const cycle = document.getElementById('confCycle');
    const frequency1 = document.getElementById('confFrequency1');
    const frequency2 = document.getElementById('confFrequency2');
    if (description && !description.value) description.value = known.description || '';
    if (cycle && !cycle.value && known.cycleTimeSeconds) cycle.value = formatCycle(Number(known.cycleTimeSeconds));
    if (frequency1 && !frequency1.value && known.frequency1 !== null) frequency1.value = known.frequency1 ?? '';
    if (frequency2 && !frequency2.value && known.frequency2 !== null) frequency2.value = known.frequency2 ?? '';
  } catch {}
}

async function submitConference(form) {
  const op = form.querySelector('#confOp').value.trim();
  const item = form.querySelector('#confItem').value.trim();
  const cycleSeconds = parseCycle(form.querySelector('#confCycle').value);
  if (!op || !item || !Number.isFinite(cycleSeconds) || cycleSeconds <= 0) {
    form.querySelector('#conferenceError').textContent = 'Informe OP, item e tempo de ciclo válido.';
    return;
  }
  const availableMinutes = minutesRemaining(store.state.session.shift);
  const now = new Date().toISOString();
  const session = {
    ...conferenceDraft,
    op,
    item,
    description: form.querySelector('#confDescription').value.trim(),
    cycleSeconds,
    frequency1: parseNumber(form.querySelector('#confFrequency1').value),
    frequency2: parseNumber(form.querySelector('#confFrequency2').value),
    availableMinutes,
    target: availableMinutes / (cycleSeconds / 60),
    status: form.querySelector('#confStatus').value,
    notes: form.querySelector('#confNotes').value.trim(),
    producedThisShift: 0,
    checkedAt: conferenceDraft.checkedAt || now,
    updatedAt: now,
    operatorName: store.state.session.name,
    registration: store.state.session.registration
  };
  store.update(state => { state.machineSessions[session.machineId] = session; }, 'conference-save');
  if (API_BASE) {
    try {
      await api.post('/api/v1/shift-sessions', {
        id: `shift-${localDateKey()}-${store.state.session.shift}-${store.state.session.registration}-${session.machineId}-${session.op}`.replace(/[^a-zA-Z0-9-_]/g, '-'),
        productionDate: localDateKey(), shift: store.state.session.shift, registration: store.state.session.registration, operatorName: store.state.session.name,
        lineId: session.lineId, lineName: session.lineName, machineId: session.machineId, machineName: session.machineName,
        opNumber: session.op, itemNumber: session.item, cycleTimeSeconds: session.cycleSeconds, frequency1: session.frequency1, frequency2: session.frequency2,
        openingProduction: session.producedSoFar, availableMinutes, target: session.target,
        finalProduction: null, status: 'open', openedAt: session.checkedAt, updatedAt: now
      });
    } catch {}
  }
  closeLayer(false);
  render();
  toast(`${session.machineName} conferida.`);
}

function openStatus(machineId) {
  const session = currentMachineSession(machineId);
  if (!session) return openConference(machineId);
  store.update(state => { state.activeMachineId = machineId; }, 'active-machine');
  const body = `<form id="statusForm">
    <div class="ops-option-grid">${STATUS_OPTIONS.map(([value, label, detail]) => `<button class="ops-option" type="button" data-status-choice="${value}" aria-pressed="${session.status === value}"><strong>${label}</strong><span>${detail}</span></button>`).join('')}</div>
    <div class="field"><label for="statusNote">Motivo ou observação</label><textarea id="statusNote" placeholder="Obrigatório para parada e manutenção">${escapeHtml(session.statusNote || '')}</textarea></div>
    <div class="field-error" id="statusError" role="alert"></div>
  </form>`;
  openLayer(sheet({
    title: 'Informar situação',
    eyebrow: session.machineName,
    body,
    actions: `<button class="ops-btn ops-btn--ghost" type="button" data-close-layer>Cancelar</button><button class="ops-btn ops-btn--primary" type="button" data-action="save-status" data-value="${escapeHtml(session.status || 'producing')}">Salvar situação</button>`
  }), 'statusLayer');
}

function saveStatus(button) {
  const machineId = store.state.activeMachineId;
  const session = currentMachineSession(machineId);
  const status = button.dataset.value || session.status;
  const note = document.getElementById('statusNote').value.trim();
  if (['stopped', 'maintenance'].includes(status) && !note) {
    document.getElementById('statusError').textContent = 'Informe o motivo da parada ou manutenção.';
    return;
  }
  store.update(state => {
    state.machineSessions[machineId] = {
      ...session,
      status,
      statusNote: note,
      updatedAt: new Date().toISOString(),
      operatorName: state.session.name,
      registration: state.session.registration
    };
  }, 'status');
  closeLayer(false);
  render();
  toast('Situação registrada.');
}

function openBatchClose() {
  const eligible = store.state.assignments.filter(item => currentMachineSession(item.machineId) && !hasPointing(item.machineId));
  if (!eligible.length) return toast('Todas as máquinas já foram apontadas.');
  batchDraft = {};
  for (const item of eligible) batchDraft[item.machineId] = { pieces: '', notes: '' };
  batchStage = 'entry';
  renderBatchClose();
}

function batchBody() {
  const eligible = store.state.assignments.filter(item => currentMachineSession(item.machineId) && !hasPointing(item.machineId));
  if (batchStage === 'review') return `<div class="ops-batch-review">${eligible.map(item => {
    const machine = getMachine(item.machineId);
    const session = currentMachineSession(item.machineId);
    const produced = parseNumber(batchDraft[item.machineId]?.pieces);
    const total = Number(session.producedSoFar || 0) + produced;
    const calc = calculateSession(session);
    return `<article><header><strong>${escapeHtml(machine.name)}</strong><span>OP ${escapeHtml(session.op)}</span></header><dl class="ops-review"><div><dt>Produção do turno</dt><dd>${formatNumber(produced)}</dd></div><div><dt>Novo total da OP</dt><dd>${formatNumber(total)}</dd></div><div><dt>Meta planejada</dt><dd>${formatNumber(calc.target, 1)}</dd></div></dl>${batchDraft[item.machineId]?.notes ? `<p>${escapeHtml(batchDraft[item.machineId].notes)}</p>` : ''}</article>`;
  }).join('')}</div>`;

  return `<p class="ops-help">Informe a produção consolidada de cada máquina no fim do turno.</p>
    <div class="ops-batch-list">${eligible.map(item => {
      const machine = getMachine(item.machineId);
      const session = currentMachineSession(item.machineId);
      return `<article class="ops-batch-row">
        <header><div><strong>${escapeHtml(machine.name)}</strong><span>OP ${escapeHtml(session.op)} · Item ${escapeHtml(session.item)}</span></div><small>Até agora: ${formatNumber(session.producedSoFar)}</small></header>
        <div class="field"><label for="batch-${escapeHtml(machine.id)}">Peças produzidas neste turno</label><input id="batch-${escapeHtml(machine.id)}" data-batch-pieces="${escapeHtml(machine.id)}" inputmode="numeric" value="${escapeHtml(batchDraft[machine.id]?.pieces || '')}" placeholder="0"></div>
        <details><summary>Adicionar observação</summary><div class="field"><textarea data-batch-notes="${escapeHtml(machine.id)}" placeholder="Paradas, motivo ou atuação realizada">${escapeHtml(batchDraft[machine.id]?.notes || '')}</textarea></div></details>
      </article>`;
    }).join('')}</div><div class="field-error" id="batchError" role="alert"></div>`;
}

function captureBatch() {
  for (const input of layers.querySelectorAll('[data-batch-pieces]')) {
    const id = input.dataset.batchPieces;
    batchDraft[id] ||= {};
    batchDraft[id].pieces = input.value.trim();
  }
  for (const textarea of layers.querySelectorAll('[data-batch-notes]')) {
    const id = textarea.dataset.batchNotes;
    batchDraft[id] ||= {};
    batchDraft[id].notes = textarea.value.trim();
  }
}

function renderBatchClose() {
  openLayer(sheet({
    title: batchStage === 'review' ? 'Revisar fechamento' : 'Fechar produção do turno',
    eyebrow: `${store.state.session.shift}º turno · ${formatDate()}`,
    body: batchBody(),
    actions: batchStage === 'review'
      ? `<button class="ops-btn ops-btn--ghost" type="button" data-action="batch-back">Voltar</button><button class="ops-btn ops-btn--primary" type="button" data-action="batch-confirm">Confirmar apontamentos</button>`
      : `<button class="ops-btn ops-btn--ghost" type="button" data-close-layer>Cancelar</button><button class="ops-btn ops-btn--primary" type="button" data-action="batch-review">Revisar fechamento</button>`,
    size: 'wide'
  }), 'batchLayer');
}

async function savePointing(machineId, pieces, notes, mode = 'shift') {
  const originalActive = store.state.activeMachineId;
  const session = currentMachineSession(machineId);
  const machine = getMachine(machineId);
  if (!session || !machine) return;
  const calc = calculateSession(session);
  const total = Number(session.producedSoFar || 0) + pieces;
  const now = new Date().toISOString();
  const eventType = mode === 'close' ? 'order-close' : 'shift-pointing';
  const record = {
    id: uid('record'), schemaVersion: 3, createdAt: now, updatedAt: now, productionDate: localDateKey(), source: 'neodent-mes-manual',
    operatorName: store.state.session.name, operatorRegistration: store.state.session.registration, shift: store.state.session.shift,
    lineId: machine.lineId, lineName: machine.lineName, machineId: machine.id, machineName: machine.name,
    op: session.op, item: session.item, itemDescription: session.description || '', cycleTimeSeconds: session.cycleSeconds,
    frequency1: session.frequency1, frequency2: session.frequency2, availableMinutes: session.availableMinutes,
    producedBefore: Number(session.producedSoFar || 0), producedThisShift: pieces, pieces: Number(session.producedSoFar || 0),
    totalAfterPointing: total, finalProduction: total, target: calc.target,
    expectedProduction: null, balance: pieces - calc.target, balanceMinutes: null, notes,
    eventType, orderStatus: mode === 'close' ? 'closed' : 'open', status: 'active', syncStatus: API_BASE ? 'pending' : 'local'
  };
  store.update(state => {
    state.activeMachineId = machineId;
    state.records.unshift(record);
    state.machineSessions[machineId] = {
      ...session,
      producedThisShift: pieces,
      producedSoFar: total,
      status: mode === 'close' ? 'closed' : 'pointed',
      updatedAt: now,
      closedAt: now,
      operatorName: state.session.name,
      registration: state.session.registration
    };
  }, 'pointing-normalized');

  if (API_BASE) {
    try { await api.post('/api/v1/records', record); } catch {}
    try {
      await api.post('/api/v1/shift-sessions', {
        id: `shift-${localDateKey()}-${store.state.session.shift}-${store.state.session.registration}-${machine.id}-${session.op}`.replace(/[^a-zA-Z0-9-_]/g, '-'),
        productionDate: localDateKey(), shift: store.state.session.shift, registration: store.state.session.registration, operatorName: store.state.session.name,
        lineId: machine.lineId, lineName: machine.lineName, machineId: machine.id, machineName: machine.name,
        opNumber: session.op, itemNumber: session.item, cycleTimeSeconds: session.cycleSeconds, frequency1: session.frequency1, frequency2: session.frequency2,
        openingProduction: Number(session.producedSoFar || 0), availableMinutes: session.availableMinutes, target: calc.target,
        finalProduction: total, status: 'closed', openedAt: session.checkedAt, closedAt: now, updatedAt: now
      });
    } catch {}
  }
  store.update(state => { state.activeMachineId = originalActive || machineId; }, 'active-machine');
}

async function confirmBatch() {
  const entries = Object.entries(batchDraft);
  const invalid = entries.find(([, value]) => !Number.isFinite(parseNumber(value.pieces)) || parseNumber(value.pieces) < 0);
  if (invalid) {
    batchStage = 'entry';
    renderBatchClose();
    document.getElementById('batchError').textContent = 'Informe a produção de todas as máquinas.';
    return;
  }
  const button = layers.querySelector('[data-action="batch-confirm"]');
  button.disabled = true;
  button.textContent = 'Salvando…';
  for (const [machineId, value] of entries) await savePointing(machineId, parseNumber(value.pieces), value.notes, 'shift');
  closeLayer(false);
  render();
  toast('Apontamentos do turno confirmados.');
}

function openCloseOrder(machineId) {
  const session = currentMachineSession(machineId);
  const machine = getMachine(machineId);
  if (!session || !machine) return openConference(machineId);
  store.update(state => { state.activeMachineId = machineId; }, 'active-machine');
  const body = `<form id="closeOrderForm">
    <div class="ops-context"><strong>${escapeHtml(machine.name)}</strong><span>OP ${escapeHtml(session.op)} · Item ${escapeHtml(session.item)}</span></div>
    <div class="field"><label for="closeOrderPieces">Peças produzidas neste turno nesta OP</label><input id="closeOrderPieces" inputmode="numeric" required placeholder="0"></div>
    <div class="field"><label for="closeOrderNotes">Observação <span>(opcional)</span></label><textarea id="closeOrderNotes"></textarea></div>
    <p class="ops-warning">Esta ação encerra a OP. O sistema perguntará o que será iniciado em seguida.</p>
    <div class="field-error" id="closeOrderError"></div>
  </form>`;
  openLayer(sheet({
    title: 'Encerrar ordem',
    eyebrow: 'Ação crítica',
    body,
    actions: `<button class="ops-btn ops-btn--ghost" type="button" data-close-layer>Cancelar</button><button class="ops-btn ops-btn--danger" type="submit" form="closeOrderForm">Confirmar encerramento</button>`
  }), 'closeOrderLayer');
}

async function submitCloseOrder(form) {
  const machineId = store.state.activeMachineId;
  const session = currentMachineSession(machineId);
  const pieces = parseNumber(form.querySelector('#closeOrderPieces').value);
  if (!Number.isFinite(pieces) || pieces < 0) {
    form.querySelector('#closeOrderError').textContent = 'Informe a produção desta OP no turno.';
    return;
  }
  nextOrderPreset = {
    item: session.item,
    description: session.description,
    cycleSeconds: session.cycleSeconds,
    frequency1: session.frequency1,
    frequency2: session.frequency2
  };
  await savePointing(machineId, pieces, form.querySelector('#closeOrderNotes').value.trim(), 'close');
  openNextOrder();
}

function openNextOrder() {
  const session = currentMachineSession();
  const body = `<p class="ops-help">A ordem foi encerrada. O que acontecerá agora?</p>
    <div class="action-list">
      <button class="action-row" type="button" data-next-order="new"><div><strong>Iniciar nova OP</strong><span>Informe o número e confirme os dados encontrados</span></div>${icon('chevron')}</button>
      <button class="action-row" type="button" data-next-order="stopped"><div><strong>Máquina ficará parada</strong><span>Nenhuma nova ordem será iniciada agora</span></div>${icon('chevron')}</button>
      <button class="action-row" type="button" data-next-order="done"><div><strong>Finalizar apenas esta OP</strong><span>Voltar ao painel sem iniciar outra</span></div>${icon('chevron')}</button>
    </div>`;
  openLayer(sheet({ title: 'Próximo passo', eyebrow: `${session?.machineName || 'Máquina'} · OP encerrada`, body }), 'nextOrderLayer');
}

function renderCellView() {
  const items = store.state.assignments.map(item => {
    const machine = getMachine(item.machineId);
    const session = currentMachineSession(item.machineId) || store.state.sharedMachineStates?.[item.machineId];
    return `<article class="ops-cell-item">
      <div><strong>${escapeHtml(machine?.name || item.machineId)}</strong><span>${escapeHtml(machine?.lineName || '')}</span></div>
      <div><strong>${escapeHtml(session ? situationLabel(session) : 'Sem informação')}</strong><span>${session ? escapeHtml(manualUpdateText(session)) : 'Nenhuma situação foi registrada'}</span></div>
    </article>`;
  }).join('');
  openLayer(sheet({
    title: 'Situação informada da célula',
    eyebrow: 'Dados lançados manualmente',
    body: `<p class="ops-help">Esta visão não recebe dados diretamente das máquinas. Ela mostra a última situação registrada por um usuário.</p><div class="ops-cell-list">${items}</div>`,
    size: 'wide'
  }), 'cellLayer');
}

function copySummary() {
  const state = store.state;
  const lines = [`NEODENT MES — ${formatDate()}`, `${state.session?.name || ''} · ${state.session?.shift || ''}º turno`, ''];
  for (const assignment of state.assignments) {
    const machine = getMachine(assignment.machineId);
    const session = currentMachineSession(assignment.machineId);
    lines.push(`${machine?.name || assignment.machineId} — ${session ? situationLabel(session) : 'Conferência pendente'}`);
    if (session) lines.push(`OP ${session.op} · Item ${session.item} · ${hasPointing(machine.id) ? `Apontado ${formatNumber(session.producedThisShift)} peças` : 'Apontamento pendente'} · Ciclo ${formatCycle(session.cycleSeconds)}`);
  }
  navigator.clipboard?.writeText(lines.join('\n')).then(() => toast('Resumo copiado.')).catch(() => toast('Não foi possível copiar.'));
}

function exportCsv() {
  const headers = ['Data', 'Hora', 'Máquina', 'Linha', 'OP', 'Item', 'Operador', 'Turno', 'Produção do turno', 'Total da OP', 'Evento', 'Observações'];
  const rows = store.state.records.map(record => [
    record.productionDate, formatClock(record.createdAt), record.machineName, record.lineName, record.op, record.item,
    record.operatorName, record.shift, record.producedThisShift ?? record.finalProduction, record.totalAfterPointing ?? record.finalProduction,
    record.eventType, record.notes
  ]);
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `neodent-mes-${localDateKey()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function synchronize() {
  closeLayer(false);
  try {
    await api.flushQueue();
    if (API_BASE) await Promise.allSettled([loadCloudRecords(), loadCloudCatalog()]);
    toast('Sincronização concluída.');
  } catch {
    toast('Não foi possível sincronizar agora.');
  }
}

function logout() {
  const confirmed = window.confirm('Deseja sair e trocar o operador deste aparelho?');
  if (!confirmed) return;
  store.update(state => {
    state.session = null;
    state.assignments = [];
    state.activeMachineId = '';
    state.ui.route = 'turn';
  }, 'logout');
  closeLayer(false);
  render();
  loginSheet();
}

function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => { installPrompt = null; });
  } else {
    toast('No iPhone: Compartilhar → Adicionar à Tela de Início.');
  }
}

document.addEventListener('click', event => {
  const route = event.target.closest('[data-route]')?.dataset.route;
  if (route) return setRoute(route);

  const close = event.target.closest('[data-close-layer]');
  if (close) return closeLayer();

  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (action === 'menu') return menuSheet();
  if (action === 'change-shift') return shiftSheet();
  if (action === 'confirm-shift') {
    const value = actionElement.dataset.value;
    store.update(state => {
      state.session.shift = value;
      state.session.productionDate = localDateKey();
      state.assignments = [];
      state.activeMachineId = '';
      state.machineSessions = {};
    }, 'shift-change');
    closeLayer(false);
    render();
    return openAssignments();
  }
  if (action === 'sync') return synchronize();
  if (action === 'assign-machines') return openAssignments();
  if (action === 'open-first-conference') {
    const first = store.state.assignments.find(item => !currentMachineSession(item.machineId));
    if (first) openConference(first.machineId);
    return;
  }
  if (action === 'open-conference' || action === 'edit-conference') return openConference(actionElement.dataset.machineId);
  if (action === 'update-status') return openStatus(actionElement.dataset.machineId);
  if (action === 'save-status') return saveStatus(actionElement);
  if (action === 'close-shift') return openBatchClose();
  if (action === 'batch-review') {
    captureBatch();
    const invalid = Object.values(batchDraft).some(value => !Number.isFinite(parseNumber(value.pieces)) || parseNumber(value.pieces) < 0);
    if (invalid) return document.getElementById('batchError').textContent = 'Informe a produção de todas as máquinas.';
    batchStage = 'review';
    return renderBatchClose();
  }
  if (action === 'batch-back') { batchStage = 'entry'; return renderBatchClose(); }
  if (action === 'batch-confirm') return confirmBatch();
  if (action === 'close-order') return openCloseOrder(actionElement.dataset.machineId);
  if (action === 'cell-view') return renderCellView();
  if (action === 'copy-summary') return copySummary();
  if (action === 'export-csv') return exportCsv();
  if (action === 'install-app') return installApp();
  if (action === 'logout') return logout();

  const shiftChoice = event.target.closest('[data-shift-choice]');
  if (shiftChoice) {
    layers.querySelectorAll('[data-shift-choice]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    shiftChoice.setAttribute('aria-pressed', 'true');
    layers.querySelector('[data-action="confirm-shift"]').dataset.value = shiftChoice.dataset.shiftChoice;
    return;
  }

  const statusChoice = event.target.closest('[data-status-choice]');
  if (statusChoice) {
    layers.querySelectorAll('[data-status-choice]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    statusChoice.setAttribute('aria-pressed', 'true');
    layers.querySelector('[data-action="save-status"]').dataset.value = statusChoice.dataset.statusChoice;
    return;
  }

  const line = event.target.closest('[data-assignment-line]');
  if (line) {
    assignmentLineId = line.dataset.assignmentLine;
    assignmentStage = 'machines';
    return renderAssignments();
  }
  const machine = event.target.closest('[data-assignment-machine]');
  if (machine) {
    assignmentDraft.push({ lineId: assignmentLineId, machineId: machine.dataset.assignmentMachine });
    assignmentStage = 'review';
    return renderAssignments();
  }
  if (event.target.closest('[data-assignment-add]')) {
    assignmentStage = 'lines';
    return renderAssignments();
  }
  const remove = event.target.closest('[data-remove-assignment]');
  if (remove) {
    assignmentDraft.splice(Number(remove.dataset.removeAssignment), 1);
    return renderAssignments();
  }
  if (event.target.closest('[data-assignment-back]')) {
    assignmentStage = assignmentStage === 'machines' ? 'lines' : 'review';
    return renderAssignments();
  }
  if (event.target.closest('[data-assignment-save]')) return finishAssignments();

  const nextOrder = event.target.closest('[data-next-order]')?.dataset.nextOrder;
  if (nextOrder === 'new') {
    const machineId = store.state.activeMachineId;
    closeLayer(false);
    return openConference(machineId, { ...nextOrderPreset, op: '', producedSoFar: 0, producedThisShift: 0, status: 'producing', checkedAt: null });
  }
  if (nextOrder === 'stopped') {
    const machineId = store.state.activeMachineId;
    const session = currentMachineSession(machineId);
    store.update(state => {
      state.machineSessions[machineId] = { ...session, status: 'stopped', statusNote: 'Aguardando nova OP', updatedAt: new Date().toISOString() };
    }, 'order-stopped');
    closeLayer(false);
    render();
    return;
  }
  if (nextOrder === 'done') {
    closeLayer(false);
    render();
    return;
  }

  const period = event.target.closest('[data-history-period]')?.dataset.historyPeriod;
  if (period) {
    store.update(state => {
      state.ui ||= {};
      state.ui.historyPeriod = period;
    }, 'history-period');
  }
});

document.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'loginForm') submitLogin(event.target);
  if (event.target.id === 'conferenceForm') submitConference(event.target);
  if (event.target.id === 'closeOrderForm') submitCloseOrder(event.target);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && layers.firstElementChild) closeLayer();
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});

store.subscribe((_state, reason) => {
  if (!['conference-draft'].includes(reason)) render();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service Worker indisponível:', error));
}

async function start() {
  store.update(state => {
    state.ui ||= {};
    if (!ROUTES.has(state.ui.route)) state.ui.route = 'turn';
    state.ui.historyPeriod ||= 'today';
  }, 'ui-normalize');
  render();
  if (API_BASE) {
    await Promise.allSettled([loadCloudCatalog(), loadCloudRecords()]);
  }
  if (!store.state.session) return loginSheet();
  await loadAssignments();
  render();
  if (!store.state.assignments.length) openAssignments();
}

start();