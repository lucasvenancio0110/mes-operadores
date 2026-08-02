import {
  store, api, API_BASE, uid, localDateKey, formatDate, formatClock, formatNumber,
  parseNumber, parseCycle, formatCycle, detectShift, minutesRemaining, getLine,
  getMachine, currentMachineSession, calculateSession, deriveAlerts, loadCloudCatalog,
  loadCloudRecords, loginOperator, loadAssignments, saveAssignments, getShiftContext,
  productionTotalFromRecords
} from './core.js';
import {
  escapeHtml, icon, statusMeta, renderHeader, renderConnection, renderSessionStrip,
  renderMachineRail, renderOverview, renderMachines, renderAndon, renderAlerts,
  renderMore, renderNavigation
} from './components.js';

const app = document.getElementById('app');
const layers = document.getElementById('layers');
const toastRegion = document.getElementById('toastRegion');
let toastTimer = null;
let installPrompt = null;
let assignmentDraft = [];
let assignmentStage = 'review';
let assignmentLineId = '';
let conferenceDraft = null;
let conferenceStep = 1;
let pointingMode = 'shift';
let returnFocus = null;

function toast(message) {
  clearTimeout(toastTimer);
  toastRegion.innerHTML = `<div class="toast is-visible" role="status">${escapeHtml(message)}</div>`;
  toastTimer = setTimeout(() => { toastRegion.innerHTML = ''; }, 2800);
}

function setRoute(route) {
  store.update(state => { state.ui.route = route; }, 'route');
  window.scrollTo({ top:0, behavior:'smooth' });
}

function activeTitle(route) {
  return ({ overview:'Visão geral', machines:'Máquinas do turno', andon:'Andon operacional', alerts:'Alertas', more:'Mais' })[route] || 'Visão geral';
}

function render() {
  const state = store.state;
  const route = state.ui.route || 'overview';
  const view = route === 'overview' ? renderOverview(state)
    : route === 'machines' ? renderMachines(state)
    : route === 'andon' ? renderAndon(state)
    : route === 'alerts' ? renderAlerts(state)
    : renderMore(state);

  app.innerHTML = `
    <div class="app-shell">
      ${renderHeader(state)}
      ${renderConnection(state)}
      <main class="page">
        ${renderSessionStrip(state)}
        <section class="machine-rail-wrap" aria-label="Máquinas do turno">${renderMachineRail(state)}</section>
        <header class="page-head"><div><p class="eyebrow">Central operacional</p><h1>${escapeHtml(activeTitle(route))}</h1></div>${route === 'alerts' ? `<span class="status-badge" data-status="pending">${deriveAlerts().filter(item => !state.acknowledgements[item.id]).length} pendentes</span>` : ''}</header>
        <section class="view is-active" id="currentView">${view}</section>
      </main>
      ${renderNavigation(route)}
    </div>`;

  bindInputsAfterRender();
}

function bindInputsAfterRender() {
  document.getElementById('machineSearch')?.addEventListener('input', event => {
    store.update(state => { state.ui.machineSearch = event.target.value; }, 'machine-search');
  });
}

function openLayer(content, id = 'activeLayer') {
  closeLayer(false);
  returnFocus = document.activeElement;
  layers.innerHTML = `<div class="layer is-open" id="${id}">${content}</div>`;
  document.body.style.overflow = 'hidden';
  const first = layers.querySelector('input,select,textarea,button');
  setTimeout(() => first?.focus(), 40);
}

function closeLayer(restore = true) {
  layers.innerHTML = '';
  document.body.style.overflow = '';
  if (restore) returnFocus?.focus?.();
}

function sheet(title, eyebrow, body, actions = '', options = {}) {
  return `<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <header class="sheet-head"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2 id="sheetTitle">${escapeHtml(title)}</h2></div><button class="close-button" type="button" data-close-layer aria-label="Fechar">×</button></header>
    ${body}${actions ? `<footer class="sheet-actions">${actions}</footer>` : ''}
  </section>`;
}

function loginSheet() {
  const shift = store.state.session?.shift || detectShift();
  const body = `<form id="loginForm" novalidate>
    <p class="subtle">Sua identificação fica salva neste aparelho. O banco aprende o operador após o primeiro acesso sincronizado.</p>
    <div class="field"><label for="loginName">Nome</label><input id="loginName" autocomplete="name" required></div>
    <div class="field"><label for="loginRegistration">Matrícula</label><input id="loginRegistration" inputmode="numeric" autocomplete="username" required></div>
    <div class="field"><label for="loginShift">Turno</label><select id="loginShift"><option value="1" ${shift === '1' ? 'selected' : ''}>1º turno</option><option value="2" ${shift === '2' ? 'selected' : ''}>2º turno</option><option value="3" ${shift === '3' ? 'selected' : ''}>3º turno</option></select></div>
    <div class="field-error" id="loginError" role="alert"></div>
  </form>`;
  openLayer(sheet('Entrar no turno','Identificação',body,'<button class="btn btn-ghost" type="button" data-close-layer>Cancelar</button><button class="btn btn-primary" type="submit" form="loginForm">Entrar</button>'),'loginLayer');
}

async function submitLogin(form) {
  const name = form.querySelector('#loginName').value.trim();
  const registration = form.querySelector('#loginRegistration').value.trim();
  const shift = form.querySelector('#loginShift').value;
  if (!name || !registration) {
    form.querySelector('#loginError').textContent = 'Informe nome e matrícula.';
    return;
  }
  const submit = layers.querySelector('[type="submit"]');
  submit.disabled = true; submit.textContent = 'Entrando…';
  await loginOperator({ name, registration, shift });
  closeLayer(false); render();
  if (!store.state.assignments.length) openAssignments();
  toast(`Olá, ${name}. Sessão iniciada no ${shift}º turno.`);
}

function menuSheet() {
  const session = store.state.session;
  const body = `<div class="action-list">
    <div class="read-only"><span>Operador conectado</span><strong>${escapeHtml(session?.name || 'Nenhum')}</strong><small class="subtle">${session ? `Matrícula ${escapeHtml(session.registration)} · ${escapeHtml(session.shift)}º turno` : ''}</small></div>
    <button class="action-row" type="button" data-action="assign-machines"><div><strong>Máquinas do turno</strong><span>Consultar ou trocar as máquinas acompanhadas</span></div>${icon('chevron')}</button>
    <button class="action-row" type="button" data-action="change-shift"><div><strong>Alterar turno</strong><span>Atualiza a sessão e as máquinas vinculadas</span></div>${icon('chevron')}</button>
    <button class="action-row" type="button" data-action="sync"><div><strong>Sincronizar agora</strong><span>${store.state.syncQueue.length ? `${store.state.syncQueue.length} pendências` : 'Sem pendências locais'}</span></div>${icon('sync')}</button>
    <button class="action-row" type="button" data-action="logout"><div><strong style="color:var(--color-danger)">Sair</strong><span>Trocar operador neste aparelho</span></div>${icon('logout')}</button>
  </div>`;
  openLayer(sheet('Menu','NEODENT MES',body),'menuLayer');
}

function shiftSheet() {
  const current = String(store.state.session?.shift || detectShift());
  const body = `<p class="subtle">O novo turno será usado nas máquinas, conferências e apontamentos desta sessão.</p><div class="option-grid">${['1','2','3'].map(value => `<button class="option-card" type="button" data-shift-choice="${value}" aria-pressed="${value === current}"><strong>${value}º turno</strong><span>${value === '1' ? '06:30–14:30' : value === '2' ? '14:30–22:30' : '22:30–06:30'}</span></button>`).join('')}</div>`;
  openLayer(sheet('Alterar turno','Sessão do operador',body,'<button class="btn btn-ghost" type="button" data-close-layer>Cancelar</button><button class="btn btn-primary" type="button" id="confirmShift" data-value="'+current+'">Confirmar turno</button>'),'shiftLayer');
}

function openAssignments() {
  if (!store.state.session) return loginSheet();
  assignmentDraft = store.state.assignments.map(item => ({ lineId:item.lineId, machineId:item.machineId }));
  assignmentStage = assignmentDraft.length ? 'review' : 'lines';
  assignmentLineId = '';
  renderAssignmentSheet();
}

function assignmentContent() {
  if (assignmentStage === 'review') {
    const selected = assignmentDraft.length ? assignmentDraft.map((item,index) => {
      const machine = getMachine(item.machineId);
      return `<div class="selected-machine"><span class="selected-machine-index">${index + 1}</span><div><strong>${escapeHtml(machine?.name || item.machineId)}</strong><small class="subtle">${escapeHtml(machine?.lineName || '')}</small></div><button type="button" data-remove-assignment="${index}" aria-label="Remover máquina">×</button></div>`;
    }).join('') : '<p class="subtle">Nenhuma máquina selecionada.</p>';
    return `<p class="subtle">Selecione pelo menos três máquinas para iniciar. Você poderá adicionar mais durante o turno.</p><div class="selected-machine-list">${selected}</div><button class="btn btn-secondary btn-full" type="button" data-assignment-add>＋ Adicionar máquina</button>`;
  }
  if (assignmentStage === 'lines') {
    return `<p class="subtle">Escolha a linha da máquina ${assignmentDraft.length + 1}.</p><div class="line-grid">${store.state.catalog.map(line => `<button class="select-card" type="button" data-assignment-line="${escapeHtml(line.id)}"><strong>${escapeHtml(line.name)}</strong><span>${line.machines.length} equipamentos</span></button>`).join('')}</div>`;
  }
  const line = getLine(assignmentLineId);
  const used = new Set(assignmentDraft.map(item => item.machineId));
  return `<p class="subtle">${escapeHtml(line?.name || '')} · escolha a máquina.</p><label class="search-field" style="display:block;margin-bottom:10px">${icon('search')}<input id="assignmentSearch" type="search" placeholder="Buscar TNL" aria-label="Buscar máquina"></label><div class="machine-grid" id="assignmentMachineGrid">${(line?.machines || []).map(machine => `<button class="select-card" type="button" data-assignment-machine="${escapeHtml(machine.id)}" ${used.has(machine.id) ? 'disabled' : ''}><strong>${escapeHtml(machine.name)}</strong><span>${escapeHtml(machine.equipmentType || 'TNL')}</span></button>`).join('')}</div>`;
}

function renderAssignmentSheet() {
  const canFinish = assignmentDraft.length >= 3;
  const back = assignmentStage === 'review' ? '<button class="btn btn-ghost" type="button" data-close-layer>Cancelar</button>' : '<button class="btn btn-ghost" type="button" data-assignment-back>Voltar</button>';
  const finish = assignmentStage === 'review' ? `<button class="btn btn-primary" type="button" data-assignment-finish ${canFinish ? '' : 'disabled'}>Salvar máquinas</button>` : '<button class="btn btn-primary" type="button" disabled>Selecione uma opção</button>';
  openLayer(sheet('Quais são suas máquinas?','Início do turno',`<div class="wizard-progress"><span class="is-done"></span><span class="${assignmentDraft.length >= 1 ? 'is-done' : ''}"></span><span class="${assignmentDraft.length >= 2 ? 'is-done' : ''}"></span><span class="${assignmentDraft.length >= 3 ? 'is-done' : ''}"></span><span></span></div>${assignmentContent()}`,`${back}${finish}`),'assignmentLayer');
  document.getElementById('assignmentSearch')?.addEventListener('input', event => {
    const query = event.target.value.toLowerCase();
    layers.querySelectorAll('[data-assignment-machine]').forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(query); });
  });
}

async function finishAssignments() {
  if (assignmentDraft.length < 3) return;
  const assignments = assignmentDraft.map((item,index) => ({ id:`assignment-${localDateKey()}-${index + 1}`, slotOrder:index + 1, ...item }));
  await saveAssignments(assignments);
  closeLayer(false); render(); toast(`${assignments.length} máquinas vinculadas ao turno.`);
  const firstPending = assignments.find(item => !currentMachineSession(item.machineId));
  if (firstPending) { store.update(state => { state.activeMachineId = firstPending.machineId; }, 'active-machine'); openConference(); }
}

function conferenceDefaults(machineId, preset = {}) {
  const machine = getMachine(machineId);
  const saved = currentMachineSession(machineId);
  const draft = store.state.conferenceDrafts[machineId];
  return {
    machineId,
    lineId:machine?.lineId || '',
    machineName:machine?.name || '',
    lineName:machine?.lineName || '',
    op:'', item:'', description:'', cycleSeconds:null, frequency1:null, frequency2:null,
    producedSoFar:0, availableMinutes:minutesRemaining(store.state.session?.shift || detectShift()),
    bars:null, piecesPerBar:null, materialLength:null, fixtures:'', tools:'', status:'producing', notes:'',
    checkedAt:null, updatedAt:new Date().toISOString(),
    ...(saved || {}), ...(draft || {}), ...preset
  };
}

function openConference(preset = {}) {
  if (!store.state.activeMachineId) return openAssignments();
  conferenceDraft = conferenceDefaults(store.state.activeMachineId,preset);
  conferenceStep = 1;
  renderConferenceSheet();
}

function conferenceStepContent() {
  const d = conferenceDraft;
  if (conferenceStep === 1) return `<div class="wizard-step-title"><h3>Identificação da ordem</h3><p>Confirme a OP e o item que estão em produção.</p></div><div class="form-grid two"><div class="field"><label for="confOp">OP</label><input id="confOp" inputmode="numeric" value="${escapeHtml(d.op)}" required></div><div class="field"><label for="confItem">Código do item</label><input id="confItem" inputmode="numeric" value="${escapeHtml(d.item)}" required></div></div><div class="field"><label for="confDescription">Descrição do produto <span class="subtle">(opcional)</span></label><input id="confDescription" value="${escapeHtml(d.description)}" placeholder="Ex.: Corpo implante GTPlus"></div><div class="read-only"><span>Peças produzidas até agora</span><strong id="knownProduction">${formatNumber(d.producedSoFar)}</strong><small class="subtle">Calculado pelos apontamentos anteriores desta OP</small></div><div class="field-error" id="conferenceError"></div>`;
  if (conferenceStep === 2) return `<div class="wizard-step-title"><h3>Parâmetros de produção</h3><p>O item será aprendido para esta máquina após o apontamento.</p></div><div class="form-grid two"><div class="field"><label for="confCycle">Tempo de ciclo</label><input id="confCycle" value="${d.cycleSeconds ? formatCycle(d.cycleSeconds) : ''}" placeholder="Ex.: 5:04" required><span class="field-hint">Aceita 90, 1:30, 1,30, 00:01:30 ou 1m30s.</span></div><div class="field"><label for="confMinutes">Minutos restantes</label><input id="confMinutes" inputmode="numeric" value="${formatNumber(d.availableMinutes)}"><span class="field-hint">Calculado pelo horário atual do turno.</span></div><div class="field"><label for="confFrequency1">Frequência I</label><input id="confFrequency1" inputmode="decimal" value="${Number.isFinite(Number(d.frequency1)) ? d.frequency1 : ''}"></div><div class="field"><label for="confFrequency2">Frequência II</label><input id="confFrequency2" inputmode="decimal" value="${Number.isFinite(Number(d.frequency2)) ? d.frequency2 : ''}"></div></div><div class="field-error" id="conferenceError"></div>`;
  if (conferenceStep === 3) return `<div class="wizard-step-title"><h3>Matéria-prima e recursos</h3><p>Dados opcionais que permitem calcular autonomia e riscos.</p></div><div class="form-grid two"><div class="field"><label for="confBars">Barras disponíveis</label><input id="confBars" inputmode="numeric" value="${d.bars ?? ''}"></div><div class="field"><label for="confPiecesBar">Peças por barra</label><input id="confPiecesBar" inputmode="numeric" value="${d.piecesPerBar ?? ''}"></div><div class="field"><label for="confMaterialLength">Comprimento da matéria-prima (mm)</label><input id="confMaterialLength" inputmode="decimal" value="${d.materialLength ?? ''}"></div><div class="field"><label for="confFixtures">Gabaritos disponíveis</label><input id="confFixtures" value="${escapeHtml(d.fixtures)}" placeholder="Ex.: 1, 2, 3"></div></div><div class="field"><label for="confTools">Ferramentas ou pendências</label><input id="confTools" value="${escapeHtml(d.tools)}" placeholder="Opcional"></div>`;
  if (conferenceStep === 4) return `<div class="wizard-step-title"><h3>Status inicial da máquina</h3><p>Selecione a situação encontrada no início do acompanhamento.</p></div><div class="option-grid">${[['producing','Produzindo','Máquina operando normalmente'],['setup','Setup','Preparação ou troca de OP'],['adjustment','Ajuste','Correção de processo'],['stopped','Parada','Aguardando atuação'],['maintenance','Manutenção','Equipe técnica atuando']].map(([value,title,detail]) => `<button class="option-card" type="button" data-conference-status="${value}" aria-pressed="${d.status === value}"><strong>${title}</strong><span>${detail}</span></button>`).join('')}</div><div class="field" style="margin-top:14px"><label for="confNotes">Observações iniciais</label><textarea id="confNotes" placeholder="Pendências, riscos ou informações para o próximo turno">${escapeHtml(d.notes)}</textarea></div>`;
  const cycleMinutes = Number(d.cycleSeconds) / 60;
  const target = cycleMinutes > 0 ? Number(d.availableMinutes) / cycleMinutes : NaN;
  const potential = Number(d.bars || 0) * Number(d.piecesPerBar || 0);
  return `<div class="wizard-step-title"><h3>Revisar conferência</h3><p>Confira os dados antes de iniciar o acompanhamento.</p></div><div class="review-list"><div class="review-row"><span>Máquina</span><strong>${escapeHtml(d.machineName)}</strong></div><div class="review-row"><span>OP</span><strong>${escapeHtml(d.op)}</strong></div><div class="review-row"><span>Item</span><strong>${escapeHtml(d.item)}</strong></div><div class="review-row"><span>Produzidas até agora</span><strong>${formatNumber(d.producedSoFar)}</strong></div><div class="review-row"><span>Ciclo</span><strong>${formatCycle(d.cycleSeconds)}</strong></div><div class="review-row"><span>Meta do período</span><strong>${formatNumber(target,1)}</strong></div><div class="review-row"><span>Previsão ao final</span><strong>${formatNumber(Number(d.producedSoFar) + (Number.isFinite(target) ? target : 0),1)}</strong></div><div class="review-row"><span>Potencial de material</span><strong>${potential ? `${formatNumber(potential)} peças` : 'Não informado'}</strong></div><div class="review-row"><span>Status</span><strong>${escapeHtml(statusMeta(d.status).label)}</strong></div></div>`;
}

function renderConferenceSheet() {
  const body = `<div class="wizard-progress">${[1,2,3,4,5].map(value => `<span class="${value <= conferenceStep ? 'is-done' : ''}"></span>`).join('')}</div>${conferenceStepContent()}`;
  const back = conferenceStep === 1 ? '<button class="btn btn-ghost" type="button" data-close-layer>Cancelar</button>' : '<button class="btn btn-ghost" type="button" data-conference-back>Voltar</button>';
  const next = conferenceStep === 5 ? '<button class="btn btn-primary" type="button" data-conference-save>Confirmar conferência</button>' : '<button class="btn btn-primary" type="button" data-conference-next>Continuar</button>';
  openLayer(sheet('Conferência inicial',`${conferenceDraft.machineName} · etapa ${conferenceStep} de 5`,body,back + next),'conferenceLayer');
  if (conferenceStep === 1) {
    document.getElementById('confOp')?.addEventListener('blur', hydrateConferenceFromCloud);
    document.getElementById('confItem')?.addEventListener('blur', hydrateItemParameters);
  }
}

async function hydrateConferenceFromCloud() {
  const op = document.getElementById('confOp')?.value.trim();
  if (!op) return;
  conferenceDraft.op = op;
  const local = productionTotalFromRecords(conferenceDraft.machineId,op);
  let total = local;
  const context = await getShiftContext(conferenceDraft.machineId,op);
  if (context?.lastSession?.finalProduction !== null && context?.lastSession?.finalProduction !== undefined) total = Math.max(total,Number(context.lastSession.finalProduction) || 0);
  else if (context?.producedTotal) total = Math.max(total,Number(context.producedTotal) || 0);
  conferenceDraft.producedSoFar = total;
  const display = document.getElementById('knownProduction'); if (display) display.textContent = formatNumber(total);
  if (API_BASE) {
    try {
      const payload = await api.get(`/api/v1/orders?op=${encodeURIComponent(op)}`);
      if (payload.order?.item && !document.getElementById('confItem').value) { document.getElementById('confItem').value = payload.order.item; conferenceDraft.item = payload.order.item; await hydrateItemParameters(); }
    } catch {}
  }
}

async function hydrateItemParameters() {
  const item = document.getElementById('confItem')?.value.trim();
  if (!item || !API_BASE) return;
  conferenceDraft.item = item;
  try {
    const payload = await api.get(`/api/v1/items?itemNumber=${encodeURIComponent(item)}&machineId=${encodeURIComponent(conferenceDraft.machineId)}`);
    const known = payload.items?.[0];
    if (!known) return;
    conferenceDraft.description ||= known.description || '';
    conferenceDraft.cycleSeconds ||= Number(known.cycleTimeSeconds) || null;
    conferenceDraft.frequency1 ??= known.frequency1;
    conferenceDraft.frequency2 ??= known.frequency2;
  } catch {}
}

function captureConferenceStep() {
  const error = document.getElementById('conferenceError');
  if (conferenceStep === 1) {
    conferenceDraft.op = document.getElementById('confOp').value.trim();
    conferenceDraft.item = document.getElementById('confItem').value.trim();
    conferenceDraft.description = document.getElementById('confDescription').value.trim();
    if (!conferenceDraft.op || !conferenceDraft.item) { error.textContent = 'Informe a OP e o código do item.'; return false; }
  }
  if (conferenceStep === 2) {
    const cycle = parseCycle(document.getElementById('confCycle').value);
    if (!Number.isFinite(cycle) || cycle <= 0) { error.textContent = 'Informe um tempo de ciclo válido.'; return false; }
    conferenceDraft.cycleSeconds = cycle;
    conferenceDraft.availableMinutes = parseNumber(document.getElementById('confMinutes').value) || minutesRemaining(store.state.session.shift);
    conferenceDraft.frequency1 = parseNumber(document.getElementById('confFrequency1').value);
    conferenceDraft.frequency2 = parseNumber(document.getElementById('confFrequency2').value);
  }
  if (conferenceStep === 3) {
    conferenceDraft.bars = parseNumber(document.getElementById('confBars').value);
    conferenceDraft.piecesPerBar = parseNumber(document.getElementById('confPiecesBar').value);
    conferenceDraft.materialLength = parseNumber(document.getElementById('confMaterialLength').value);
    conferenceDraft.fixtures = document.getElementById('confFixtures').value.trim();
    conferenceDraft.tools = document.getElementById('confTools').value.trim();
  }
  if (conferenceStep === 4) conferenceDraft.notes = document.getElementById('confNotes').value.trim();
  conferenceDraft.updatedAt = new Date().toISOString();
  store.update(state => { state.conferenceDrafts[conferenceDraft.machineId] = conferenceDraft; }, 'conference-draft');
  return true;
}

async function saveConference() {
  const calcMinutes = Number(conferenceDraft.availableMinutes || minutesRemaining(store.state.session.shift));
  const session = {
    ...conferenceDraft,
    availableMinutes:calcMinutes,
    target:calcMinutes / (conferenceDraft.cycleSeconds / 60),
    producedThisShift:0,
    checkedAt:conferenceDraft.checkedAt || new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    operatorName:store.state.session.name,
    registration:store.state.session.registration
  };
  store.update(state => {
    state.machineSessions[session.machineId] = session;
    delete state.conferenceDrafts[session.machineId];
  }, 'conference-save');
  if (API_BASE) {
    try {
      await api.post('/api/v1/shift-sessions', {
        id:`shift-${localDateKey()}-${store.state.session.shift}-${store.state.session.registration}-${session.machineId}-${session.op}`.replace(/[^a-zA-Z0-9-_]/g,'-'),
        productionDate:localDateKey(), shift:store.state.session.shift, registration:store.state.session.registration, operatorName:store.state.session.name,
        lineId:session.lineId, lineName:session.lineName, machineId:session.machineId, machineName:session.machineName,
        opNumber:session.op, itemNumber:session.item, cycleTimeSeconds:session.cycleSeconds, frequency1:session.frequency1, frequency2:session.frequency2,
        openingProduction:session.producedSoFar, availableMinutes:session.availableMinutes, target:session.target,
        finalProduction:null, status:'open', openedAt:session.checkedAt, updatedAt:session.updatedAt
      });
    } catch { toast('Conferência salva no aparelho e pendente de sincronização.'); }
  }
  closeLayer(false); render(); toast(`${session.machineName} conferida.`);
}

function openStatusSheet() {
  const session = currentMachineSession();
  if (!session) return openConference();
  const body = `<p class="subtle">Atualize a situação atual da máquina.</p><div class="option-grid">${[['producing','Produzindo'],['setup','Setup'],['adjustment','Ajuste'],['stopped','Parada'],['maintenance','Manutenção']].map(([value,label]) => `<button class="option-card" type="button" data-status-choice="${value}" aria-pressed="${session.status === value}"><strong>${label}</strong><span>${value === 'producing' ? 'Operação normal' : 'Atualizar status operacional'}</span></button>`).join('')}</div><div class="field" style="margin-top:14px"><label for="statusNote">Observação <span class="subtle">(opcional)</span></label><textarea id="statusNote">${escapeHtml(session.statusNote || '')}</textarea></div>`;
  openLayer(sheet('Atualizar status',session.machineName,body,'<button class="btn btn-ghost" data-close-layer type="button">Cancelar</button><button class="btn btn-primary" id="saveStatus" type="button" data-value="'+session.status+'">Salvar status</button>'),'statusLayer');
}

function openPointing(mode = 'shift') {
  const session = currentMachineSession();
  const machine = getMachine(store.state.activeMachineId);
  if (!session) return openConference();
  pointingMode = mode;
  const calc = calculateSession(session);
  const body = `<section class="card more-card"><div class="review-list"><div class="review-row"><span>Máquina</span><strong>${escapeHtml(machine.name)}</strong></div><div class="review-row"><span>OP / Item</span><strong>${escapeHtml(session.op)} / ${escapeHtml(session.item)}</strong></div><div class="review-row"><span>Peças produzidas até agora</span><strong>${formatNumber(session.producedSoFar)}</strong></div><div class="review-row"><span>Meta deste turno</span><strong>${formatNumber(calc.target,1)}</strong></div></div></section>
  <form id="pointingForm" style="margin-top:14px"><div class="field"><label for="pointingPieces">Peças produzidas neste turno</label><input id="pointingPieces" inputmode="numeric" autocomplete="off" placeholder="Ex.: 95" required></div><div class="field"><label for="pointingNotes">Observações <span class="subtle">(opcional)</span></label><textarea id="pointingNotes" placeholder="Paradas, motivo ou atuação realizada"></textarea></div><div class="progress-block"><div class="review-list"><div class="review-row"><span>Total após este apontamento</span><strong id="pointingTotal">${formatNumber(session.producedSoFar)}</strong></div><div class="review-row"><span>Saldo da meta</span><strong id="pointingBalance">—</strong></div></div></div><div class="field-error" id="pointingError"></div></form>`;
  const primary = mode === 'close' ? 'Confirmar encerramento' : 'Confirmar apontamento';
  openLayer(sheet(mode === 'close' ? 'Encerrar ordem' : 'Confirmar apontamento',`${machine.name} · OP ${session.op}`,body,`<button class="btn btn-ghost" type="button" data-close-layer>Cancelar</button><button class="btn ${mode === 'close' ? 'btn-danger' : 'btn-primary'}" type="submit" form="pointingForm">${primary}</button>`),'pointingLayer');
  const input = document.getElementById('pointingPieces');
  input.addEventListener('input', () => {
    const produced = parseNumber(input.value);
    document.getElementById('pointingTotal').textContent = Number.isFinite(produced) ? formatNumber(Number(session.producedSoFar) + produced) : formatNumber(session.producedSoFar);
    const balance = Number.isFinite(produced) ? produced - Number(calc.target) : NaN;
    const element = document.getElementById('pointingBalance');
    element.textContent = Number.isFinite(balance) ? `${balance > 0 ? '+' : ''}${formatNumber(balance,1)}` : '—';
    element.style.color = balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
  });
}

async function submitPointing(form) {
  const session = currentMachineSession();
  const machine = getMachine(store.state.activeMachineId);
  const produced = parseNumber(form.querySelector('#pointingPieces').value);
  const notes = form.querySelector('#pointingNotes').value.trim();
  if (!Number.isFinite(produced) || produced < 0) { form.querySelector('#pointingError').textContent = 'Informe quantas peças foram produzidas neste turno.'; return; }
  const calc = calculateSession(session);
  const total = Number(session.producedSoFar || 0) + produced;
  const now = new Date().toISOString();
  const eventType = pointingMode === 'close' ? 'order-close' : 'shift-pointing';
  const record = {
    id:uid('record'), schemaVersion:3, createdAt:now, updatedAt:now, productionDate:localDateKey(), source:'neodent-mes-v3',
    operatorName:store.state.session.name, operatorRegistration:store.state.session.registration, shift:store.state.session.shift,
    lineId:machine.lineId, lineName:machine.lineName, machineId:machine.id, machineName:machine.name,
    op:session.op, item:session.item, itemDescription:session.description || '', cycleTimeSeconds:session.cycleSeconds,
    frequency1:session.frequency1, frequency2:session.frequency2, availableMinutes:session.availableMinutes,
    producedBefore:Number(session.producedSoFar || 0), producedThisShift:produced, pieces:Number(session.producedSoFar || 0),
    totalAfterPointing:total, finalProduction:total, target:calc.target, expectedProduction:calc.expectedTotal,
    balance:produced - calc.target, balanceMinutes:(produced - calc.target) * (session.cycleSeconds / 60), notes,
    eventType, orderStatus:pointingMode === 'close' ? 'closed' : 'open', status:'active', syncStatus:API_BASE ? 'pending' : 'local'
  };
  store.update(state => {
    state.records.unshift(record);
    state.machineSessions[machine.id] = { ...session, producedThisShift:produced, producedSoFar:total, status:pointingMode === 'close' ? 'closed' : 'pointed', updatedAt:now, closedAt:now };
  }, 'pointing');
  try { if (API_BASE) await api.post('/api/v1/records',record); } catch {}
  try {
    if (API_BASE) await api.post('/api/v1/shift-sessions', {
      id:`shift-${localDateKey()}-${store.state.session.shift}-${store.state.session.registration}-${machine.id}-${session.op}`.replace(/[^a-zA-Z0-9-_]/g,'-'),
      productionDate:localDateKey(), shift:store.state.session.shift, registration:store.state.session.registration, operatorName:store.state.session.name,
      lineId:machine.lineId, lineName:machine.lineName, machineId:machine.id, machineName:machine.name,
      opNumber:session.op, itemNumber:session.item, cycleTimeSeconds:session.cycleSeconds, frequency1:session.frequency1, frequency2:session.frequency2,
      openingProduction:Number(session.producedSoFar || 0), availableMinutes:session.availableMinutes, target:calc.target,
      finalProduction:total, status:'closed', openedAt:session.checkedAt, closedAt:now, updatedAt:now
    });
  } catch {}
  closeLayer(false); render();
  if (pointingMode === 'close') openNextOrderSheet(session);
  else toast(`Apontamento confirmado: ${formatNumber(produced)} peças.`);
}

function openNextOrderSheet(previous) {
  const body = `<p class="subtle">A OP ${escapeHtml(previous.op)} foi encerrada. Restam aproximadamente <strong>${formatNumber(minutesRemaining(store.state.session.shift))} minutos</strong> no turno.</p><div class="action-list"><button class="action-row" type="button" data-next-order="same"><div><strong>Nova OP com o mesmo item</strong><span>Mantém item, ciclo e frequências</span></div>${icon('chevron')}</button><button class="action-row" type="button" data-next-order="other"><div><strong>Nova OP com outro item</strong><span>Inicia uma nova conferência</span></div>${icon('chevron')}</button><button class="action-row" type="button" data-next-order="stopped"><div><strong>Máquina ficará parada</strong><span>Nenhuma nova ordem agora</span></div>${icon('chevron')}</button></div>`;
  openLayer(sheet('O que será iniciado agora?','Ordem encerrada',body),'nextOrderLayer');
}

function openInstall() {
  if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; }); }
  else toast('No iPhone, use Compartilhar → Adicionar à Tela de Início.');
}

function copySummary() {
  const state = store.state;
  const lines = [`NEODENT MES — ${formatDate()}`,`${state.session?.name || ''} · ${state.session?.shift || ''}º turno`,''];
  for (const assignment of state.assignments) {
    const machine = getMachine(assignment.machineId); const session = currentMachineSession(assignment.machineId); const calc = calculateSession(session);
    lines.push(`${machine.name} — ${session ? statusMeta(session.status).label : 'Conferência pendente'}`);
    if (session) lines.push(`OP ${session.op} · Item ${session.item} · Produzido ${formatNumber(session.producedThisShift || 0)}/${formatNumber(calc.target,1)} · Ciclo ${formatCycle(session.cycleSeconds)}`);
  }
  navigator.clipboard?.writeText(lines.join('\n')).then(() => toast('Resumo copiado.')).catch(() => toast('Não foi possível copiar o resumo.'));
}

function exportCsv() {
  const headers = ['Data','Hora','Máquina','Linha','OP','Item','Operador','Turno','Produzido no turno','Total após apontamento','Meta','Saldo','Evento','Observações'];
  const rows = store.state.records.map(record => [record.productionDate,formatClock(record.createdAt),record.machineName,record.lineName,record.op,record.item,record.operatorName,record.shift,record.producedThisShift,record.totalAfterPointing,record.target,record.balance,record.eventType,record.notes]);
  const csv = [headers,...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g,'""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download=`neodent-mes-${localDateKey()}.csv`; link.click(); URL.revokeObjectURL(url); toast('CSV gerado.');
}

async function syncNow() {
  store.update(state => { state.sync.status = 'pending'; }, 'sync');
  try { await api.flushQueue(); await Promise.allSettled([loadCloudCatalog(),loadCloudRecords(),loadAssignments()]); store.update(state => { state.sync.status='synced'; state.sync.error=''; state.sync.lastSyncAt=new Date().toISOString(); },'sync'); toast('Dados sincronizados.'); }
  catch (error) { store.update(state => { state.sync.status='error'; state.sync.error=error.message; },'sync'); toast('Não foi possível sincronizar agora.'); }
}

function logout() {
  store.update(state => { state.session=null; state.assignments=[]; state.activeMachineId=''; state.ui.route='overview'; },'logout');
  closeLayer(false); render(); loginSheet();
}

app.addEventListener('click', event => {
  const route = event.target.closest('[data-route]'); if (route) return setRoute(route.dataset.route);
  const machine = event.target.closest('[data-machine-id]'); if (machine) { store.update(state => { state.activeMachineId=machine.dataset.machineId; state.ui.route='overview'; },'active-machine'); return; }
  const filter = event.target.closest('[data-machine-filter]'); if (filter) return store.update(state => { state.ui.machineFilter=filter.dataset.machineFilter; },'machine-filter');
  const alertFilter = event.target.closest('[data-alert-filter]'); if (alertFilter) return store.update(state => { state.ui.alertFilter=alertFilter.dataset.alertFilter; },'alert-filter');
  const ack = event.target.closest('[data-ack-alert]'); if (ack) return store.update(state => { state.acknowledgements[ack.dataset.ackAlert]=new Date().toISOString(); },'alert-ack');
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'assign-machines') openAssignments();
  else if (action === 'open-conference') openConference();
  else if (action === 'open-pointing') openPointing('shift');
  else if (action === 'close-order') openPointing('close');
  else if (action === 'set-status') openStatusSheet();
  else if (action === 'sync') syncNow();
  else if (action === 'change-shift') shiftSheet();
  else if (action === 'copy-summary') copySummary();
  else if (action === 'export-csv') exportCsv();
  else if (action === 'install-app') openInstall();
  else if (action === 'logout') logout();
});

layers.addEventListener('click', event => {
  if (event.target.matches('.layer')) return closeLayer();
  if (event.target.closest('[data-close-layer]')) return closeLayer();
  const line = event.target.closest('[data-assignment-line]'); if (line) { assignmentLineId=line.dataset.assignmentLine; assignmentStage='machines'; return renderAssignmentSheet(); }
  const machine = event.target.closest('[data-assignment-machine]'); if (machine) { assignmentDraft.push({lineId:assignmentLineId,machineId:machine.dataset.assignmentMachine}); assignmentStage='review'; assignmentLineId=''; return renderAssignmentSheet(); }
  const remove = event.target.closest('[data-remove-assignment]'); if (remove) { assignmentDraft.splice(Number(remove.dataset.removeAssignment),1); return renderAssignmentSheet(); }
  if (event.target.closest('[data-assignment-add]')) { assignmentStage='lines'; return renderAssignmentSheet(); }
  if (event.target.closest('[data-assignment-back]')) { assignmentStage=assignmentStage === 'machines' ? 'lines' : 'review'; return renderAssignmentSheet(); }
  if (event.target.closest('[data-assignment-finish]')) return finishAssignments();
  const status = event.target.closest('[data-conference-status]'); if (status) { conferenceDraft.status=status.dataset.conferenceStatus; layers.querySelectorAll('[data-conference-status]').forEach(button => button.setAttribute('aria-pressed',String(button === status))); return; }
  if (event.target.closest('[data-conference-next]')) { if (captureConferenceStep()) { conferenceStep++; renderConferenceSheet(); } return; }
  if (event.target.closest('[data-conference-back]')) { captureConferenceStep(); conferenceStep=Math.max(1,conferenceStep-1); renderConferenceSheet(); return; }
  if (event.target.closest('[data-conference-save]')) return saveConference();
  const shiftChoice = event.target.closest('[data-shift-choice]'); if (shiftChoice) { layers.querySelectorAll('[data-shift-choice]').forEach(button => button.setAttribute('aria-pressed',String(button === shiftChoice))); document.getElementById('confirmShift').dataset.value=shiftChoice.dataset.shiftChoice; return; }
  if (event.target.id === 'confirmShift') {
    const value=event.target.dataset.value; store.update(state => { state.session.shift=value; state.session.productionDate=localDateKey(); state.assignments=[]; state.activeMachineId=''; },'shift-change'); closeLayer(false); render(); return loadAssignments().then(() => { if (!store.state.assignments.length) openAssignments(); });
  }
  const statusChoice = event.target.closest('[data-status-choice]'); if (statusChoice) { layers.querySelectorAll('[data-status-choice]').forEach(button => button.setAttribute('aria-pressed',String(button === statusChoice))); document.getElementById('saveStatus').dataset.value=statusChoice.dataset.statusChoice; return; }
  if (event.target.id === 'saveStatus') { const value=event.target.dataset.value; const note=document.getElementById('statusNote').value.trim(); store.update(state => { const session=state.machineSessions[state.activeMachineId]; session.status=value; session.statusNote=note; session.updatedAt=new Date().toISOString(); },'status'); closeLayer(false); render(); return toast('Status atualizado.'); }
  const next = event.target.closest('[data-next-order]'); if (next) {
    const previous=currentMachineSession(); const choice=next.dataset.nextOrder;
    if (choice === 'stopped') { store.update(state => { state.machineSessions[state.activeMachineId]={...previous,op:'',item:'',status:'stopped',producedThisShift:0,availableMinutes:minutesRemaining(state.session.shift),updatedAt:new Date().toISOString()}; },'order-stopped'); closeLayer(false); render(); return toast('Máquina marcada como parada.'); }
    store.update(state => { delete state.machineSessions[state.activeMachineId]; },'next-order'); closeLayer(false);
    return openConference(choice === 'same' ? { item:previous.item,description:previous.description,cycleSeconds:previous.cycleSeconds,frequency1:previous.frequency1,frequency2:previous.frequency2,availableMinutes:minutesRemaining(store.state.session.shift),producedSoFar:0 } : { availableMinutes:minutesRemaining(store.state.session.shift),producedSoFar:0 });
  }
});

layers.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'loginForm') submitLogin(event.target);
  if (event.target.id === 'pointingForm') submitPointing(event.target);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && layers.innerHTML) closeLayer();
});

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt=event; });
store.subscribe(() => render());

async function bootstrap() {
  render();
  if ('serviceWorker' in navigator && !window.location.hostname.endsWith('github.io')) navigator.serviceWorker.register('/sw.js').catch(console.error);
  if (!store.state.session) loginSheet();
  else {
    await Promise.allSettled([loadCloudCatalog(),loadCloudRecords(),loadAssignments(),api.flushQueue()]);
    render();
    if (!store.state.assignments.length) openAssignments();
  }
  window.setInterval(() => { if (store.state.session) render(); },60000);
}

bootstrap();
