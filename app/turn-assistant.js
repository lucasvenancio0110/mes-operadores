import {
  store, api, API_BASE, getMachine, currentMachineSession, localDateKey,
  formatNumber, formatClock, formatCycle, parseCycle
} from './core.js';
import { escapeHtml, statusMeta } from './components.js';
import { calculateMeasurementPlans } from './measurement-engine.js';
import {
  DEFAULT_SHIFT_MINUTES, calculateFullShiftTarget, listMeasurementReleases,
  shiftWindow, calculateOrderForecast, calculatePointingAccounting,
  operatorCardState, formatDuration, predictionMessage
} from './turn-assistant-engine.js?v=6.0.0';
import { bindAssistantSubmit, formControlValue, isAssistantForm } from './turn-assistant-submit.js?v=6.0.1';

const layers = document.getElementById('layers');
const VERSION = '6.0.1';
const BAR_LENGTH_MM = 3600;
const KERF_MM = 1;
let contextCache = new Map();
let reconciliationKeys = new Set();
let activeFlow = null;
let frame = 0;
let observerBusy = false;

function shiftKey() {
  const session = store.state.session;
  return session ? `${session.productionDate || localDateKey()}|${session.shift}` : '';
}

function authReady() {
  return Boolean(window.NEOMES_AUTH?.user && store.state.session);
}

function machineInfo(machineId) {
  return getMachine(machineId) || { id:machineId,name:machineId,lineId:'',lineName:'' };
}

function nowIso() { return new Date().toISOString(); }
function asInteger(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0,Math.floor(number)) : NaN;
}
function asNumber(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  const number = Number(String(value).replace(',','.'));
  return Number.isFinite(number) ? number : NaN;
}
function clock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const today = localDateKey(date) === localDateKey();
  return `${today ? '' : `${date.toLocaleDateString('pt-BR',{ day:'2-digit',month:'2-digit' })} · `}${formatClock(date)}`;
}
function closeAssistantLayer() {
  if (!layers) return;
  layers.innerHTML = '';
  document.body.classList.remove('has-layer');
  activeFlow = null;
}
function openAssistantLayer(content, id = 'turnAssistantLayer') {
  if (!layers) return;
  layers.innerHTML = `<div class="ops-layer ta-layer" id="${id}" data-turn-assistant="${VERSION}">${content}</div>`;
  document.body.classList.add('has-layer');
  window.setTimeout(() => layers.querySelector('input,button,select,textarea')?.focus?.({ preventScroll:true }),30);
}
function sheet({ title, eyebrow = 'ASSISTENTE DO TURNO', body, actions = '', wide = true }) {
  return `<section class="ops-sheet ta-sheet ${wide ? 'ops-sheet--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="taTitle">
    <header class="ops-sheet__head ta-sheet__head"><div><p class="ops-eyebrow">${escapeHtml(eyebrow)}</p><h2 id="taTitle">${escapeHtml(title)}</h2></div><button class="ops-icon-btn" type="button" data-ta-close aria-label="Fechar">×</button></header>
    <div class="ops-sheet__body ta-sheet__body">${body}</div>
    ${actions ? `<footer class="ops-sheet__actions ta-sheet__actions"><div class="ta-submit-feedback" data-ta-submit-feedback role="status" aria-live="polite"></div>${actions}</footer>` : ''}
  </section>`;
}
function setSubmitFeedback(form, message = '', state = '') {
  const output = form?.closest('.ta-sheet')?.querySelector('[data-ta-submit-feedback]');
  if (!output) return;
  output.textContent = message;
  output.dataset.state = state;
}
function showError(form, message) {
  const output = form?.querySelector('[data-ta-error]');
  if (output) output.textContent = message;
  setSubmitFeedback(form,message,message ? 'error' : '');
}
function assistantSubmitButton(form) {
  return layers?.querySelector(`[data-ta-submit-form="${form.id}"]`)
    || form?.querySelector('button[type="submit"]')
    || null;
}
function setBusy(button, busy, label = 'Salvando…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText ||= button.textContent;
    button.disabled = true;
    button.textContent = label;
    const form = document.getElementById(button.dataset.taSubmitForm || button.getAttribute('form') || '');
    setSubmitFeedback(form,label,'working');
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}
async function getContext(machineId, force = false) {
  const session = store.state.session;
  const machine = machineInfo(machineId);
  const key = `${machineId}|${shiftKey()}`;
  if (!force && contextCache.has(key)) return contextCache.get(key);
  if (!API_BASE || !session) return {
    activeOrder:null,segments:[],turnClock:{ totalMinutes:480,usedMinutes:0,remainingMinutes:480 },
    turnState:{ workflowStatus:'conference_pending',accountedMinutes:0 },
    runtimeState:{ physicalStatus:'stopped' },
    flowAxes:{ physicalStatus:'stopped',opStatus:'none',workflowStatus:'conference_pending' }
  };
  try {
    const query = new URLSearchParams({
      machineId,
      lineId:machine.lineId || '',
      productionDate:session.productionDate || localDateKey(),
      shift:String(session.shift)
    });
    const payload = await api.get(`/api/v1/turn-assistant/context?${query}`);
    contextCache.set(key,payload);
    return payload;
  } catch (error) {
    console.warn('Contexto do assistente indisponível:',error);
    return {
      activeOrder:null,segments:[],turnClock:{ totalMinutes:480,usedMinutes:0,remainingMinutes:480 },
      turnState:{ workflowStatus:'conference_pending',accountedMinutes:0 },
      runtimeState:{ physicalStatus:'stopped' },
      flowAxes:{ physicalStatus:'stopped',opStatus:'none',workflowStatus:'conference_pending' },
      error:error.message
    };
  }
}
async function post(path, body) {
  if (!API_BASE) throw new Error('Conexão necessária para compartilhar a passagem de turno.');
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method:'POST',
      credentials:'same-origin',
      headers:{ Accept:'application/json','Content-Type':'application/json' },
      body:JSON.stringify(body)
    });
  } catch {
    throw new Error('Sem conexão. Tente novamente quando a internet voltar.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Erro ${response.status}`);
    error.code = payload.code || '';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function localOrder(machineId) {
  const session = currentMachineSession(machineId);
  if (!session?.op || session.opStatus==='closed' || ['closed'].includes(session.status)) return null;
  return {
    machineId,
    lineId:session.lineId,
    lineName:session.lineName,
    machineName:session.machineName,
    op:session.op,
    item:session.item,
    description:session.description || '',
    opTarget:Number(session.opTarget || 0),
    cycleSeconds:Number(session.cycleSeconds || 0),
    frequency1:session.frequency1,
    frequency2:session.frequency2,
    pieceLengthMm:Number(session.pieceLengthMm || 0),
    producedSoFar:Number(session.producedSoFar || 0),
    currentBarPieces:Number(session.currentBarPieces || 0),
    feederBars:Number(session.feederBars || 0),
    barLengthMm:Number(session.barLengthMm || BAR_LENGTH_MM),
    kerfMm:Number(session.kerfMm ?? KERF_MM),
    status:'active',
    openedAt:session.orderOpenedAt || session.checkedAt || nowIso(),
    updatedAt:session.updatedAt || nowIso()
  };
}

function mergeOrderIntoSession(machineId, order, extra = {}) {
  const machine = machineInfo(machineId);
  const operator = store.state.session;
  const current = currentMachineSession(machineId) || {};
  const clock=extra.turnClock || current.assistantTurnClock || { totalMinutes:DEFAULT_SHIFT_MINUTES,usedMinutes:0,remainingMinutes:DEFAULT_SHIFT_MINUTES };
  const axes=extra.flowAxes || {
    physicalStatus:order.status==='stopped'?'stopped':'producing',
    opStatus:order.status==='closed'?'closed':'active',
    workflowStatus:extra.workflowStatus || 'conference_pending'
  };
  const availableMinutes = Number(clock.remainingMinutes ?? DEFAULT_SHIFT_MINUTES);
  const turnTarget = order.cycleSeconds > 0 ? Math.floor(availableMinutes * 60 / order.cycleSeconds) : 0;
  store.update(state => {
    state.machineSessions[machineId] = {
      ...current,
      machineId,
      lineId:order.lineId || machine.lineId,
      lineName:order.lineName || machine.lineName,
      machineName:order.machineName || machine.name,
      op:String(order.op || ''),
      item:String(order.item || ''),
      description:order.description || '',
      opTarget:Number(order.opTarget || 0),
      cycleSeconds:Number(order.cycleSeconds || 0),
      frequency1:order.frequency1 === null ? null : Number(order.frequency1),
      frequency2:order.frequency2 === null ? null : Number(order.frequency2),
      pieceLengthMm:Number(order.pieceLengthMm || 0),
      producedSoFar:Number(order.producedSoFar || 0),
      currentBarPieces:Number(order.currentBarPieces || 0),
      feederBars:Number(order.feederBars || 0),
      barLengthMm:Number(order.barLengthMm || BAR_LENGTH_MM),
      kerfMm:Number(order.kerfMm ?? KERF_MM),
      availableMinutes,
      target:turnTarget,
      plannedShiftTarget:turnTarget,
      orderOpenedAt:order.openedAt || current.orderOpenedAt || nowIso(),
      physicalStatus:axes.physicalStatus,
      opStatus:axes.opStatus,
      workflowStatus:axes.workflowStatus,
      status:axes.physicalStatus==='stopped'?'stopped':axes.opStatus==='closed'?'closed':axes.workflowStatus==='conference_pending'?'pointed':'producing',
      operatorName:state.session.name,
      registration:state.session.registration,
      updatedAt:extra.updatedAt || nowIso(),
      assistantTurnClock:clock,
      ...extra
    };
  },extra.reason || 'turn-assistant-order');
}

function clearLocalMachineSession(machineId, reason = 'turn-assistant-cloud-reconcile') {
  contextCache.delete(`${machineId}|${shiftKey()}`);
  store.update(state => {
    delete state.machineSessions[machineId];
    if (state.conferenceDrafts) delete state.conferenceDrafts[machineId];
  },reason);
}

async function reconcileLocalSession(machineId) {
  const key=`${machineId}|${shiftKey()}`;
  const session=currentMachineSession(machineId);
  if(!API_BASE||!authReady()||!session||session.turnAssistantConfirmedAt||reconciliationKeys.has(key))return;
  reconciliationKeys.add(key);
  const context=await getContext(machineId,true);
  if(!context.error&&!context.activeOrder)clearLocalMachineSession(machineId);
}

function productionConfirmation(order) {
  return `<section class="ta-confirm-block">
    <div class="ta-block-heading"><span>1</span><div><strong>Confirme a produção</strong><small>O valor veio do último registro desta OP.</small></div></div>
    <label class="ta-confirm-option is-selected"><input type="radio" name="productionMode" value="confirm" checked><span><strong>Confirmar ${formatNumber(order.producedSoFar)} peças</strong><small>Está igual ao encontrado na máquina</small></span></label>
    <label class="ta-confirm-option"><input type="radio" name="productionMode" value="correct"><span><strong>Corrigir quantidade</strong><small>Use somente quando o valor estiver diferente</small></span></label>
    <div class="ta-correction" data-ta-correction hidden>
      <label><span>Produção encontrada</span><div class="ta-number-input"><input name="productionCorrected" inputmode="numeric" min="0" value="${escapeHtml(order.producedSoFar)}"><b>peças</b></div></label>
      <label><span>Motivo da correção <small>(opcional)</small></span><input name="correctionNote" placeholder="Ex.: diferença no contador"></label>
    </div>
  </section>`;
}

function materialRequiredFields(values = {}) {
  return `<section class="ta-confirm-block ta-material-block">
    <div class="ta-block-heading"><span>2</span><div><strong>Informe o material disponível</strong><small>Estes dois valores são obrigatórios para calcular o trabalho do turno.</small></div></div>
    <label class="ta-large-field"><span>Quantas peças a barra atual ainda fará?</span><div class="ta-number-input"><input name="currentBarPieces" inputmode="numeric" min="0" required value="${values.currentBarPieces ?? ''}" placeholder="Digite a quantidade"><b>peças</b></div></label>
    <div class="ta-large-field"><span>Quantas barras inteiras estão no alimentador?</span>
      <div class="ta-feeder-control">
        <button type="button" data-ta-feeder-minus aria-label="Diminuir barras">−</button>
        <input name="feederBars" inputmode="numeric" min="0" required value="${values.feederBars ?? ''}" placeholder="—" aria-label="Barras inteiras no alimentador">
        <button type="button" data-ta-feeder-plus aria-label="Aumentar barras">＋</button>
      </div>
      <div class="ta-quick-values" aria-label="Valores rápidos">
        ${[0,1,2,3,4].map(value => `<button type="button" data-ta-feeder-value="${value}">${value}</button>`).join('')}
      </div>
      <small>Sem contar a barra que já está sendo usada.</small>
    </div>
    <div class="ta-why"><span aria-hidden="true">i</span><p>Com esses dados, o NEOMES mostra <strong>até que horas a máquina poderá produzir</strong> e se a OP termina por meta ou por falta de material.</p></div>
  </section>`;
}

function orderSummary(order, machine) {
  return `<section class="ta-order-received">
    <header><div><strong>${escapeHtml(machine.name)}</strong><span>${escapeHtml(machine.lineName)}</span></div><span class="ta-live-badge">OP ATIVA</span></header>
    <div class="ta-order-main"><span>OP ${escapeHtml(order.op)}</span><strong>Item ${escapeHtml(order.item)}</strong>${order.description ? `<small>${escapeHtml(order.description)}</small>` : ''}</div>
    <dl><div><dt>Meta da OP</dt><dd>${formatNumber(order.opTarget)} peças</dd></div><div><dt>Tempo de ciclo</dt><dd>${formatCycle(order.cycleSeconds)}</dd></div><div><dt>Produção registrada</dt><dd>${formatNumber(order.producedSoFar)} peças</dd></div></dl>
  </section>`;
}

function handoffForm(machineId, order, mode = 'handoff') {
  const machine = machineInfo(machineId);
  const body = `<form id="taHandoffForm" data-machine-id="${escapeHtml(machineId)}" novalidate>
    ${orderSummary(order,machine)}
    <div class="ta-flow-copy"><strong>${mode === 'update' ? 'Atualize somente o que mudou' : 'Assuma esta máquina em poucos passos'}</strong><span>A OP e os dados técnicos já estão carregados. Você só confirma a produção e informa o material.</span></div>
    ${productionConfirmation(order)}
    ${materialRequiredFields(mode === 'update' ? { currentBarPieces:order.currentBarPieces,feederBars:order.feederBars } : {})}
    <div class="field-error ta-error" data-ta-error role="alert"></div>
  </form>`;
  openAssistantLayer(sheet({
    title:mode === 'update' ? `Atualizar ${machine.name}` : `Assumir ${machine.name}`,
    eyebrow:mode === 'update' ? 'ATUALIZAÇÃO RÁPIDA' : 'INÍCIO DO TURNO',
    body,
    actions:`<button class="ops-btn ops-btn--ghost" type="button" data-ta-close>Cancelar</button><button class="ops-btn ops-btn--primary ta-primary" type="submit" form="taHandoffForm" data-ta-submit-form="taHandoffForm">${mode === 'update' ? 'Atualizar e recalcular' : 'Confirmar e iniciar turno'}</button>`
  }),'assistantHandoffLayer');
  activeFlow={ type:'handoff',machineId,order,mode };
}

function firstOrderForm(machineId, notice = '') {
  const machine=machineInfo(machineId);
  const body=`<form id="taFirstOrderForm" data-machine-id="${escapeHtml(machineId)}" novalidate>
    ${notice?`<section class="ta-first-order-intro"><span aria-hidden="true">✓</span><div><strong>Estado da máquina atualizado</strong><p>${escapeHtml(notice)}</p></div></section>`:''}
    <section class="ta-first-order-intro"><span aria-hidden="true">!</span><div><strong>Primeiro cadastro desta máquina</strong><p>Depois deste cadastro, os próximos operadores apenas confirmarão a produção e informarão o material.</p></div></section>
    <div class="ta-form-grid">
      <label><span>OP</span><input name="op" inputmode="numeric" required></label>
      <label><span>Item</span><input name="item" inputmode="numeric" required></label>
      <label><span>Meta da OP</span><div class="ta-number-input"><input name="opTarget" inputmode="numeric" min="1" required><b>peças</b></div></label>
      <label><span>Tempo de ciclo</span><input name="cycle" placeholder="Ex.: 4:47" required></label>
      <label><span>Frequência I</span><div class="ta-number-input"><input name="frequency1" inputmode="decimal" min="0" required><b>peças</b></div></label>
      <label><span>Frequência II <small>(opcional)</small></span><div class="ta-number-input"><input name="frequency2" inputmode="decimal" min="0"><b>peças</b></div></label>
      <label><span>Comprimento da peça</span><div class="ta-number-input"><input name="pieceLengthMm" inputmode="decimal" min="0.01" required><b>mm</b></div></label>
      <label><span>Produção atual da OP</span><div class="ta-number-input"><input name="productionConfirmed" inputmode="numeric" min="0" value="0" required><b>peças</b></div></label>
    </div>
    <label class="ta-full-field"><span>Descrição do item <small>(opcional)</small></span><input name="description"></label>
    ${materialRequiredFields()}
    <div class="field-error ta-error" data-ta-error role="alert"></div>
  </form>`;
  openAssistantLayer(sheet({
    title:`Cadastrar OP atual · ${machine.name}`,
    eyebrow:'CONFIGURAÇÃO INICIAL',body,
    actions:`<button class="ops-btn ops-btn--ghost" type="button" data-ta-close>Cancelar</button><button class="ops-btn ops-btn--primary" type="submit" form="taFirstOrderForm" data-ta-submit-form="taFirstOrderForm">Salvar e iniciar turno</button>`
  }),'assistantFirstOrderLayer');
  activeFlow={ type:'first-order',machineId };
}

async function openHandoff(machineId, mode = 'handoff') {
  if (!machineId || !authReady()) return;
  store.update(state => { state.activeMachineId=machineId; },'ta-active-machine');
  const machine=machineInfo(machineId);
  openAssistantLayer(sheet({ title:`Carregando ${machine.name}`,body:'<div class="ta-loading"><span></span><strong>Buscando a OP deixada pelo turno anterior…</strong></div>',actions:'' }),'assistantLoadingLayer');
  const context=await getContext(machineId,true);
  const local=localOrder(machineId);
  if(API_BASE&&!context.error&&!context.activeOrder){
    if(local)clearLocalMachineSession(machineId);
    return firstOrderForm(machineId,local?'A OP antiga existia apenas neste aparelho e foi removida. O Cloudflare confirmou que não há OP ativa.':'Nenhuma OP ativa foi encontrada no Cloudflare.');
  }
  const order=context.activeOrder || local;
  if(order){
    mergeOrderIntoSession(machineId,order,{
      reason:'ta-context',assistantSegments:context.segments || [],turnClock:context.turnClock,
      turnState:context.turnState || null,runtimeState:context.runtimeState || null,flowAxes:context.flowAxes,
      producedThisShift:Number(context.opShiftGoodPieces || 0)
    });
    return handoffForm(machineId,order,mode);
  }
  firstOrderForm(machineId);
}

async function submitHandoff(form) {
  const machineId=form.dataset.machineId;
  const flow=activeFlow;
  const order=flow?.order || localOrder(machineId);
  if(!order)return showError(form,'A OP ativa não foi encontrada.');
  const mode=new FormData(form).get('productionMode') || 'confirm';
  const productionConfirmed=mode==='correct'
    ? asInteger(form.elements.productionCorrected?.value)
    : asInteger(order.producedSoFar);
  const currentBarPieces=asInteger(form.elements.currentBarPieces?.value);
  const feederBars=asInteger(form.elements.feederBars?.value);
  if(!Number.isFinite(productionConfirmed))return showError(form,'Confirme ou corrija a quantidade produzida.');
  if(!Number.isFinite(currentBarPieces))return showError(form,'Informe quantas peças a barra atual ainda fará.');
  if(!Number.isFinite(feederBars))return showError(form,'Informe quantas barras inteiras estão no alimentador.');
  const machine=machineInfo(machineId);const operator=store.state.session;
  const body={
    productionDate:operator.productionDate || localDateKey(),shift:String(operator.shift),machineId,lineId:machine.lineId,
    lineName:machine.lineName,machineName:machine.name,op:order.op,item:order.item,description:order.description || '',
    opTarget:order.opTarget,cycleSeconds:order.cycleSeconds,frequency1:order.frequency1,frequency2:order.frequency2,
    pieceLengthMm:order.pieceLengthMm,barLengthMm:order.barLengthMm || BAR_LENGTH_MM,kerfMm:order.kerfMm ?? KERF_MM,
    productionConfirmed,currentBarPieces,feederBars,correctionNote:form.elements.correctionNote?.value?.trim() || ''
  };
  const button=assistantSubmitButton(form);setBusy(button,true,'Confirmando…');
  try{
    const payload=await post('/api/v1/turn-assistant/handoff',body);
    const segment=(payload.segments || []).find(item=>item.status==='open'&&item.segmentType==='order');
    const savedOrder=payload.activeOrder || { ...order,producedSoFar:productionConfirmed,currentBarPieces,feederBars };
    const opShiftGoodPieces=Number(payload.opShiftGoodPieces || 0);
    mergeOrderIntoSession(machineId,savedOrder,{
      turnAssistantConfirmedAt:payload.handoff?.confirmedAt || nowIso(),turnAssistantShiftKey:shiftKey(),
      productionBaselineAtShift:Number(savedOrder.producedSoFar || 0)-opShiftGoodPieces,producedThisShift:opShiftGoodPieces,
      segmentStartedAt:segment?.startedAt || shiftWindow(operator.shift,operator.productionDate).start.toISOString(),
      currentSegmentId:payload.segmentId,assistantSegments:payload.segments || [],turnClock:payload.turnClock,
      turnState:payload.turnState || null,runtimeState:payload.runtimeState || null,flowAxes:payload.flowAxes,
      materialConfirmedAt:payload.handoff?.confirmedAt || nowIso(),reason:'turn-assistant-handoff'
    });
    contextCache.delete(`${machineId}|${shiftKey()}`);
    closeAssistantLayer();
    showHandoffSuccess(machineId);
  }catch(error){showError(form,error.message);setBusy(button,false);}
}

async function submitFirstOrder(form) {
  const machineId=form.dataset.machineId;const machine=machineInfo(machineId);const operator=store.state.session;
  const order={
    op:form.elements.op.value.trim(),item:formControlValue(form,'item').trim(),description:form.elements.description.value.trim(),
    opTarget:asNumber(form.elements.opTarget.value),cycleSeconds:parseCycle(form.elements.cycle.value),
    frequency1:asNumber(form.elements.frequency1.value),frequency2:asNumber(form.elements.frequency2.value),
    pieceLengthMm:asNumber(form.elements.pieceLengthMm.value),producedSoFar:asInteger(form.elements.productionConfirmed.value),
    currentBarPieces:asInteger(form.elements.currentBarPieces.value),feederBars:asInteger(form.elements.feederBars.value),
    barLengthMm:BAR_LENGTH_MM,kerfMm:KERF_MM,lineId:machine.lineId,lineName:machine.lineName,machineName:machine.name
  };
  if(!order.op||!order.item)return showError(form,'Informe a OP e o item.');
  if(!(order.opTarget>0))return showError(form,'Informe a meta da OP.');
  if(!(order.cycleSeconds>0))return showError(form,'Informe um tempo de ciclo válido.');
  if(!(order.frequency1>0))return showError(form,'Informe a frequência de medição.');
  if(!(order.pieceLengthMm>0))return showError(form,'Informe o comprimento da peça.');
  if(!Number.isFinite(order.producedSoFar))return showError(form,'Confirme a produção atual.');
  if(!Number.isFinite(order.currentBarPieces))return showError(form,'Informe quantas peças a barra atual ainda fará.');
  if(!Number.isFinite(order.feederBars))return showError(form,'Informe quantas barras estão no alimentador.');
  const body={ ...order,productionConfirmed:order.producedSoFar,productionDate:operator.productionDate || localDateKey(),shift:String(operator.shift),machineId };
  const button=assistantSubmitButton(form);setBusy(button,true,'Salvando…');
  try{
    const payload=await post('/api/v1/turn-assistant/handoff',body);
    const segment=(payload.segments||[]).find(item=>item.status==='open'&&item.segmentType==='order');
    mergeOrderIntoSession(machineId,payload.activeOrder || order,{
      turnAssistantConfirmedAt:payload.handoff?.confirmedAt || nowIso(),turnAssistantShiftKey:shiftKey(),
      productionBaselineAtShift:order.producedSoFar,producedThisShift:Number(payload.opShiftGoodPieces || 0),
      segmentStartedAt:segment?.startedAt || shiftWindow(operator.shift,operator.productionDate).start.toISOString(),
      currentSegmentId:payload.segmentId,assistantSegments:payload.segments || [],turnClock:payload.turnClock,
      turnState:payload.turnState || null,runtimeState:payload.runtimeState || null,flowAxes:payload.flowAxes,
      materialConfirmedAt:payload.handoff?.confirmedAt || nowIso(),reason:'turn-assistant-first-order'
    });
    closeAssistantLayer();showHandoffSuccess(machineId);
  }catch(error){showError(form,error.message);setBusy(button,false);}
}

function showHandoffSuccess(machineId) {
  const machine=machineInfo(machineId);const next=store.state.assignments.find(item=>{
    const session=currentMachineSession(item.machineId);
    return !session || session.status==='pointed' || session.turnAssistantShiftKey!==shiftKey();
  });
  const body=`<div class="ta-success"><span aria-hidden="true">✓</span><h3>${escapeHtml(machine.name)} pronta para o turno</h3><p>O planejamento, as liberações e a previsão já foram calculados.</p>${next?`<button class="ops-btn ops-btn--primary" type="button" data-ta-next-machine="${escapeHtml(next.machineId)}">Conferir ${escapeHtml(machineInfo(next.machineId).name)}</button>`:''}<button class="ops-btn ops-btn--ghost" type="button" data-ta-close>Voltar ao painel</button></div>`;
  openAssistantLayer(sheet({ title:'Tudo certo',eyebrow:'CONFIRMAÇÃO CONCLUÍDA',body,actions:'',wide:false }),'assistantSuccessLayer');
}

function sessionForecast(session) {
  return calculateOrderForecast({
    now:session.materialConfirmedAt || session.updatedAt || nowIso(),cycleSeconds:session.cycleSeconds,
    opTarget:session.opTarget,producedSoFar:session.producedSoFar,currentBarPieces:session.currentBarPieces,
    feederBars:session.feederBars,pieceLengthMm:session.pieceLengthMm,barLengthMm:session.barLengthMm || BAR_LENGTH_MM,
    kerfMm:session.kerfMm ?? KERF_MM
  });
}
function measurementSummary(session, forecast) {
  const shiftMinutes=Math.max(0,Number(session.assistantTurnClock?.remainingMinutes ?? session.availableMinutes ?? DEFAULT_SHIFT_MINUTES));
  const turnTarget=calculateFullShiftTarget(session.cycleSeconds,shiftMinutes);
  const shiftTarget=Math.max(0,Math.min(turnTarget,Number(forecast.opRemaining || 0),Number(forecast.availablePieces || 0)));
  const plans=calculateMeasurementPlans({ opTarget:session.opTarget,producedSoFar:session.producedSoFar,shiftTarget,frequency1:session.frequency1,frequency2:session.frequency2 });
  const producedThisShift=Math.max(0,Number(session.producedThisShift || 0));
  const releases=listMeasurementReleases(plans).map(release=>({ ...release,turnPiece:producedThisShift+release.shiftPiece }));
  return { plans,releases,turnTarget,shiftTarget,shiftMinutes };
}
function releaseSequenceLabel(index) {
  if(index===0)return 'Primeira';
  if(index===1)return 'Segunda';
  return `${index+1}ª`;
}
function nextReleaseHtml(session, forecast, summary = measurementSummary(session,forecast)) {
  const { releases }=summary;
  if(!releases.length)return `<section class="ta-release" data-state="none"><div class="ta-section-label">LIBERAÇÕES DO TURNO</div><strong>Nenhuma liberação prevista neste turno</strong><span>A próxima frequência não será atingida dentro da produção planejada.</span></section>`;
  const label=releases.length===1?'LIBERAÇÃO DO TURNO':'LIBERAÇÕES DO TURNO';
  const list=releases.map((release,index)=>{
    const sequence=releaseSequenceLabel(index);
    const action=index===0?'A próxima liberação':`A ${sequence.toLowerCase()} liberação`;
    return `<div class="ta-release-item${index===0?' is-next':''}"><b>${index===0?'PRÓXIMA':`${index+1}ª`}</b><div><strong>${action} será feita com ${formatNumber(release.turnPiece)} peças produzidas neste turno.</strong><span>${sequence} liberação do turno · ${escapeHtml(release.frequencyLabel)} · Medição ${formatNumber(release.measurementNumber)} de ${formatNumber(release.totalMeasurements)}</span></div></div>`;
  }).join('');
  return `<section class="ta-release"><div class="ta-section-label">${label}</div><div class="ta-release-list">${list}</div><small>${formatNumber(releases.length)} liberaç${releases.length===1?'ão planejada':'ões planejadas'} para este turno.</small></section>`;
}
function forecastHtml(forecast, session) {
  if(forecast.status==='missing')return `<section class="ta-forecast" data-tone="neutral"><div class="ta-section-label">PREVISÃO DA ORDEM</div><strong class="ta-forecast-time">—</strong><h3>Previsão indisponível</h3><p>${escapeHtml(predictionMessage(forecast))}</p></section>`;
  const material=forecast.reason==='material';
  return `<section class="ta-forecast" data-tone="${material?'danger':'success'}">
    <div class="ta-section-label">FECHAMENTO PREVISTO</div>
    <strong class="ta-forecast-time">${escapeHtml(clock(forecast.estimatedAt))}</strong>
    <h3>${escapeHtml(predictionMessage(forecast))}</h3>
    ${material?'':`<p>A matéria-prima consegue produzir até <strong>${escapeHtml(clock(forecast.materialEstimatedAt))}</strong>.</p>`}
    <small>Calculado com os dados confirmados às ${formatClock(session?.materialConfirmedAt || session?.updatedAt || new Date())}.</small>
  </section>`;
}
function intuitiveCard(machineId) {
  const machine=machineInfo(machineId);const session=currentMachineSession(machineId);
  if(!session)return '';
  const physicalStatus=session.physicalStatus || (session.assistantMachineStopped?'stopped':['stopped','setup','maintenance'].includes(session.status)?session.status:'producing');
  const opStatus=session.opStatus || (session.status==='closed'||session.assistantMachineStopped?'closed':session.op?'active':'none');
  const workflowStatus=session.workflowStatus || (session.status==='pointed'?'conference_pending':session.turnAssistantConfirmedAt?'ready':'conference_pending');
  const cardState=operatorCardState({ physicalStatus,opStatus,workflowStatus });
  if(cardState==='stopped')return `<header class="ta-card-head"><div><h2>${escapeHtml(machine.name)}</h2><p>${escapeHtml(machine.lineName)}</p></div><span class="ta-status-pill" data-status="stopped">PARADA</span></header><section class="ta-stopped-card"><strong>Máquina sem nova OP</strong><p>${escapeHtml(session.statusNote || session.runtimeState?.reason || 'Sem programação informada.')}</p></section><footer class="ta-card-actions ta-card-actions--single"><button class="ops-btn ops-btn--primary" type="button" data-ta-reconfirm="${escapeHtml(machineId)}">Cadastrar nova OP</button></footer>`;
  if(cardState==='no-order')return `<header class="ta-card-head"><div><h2>${escapeHtml(machine.name)}</h2><p>${escapeHtml(machine.lineName)}${session.op?` · última OP ${escapeHtml(session.op)}`:''}</p></div><span class="ta-status-pill">SEM OP</span></header><section class="ta-conference-callout"><strong>Nenhuma OP ativa nesta máquina</strong><p>Cadastre a próxima OP para continuar o acompanhamento.</p></section><footer class="ta-card-actions ta-card-actions--single"><button class="ops-btn ops-btn--primary" type="button" data-ta-reconfirm="${escapeHtml(machineId)}">Cadastrar próxima OP</button></footer>`;
  if(cardState==='shift-closed')return `<header class="ta-card-head"><div><h2>${escapeHtml(machine.name)}</h2><p>${escapeHtml(machine.lineName)} · OP ${escapeHtml(session.op)}</p></div><span class="ta-status-pill" data-status="pointed">TURNO ENCERRADO</span></header><section class="ta-pointed-card"><span aria-hidden="true">✓</span><div><strong>Apontamento final salvo</strong><p>${formatNumber(session.assistantLastGoodPieces || 0)} peças boas · ${formatNumber(session.assistantLastRejects || 0)} refugos</p><small>O próximo turno fará uma nova conferência com um relógio de 480 minutos.</small></div></section>`;
  if(cardState==='conference-pending')return `<header class="ta-card-head"><div><h2>${escapeHtml(machine.name)}</h2><p>${escapeHtml(machine.lineName)} · OP ${escapeHtml(session.op)}</p></div><span class="ta-status-pill" data-status="pointed">CONFERÊNCIA PENDENTE</span></header>${session.assistantLastGoodPieces!==undefined?`<section class="ta-pointed-card"><span aria-hidden="true">✓</span><div><strong>Produção apontada</strong><p>${formatNumber(session.assistantLastGoodPieces || 0)} peças boas · ${formatNumber(session.assistantLastRejects || 0)} refugos</p><small>Saldo da máquina: ${formatDuration(session.assistantTurnClock?.remainingMinutes)}</small></div></section>`:''}<section class="ta-conference-callout"><strong>Confira novamente antes de continuar</strong><p>Confirme a produção acumulada e o material. O saldo de minutos já apontado será preservado.</p></section><footer class="ta-card-actions ta-card-actions--single"><button class="ops-btn ops-btn--primary" type="button" data-ta-reconfirm="${escapeHtml(machineId)}">Conferir novamente</button></footer>`;
  const forecast=sessionForecast(session);
  const status=statusMeta(physicalStatus);
  const summary=measurementSummary(session,forecast);
  const targetLabel=summary.shiftMinutes>=DEFAULT_SHIFT_MINUTES?'Meta do turno':'Meta com o saldo';
  const facts=`<section class="ta-compact-facts"><div><span>Produção atual</span><strong>${formatNumber(session.producedSoFar)}</strong></div><div data-tone="target"><span>${targetLabel}</span><strong>${formatNumber(summary.turnTarget)}</strong></div><div><span>Saldo da máquina</span><strong>${formatDuration(summary.shiftMinutes)}</strong></div><div><span>Tempo de ciclo</span><strong>${escapeHtml(formatCycle(session.cycleSeconds))}</strong></div><div><span>Meta da OP</span><strong>${formatNumber(session.opTarget)}</strong></div><div><span>Falta produzir</span><strong>${formatNumber(forecast.opRemaining)}</strong></div><div><span>Material disponível</span><strong>${formatNumber(forecast.availablePieces)}</strong></div></section>`;
  return `<header class="ta-card-head"><div><h2>${escapeHtml(machine.name)}</h2><p>${escapeHtml(machine.lineName)} · OP ${escapeHtml(session.op)} · Item ${escapeHtml(session.item)}</p></div><span class="ta-status-pill" data-status="${escapeHtml(physicalStatus)}">${escapeHtml(status.label)}</span></header>
    ${nextReleaseHtml(session,forecast,summary)}${forecastHtml(forecast,session)}${facts}
    <section class="ta-material-line"><div><span>Barra atual</span><strong>${formatNumber(session.currentBarPieces)} peças</strong></div><div><span>No alimentador</span><strong>${formatNumber(session.feederBars)} barra${Number(session.feederBars)===1?'':'s'}</strong></div><div><span>Peças por barra</span><strong>${formatNumber(forecast.piecesPerFullBar)}</strong></div></section>
    <footer class="ta-card-actions"><button class="ops-btn ops-btn--primary" type="button" data-ta-point="${escapeHtml(machineId)}">Fazer apontamento</button><button class="ops-btn ops-btn--soft" type="button" data-ta-update="${escapeHtml(machineId)}">Atualizar dados</button><button class="ops-btn ops-btn--danger-text" type="button" data-ta-close-order="${escapeHtml(machineId)}">Encerrar OP</button></footer>
    <div class="planning-card-summary assistant-compat" hidden></div><div class="measurement-card-plan assistant-compat" hidden></div>`;
}
function enhanceCards() {
  const cards=[...document.querySelectorAll('.ops-machine-card')];
  cards.forEach((card,index)=>{
    const assignment=store.state.assignments[index];if(!assignment)return;
    const session=currentMachineSession(assignment.machineId);
    if(!session){
      const empty=card.querySelector('.ops-empty-machine p');
      if(empty)empty.textContent='Busque a OP ativa, confirme a produção e informe o material disponível.';
      const button=card.querySelector('[data-action="open-conference"]');if(button)button.textContent='Assumir máquina';
      return;
    }
    if((!session.turnAssistantConfirmedAt||session.turnAssistantShiftKey!==shiftKey())&&!session.assistantMachineStopped){
      const machine=machineInfo(assignment.machineId);
      card.dataset.turnAssistant='true';
      card.innerHTML=`<header class="ta-card-head"><div><h2>${escapeHtml(machine.name)}</h2><p>${escapeHtml(machine.lineName)}</p></div><span class="ta-status-pill" data-status="pointed">CONFERÊNCIA PENDENTE</span></header><section class="ta-conference-callout"><strong>Confirme esta máquina antes de usar</strong><p>O NEOMES vai buscar a OP ativa e eliminar automaticamente qualquer informação antiga deste aparelho.</p></section><footer class="ta-card-actions ta-card-actions--single"><button class="ops-btn ops-btn--primary" type="button" data-ta-reconfirm="${escapeHtml(assignment.machineId)}">Fazer conferência</button></footer>`;
      reconcileLocalSession(assignment.machineId);
      return;
    }
    const signature=[session.op,session.producedSoFar,session.currentBarPieces,session.feederBars,session.status,session.physicalStatus,session.opStatus,session.workflowStatus,session.assistantTurnClock?.remainingMinutes,session.updatedAt,session.assistantLastGoodPieces,session.assistantLastRejects].join('|');
    if(card.dataset.taSignature===signature&&card.querySelector('.ta-card-head'))return;
    card.dataset.taSignature=signature;card.dataset.turnAssistant='true';card.innerHTML=intuitiveCard(assignment.machineId);
  });
}

function periodInputCard(machineId,mode='pointing') {
  const machine=machineInfo(machineId);const session=currentMachineSession(machineId);
  const clock=session.assistantTurnClock || { totalMinutes:DEFAULT_SHIFT_MINUTES,usedMinutes:0,remainingMinutes:DEFAULT_SHIFT_MINUTES };
  return `<article class="ta-close-card" data-close-machine="${escapeHtml(machineId)}" data-used-minutes="${Number(clock.usedMinutes || 0)}" data-total-minutes="${Number(clock.totalMinutes || DEFAULT_SHIFT_MINUTES)}" data-cycle-seconds="${session.cycleSeconds}">
    <header><div><strong>${escapeHtml(machine.name)}</strong><span>OP ${escapeHtml(session.op)} · saldo antes deste apontamento</span></div><b>${formatDuration(clock.remainingMinutes)}</b></header>
    <div class="ta-close-fields"><label><span>Peças boas produzidas</span><div class="ta-number-input"><input name="goodPieces-${escapeHtml(machineId)}" data-ta-good="${escapeHtml(machineId)}" inputmode="numeric" min="0" required placeholder="0"><b>peças</b></div></label><label><span>Refugos</span><div class="ta-stepper"><button type="button" data-ta-reject-minus="${escapeHtml(machineId)}">−</button><input name="rejects-${escapeHtml(machineId)}" data-ta-rejects="${escapeHtml(machineId)}" inputmode="numeric" min="0" value="0"><button type="button" data-ta-reject-plus="${escapeHtml(machineId)}">＋</button></div></label><label><span>Minutos de parada</span><div class="ta-number-input"><input name="stopMinutes-${escapeHtml(machineId)}" data-ta-stops="${escapeHtml(machineId)}" inputmode="decimal" min="0" value="0"><b>min</b></div></label></div>
    <section class="ta-time-preview" data-ta-time-preview="${escapeHtml(machineId)}"><div><span>Tempo produtivo calculado</span><strong>—</strong></div><div><span>Total consumido</span><strong>—</strong></div><div><span>Saldo depois</span><strong>—</strong></div><p>Informe a quantidade para conferir o cálculo. Ela não será limitada.</p></section>
    <div class="ta-reason-group"><span>Principal motivo da parada <small>(opcional)</small></span><div>${[['adjustment','Ajuste'],['setup','Setup'],['material','Material'],['maintenance','Manutenção'],['quality','Qualidade'],['other','Outro']].map(([value,label])=>`<button type="button" data-ta-reason="${value}" data-machine-id="${escapeHtml(machineId)}">${label}</button>`).join('')}</div><input data-ta-note="${escapeHtml(machineId)}" placeholder="Observação opcional"></div>
  </article>`;
}
function openPointing(machineId) {
  const machine=machineInfo(machineId);const session=currentMachineSession(machineId);
  if(!session||session.workflowStatus==='conference_pending'||session.status==='pointed')return openHandoff(machineId);
  const body=`<form id="taPointingForm" data-machine-id="${escapeHtml(machineId)}" novalidate><div class="ta-close-intro"><strong>Registre o que aconteceu nesta máquina</strong><span>A quantidade é livre. O cálculo serve apenas para mostrar quanto do relógio de 480 minutos foi consumido.</span></div>${periodInputCard(machineId,'pointing')}<div class="field-error ta-error" data-ta-error role="alert"></div></form>`;
  openAssistantLayer(sheet({ title:`Fazer apontamento · ${machine.name}`,eyebrow:'APONTAMENTO CONSULTIVO',body,actions:`<button class="ops-btn ops-btn--ghost" type="button" data-ta-close>Cancelar</button><button class="ops-btn ops-btn--primary" type="submit" form="taPointingForm" data-ta-submit-form="taPointingForm">Salvar apontamento</button>` }),'assistantPointingLayer');
  activeFlow={ type:'pointing',machineId };
}
function openShiftClose() {
  const eligible=store.state.assignments.filter(item=>{
    const session=currentMachineSession(item.machineId);const workflowStatus=session?.workflowStatus || (session?.status==='pointed'?'conference_pending':session?.turnAssistantConfirmedAt?'ready':'conference_pending');
    return session&&session.opStatus!=='closed'&&workflowStatus!=='conference_pending'&&workflowStatus!=='shift_closed'&&!session.assistantMachineStopped&&session.turnAssistantConfirmedAt;
  });
  if(!eligible.length)return;
  const body=`<form id="taShiftCloseForm" novalidate><div class="ta-close-intro"><strong>Apontamento final do seu turno</strong><span>Informe produção, refugos e minutos de parada. O próximo turno fará uma nova conferência com 480 minutos.</span></div><div class="ta-close-list">${eligible.map(item=>periodInputCard(item.machineId,'pointing')).join('')}</div><div class="field-error ta-error" data-ta-error role="alert"></div></form>`;
  openAssistantLayer(sheet({ title:'Encerrar meu turno',eyebrow:`${store.state.session.shift}º TURNO · FECHAMENTO FINAL`,body,actions:`<button class="ops-btn ops-btn--ghost" type="button" data-ta-close>Cancelar</button><button class="ops-btn ops-btn--primary" type="submit" form="taShiftCloseForm" data-ta-submit-form="taShiftCloseForm">Salvar e encerrar turno</button>` }),'assistantShiftCloseLayer');
  activeFlow={ type:'shift-close',machineIds:eligible.map(item=>item.machineId) };
}
function updateTimePreview(machineId) {
  const card=layers.querySelector(`[data-close-machine="${CSS.escape(machineId)}"]`);if(!card)return;
  const good=asInteger(card.querySelector(`[data-ta-good="${CSS.escape(machineId)}"]`)?.value);
  const rejects=asInteger(card.querySelector(`[data-ta-rejects="${CSS.escape(machineId)}"]`)?.value);
  const stopMinutes=asNumber(card.querySelector(`[data-ta-stops="${CSS.escape(machineId)}"]`)?.value);
  const preview=card.querySelector(`[data-ta-time-preview="${CSS.escape(machineId)}"]`);
  if(!Number.isFinite(good)||!Number.isFinite(rejects)||!Number.isFinite(stopMinutes)){preview.innerHTML='<div><span>Tempo produtivo calculado</span><strong>—</strong></div><div><span>Total consumido</span><strong>—</strong></div><div><span>Saldo depois</span><strong>—</strong></div><p>Informe a quantidade e os minutos de parada.</p>';return;}
  const result=calculatePointingAccounting({ totalMinutes:Number(card.dataset.totalMinutes),usedMinutes:Number(card.dataset.usedMinutes),goodPieces:good,rejects,stopMinutes,cycleSeconds:Number(card.dataset.cycleSeconds) });
  preview.dataset.state=result.advisory?'advisory':result.status;
  preview.innerHTML=`<div><span>Tempo produtivo calculado</span><strong>${formatDuration(result.productiveMinutes)}</strong></div><div><span>Total consumido</span><strong>${formatDuration(result.accountedMinutes)}</strong></div><div><span>Saldo depois</span><strong>${formatDuration(result.remainingAfter)}</strong></div><p>${result.advisory?`O cálculo ultrapassa o saldo em ${formatDuration(result.overrunMinutes)}, mas sua quantidade será salva normalmente.`:`${formatDuration(result.stopMinutes)} de parada somados ao tempo das peças. A quantidade digitada será salva normalmente.`}</p>`;
}
function closePayload(machineId,mode,finalShift=false) {
  const card=layers.querySelector(`[data-close-machine="${CSS.escape(machineId)}"]`);const session=currentMachineSession(machineId);const machine=machineInfo(machineId);const operator=store.state.session;
  const goodPieces=asInteger(card.querySelector(`[data-ta-good="${CSS.escape(machineId)}"]`)?.value);
  const rejects=asInteger(card.querySelector(`[data-ta-rejects="${CSS.escape(machineId)}"]`)?.value);
  const stopMinutes=asNumber(card.querySelector(`[data-ta-stops="${CSS.escape(machineId)}"]`)?.value);
  const selected=card.querySelector('[data-ta-reason][aria-pressed="true"]');
  return { productionDate:operator.productionDate || localDateKey(),shift:String(operator.shift),machineId,lineId:machine.lineId,mode,finalShift,goodPieces,rejects,stopMinutes,downtimeReason:selected?.dataset.taReason || '',downtimeNote:card.querySelector(`[data-ta-note="${CSS.escape(machineId)}"]`)?.value?.trim() || '',op:session.op };
}
function appendRecord(machineId,payload,response) {
  const session=currentMachineSession(machineId);const machine=machineInfo(machineId);const now=nowIso();const perf=response.performance;
  const producedThisShift=Number(session.producedThisShift || 0)+payload.goodPieces;
  const record={
    id:`record-${crypto.randomUUID()}`,schemaVersion:6,createdAt:now,updatedAt:now,productionDate:store.state.session.productionDate || localDateKey(),source:'neomes-turn-assistant',
    operatorName:store.state.session.name,operatorRegistration:store.state.session.registration,shift:String(store.state.session.shift),lineId:machine.lineId,lineName:machine.lineName,machineId,machineName:machine.name,
    op:session.op,item:session.item,itemDescription:session.description || '',cycleTimeSeconds:session.cycleSeconds,frequency1:session.frequency1,frequency2:session.frequency2,
    producedBefore:Number(session.producedSoFar || 0),pointedGoodPieces:payload.goodPieces,producedThisShift,rejects:payload.rejects,totalAfterPointing:Number(session.producedSoFar || 0)+payload.goodPieces,finalProduction:Number(session.producedSoFar || 0)+payload.goodPieces,
    opTarget:session.opTarget,target:session.opTarget,availableMinutes:perf.remainingBefore,runningMinutes:perf.productiveMinutes,downtimeMinutes:perf.stopMinutes,
    accountedMinutes:perf.accountedMinutes,remainingMinutes:perf.remainingAfter,rejectMinutes:perf.rejectMinutes,downtimeReason:payload.downtimeReason,notes:payload.downtimeNote,
    eventType:payload.mode==='order'?'order-close':payload.finalShift?'shift-pointing':'production-pointing',orderStatus:payload.mode==='order'?'closed':'open',status:'active',syncStatus:'synced'
  };
  store.update(state=>{
    state.records.unshift(record);
    state.machineSessions[machineId]={
      ...state.machineSessions[machineId],producedSoFar:record.finalProduction,producedThisShift,
      status:payload.mode==='order'?'closed':'pointed',
      physicalStatus:response.flowAxes?.physicalStatus || state.machineSessions[machineId].physicalStatus || 'producing',
      opStatus:response.flowAxes?.opStatus || (payload.mode==='order'?'closed':'active'),
      workflowStatus:response.flowAxes?.workflowStatus || (payload.finalShift?'shift_closed':'conference_pending'),
      turnState:response.turnState || null,runtimeState:response.runtimeState || null,
      availableMinutes:Number(response.turnClock?.remainingMinutes || 0),updatedAt:now,
      closedAt:payload.mode==='order'?response.endedAt:null,assistantLastGoodPieces:payload.goodPieces,
      assistantLastRejects:payload.rejects,assistantLastDowntimeMinutes:perf.stopMinutes,
      assistantLastRunningMinutes:perf.productiveMinutes,assistantLastAccountedMinutes:perf.accountedMinutes,
      assistantSegments:response.segments || [],assistantTurnClock:response.turnClock || null
    };
  },payload.mode==='order'?'turn-assistant-order-close':'turn-assistant-shift-close');
  api.post('/api/v1/records',record).catch(()=>{});
}
async function submitPointing(form) {
  const machineId=form.dataset.machineId;const payload=closePayload(machineId,'pointing',false);
  if(!Number.isFinite(payload.goodPieces)||!Number.isFinite(payload.rejects)||!Number.isFinite(payload.stopMinutes))return showError(form,'Informe peças boas, refugos e minutos de parada.');
  const button=assistantSubmitButton(form);setBusy(button,true,'Salvando…');
  try{const response=await post('/api/v1/turn-assistant/close-period',payload);appendRecord(machineId,payload,response);closeAssistantLayer();}catch(error){showError(form,error.message);setBusy(button,false);}
}
async function submitShiftClose(form) {
  const button=assistantSubmitButton(form);
  const payloads=activeFlow.machineIds.map(machineId=>closePayload(machineId,'pointing',true));
  const invalid=payloads.find(payload=>!Number.isFinite(payload.goodPieces)||!Number.isFinite(payload.rejects)||!Number.isFinite(payload.stopMinutes));
  if(invalid)return showError(form,'Informe peças boas, refugos e minutos de parada de todas as máquinas.');
  setBusy(button,true,'Salvando apontamentos…');
  try{
    for(const payload of payloads){const response=await post('/api/v1/turn-assistant/close-period',payload);appendRecord(payload.machineId,payload,response);}
    closeAssistantLayer();
  }catch(error){showError(form,error.message);setBusy(button,false);}
}

async function openOrderClose(machineId) {
  const machine=machineInfo(machineId);let session=currentMachineSession(machineId);if(!session)return openHandoff(machineId);
  if(API_BASE){
    openAssistantLayer(sheet({ title:`Verificando ${machine.name}`,body:'<div class="ta-loading"><span></span><strong>Confirmando a OP ativa no Cloudflare…</strong></div>',actions:'' }),'assistantLoadingLayer');
    const context=await getContext(machineId,true);
    if(!context.error&&!context.activeOrder){
      clearLocalMachineSession(machineId);
      return firstOrderForm(machineId,'A informação antiga desta máquina foi removida porque o Cloudflare confirmou que não existe OP ativa.');
    }
    if(context.activeOrder){
      mergeOrderIntoSession(machineId,context.activeOrder,{
        reason:'ta-close-context',assistantSegments:context.segments || [],turnClock:context.turnClock,
        turnState:context.turnState || null,runtimeState:context.runtimeState || null,flowAxes:context.flowAxes,
        producedThisShift:Number(context.opShiftGoodPieces || 0)
      });
      session=currentMachineSession(machineId);
    }
  }
  const body=`<form id="taOrderCloseForm" data-machine-id="${escapeHtml(machineId)}" novalidate><div class="ta-close-intro"><strong>Encerrar OP ${escapeHtml(session.op)}</strong><span>O tempo desta OP será fechado agora. O restante do turno ficará disponível para a próxima ordem.</span></div>${periodInputCard(machineId,'order')}<div class="field-error ta-error" data-ta-error role="alert"></div></form>`;
  openAssistantLayer(sheet({ title:`Encerrar OP · ${machine.name}`,eyebrow:'FECHAMENTO DE PERÍODO',body,actions:`<button class="ops-btn ops-btn--ghost" type="button" data-ta-close>Cancelar</button><button class="ops-btn ops-btn--danger" type="submit" form="taOrderCloseForm" data-ta-submit-form="taOrderCloseForm">Confirmar encerramento</button>` }),'assistantOrderCloseLayer');
  activeFlow={ type:'order-close',machineId,previous:{ ...session } };
}
async function submitOrderClose(form) {
  const machineId=form.dataset.machineId;const payload=closePayload(machineId,'order');
  if(!Number.isFinite(payload.goodPieces)||!Number.isFinite(payload.rejects)||!Number.isFinite(payload.stopMinutes))return showError(form,'Informe peças boas, refugos e minutos de parada desta OP.');
  const button=assistantSubmitButton(form);setBusy(button,true,'Encerrando…');
  try{const response=await post('/api/v1/turn-assistant/close-period',payload);appendRecord(machineId,payload,response);openNextOrderChoice(machineId,activeFlow.previous,response);}catch(error){
    if(error.code==='ACTIVE_ORDER_NOT_FOUND'){
      clearLocalMachineSession(machineId);
      return firstOrderForm(machineId,'A OP que aparecia neste aparelho não estava ativa no Cloudflare e foi removida.');
    }
    showError(form,error.message);setBusy(button,false);
  }
}
function openNextOrderChoice(machineId,previous,response) {
  const remaining=Number(response?.turnClock?.remainingMinutes || 0);
  const body=`<div class="ta-next-choice"><section class="ta-clock-card"><span>Tempo restante do turno</span><strong>${formatDuration(remaining)}</strong><small>A próxima OP usará somente este saldo.</small></section><h3>O que acontecerá agora?</h3><div class="ta-choice-list"><button type="button" data-ta-next-order="same-item" data-machine-id="${escapeHtml(machineId)}"><strong>Nova OP do mesmo item</strong><span>Mantém item, ciclo, frequências e comprimento</span></button><button type="button" data-ta-next-order="different-item" data-machine-id="${escapeHtml(machineId)}"><strong>Nova OP de outro item</strong><span>Informe os novos dados técnicos</span></button><button type="button" data-ta-next-order="stopped" data-machine-id="${escapeHtml(machineId)}"><strong>Máquina ficará parada</strong><span>Sem nova ordem neste momento</span></button></div></div>`;
  openAssistantLayer(sheet({ title:'Próximo passo',eyebrow:'OP ENCERRADA',body,actions:'' }),'assistantNextOrderLayer');
  activeFlow={ type:'next-order',machineId,previous,response };
}
function newOrderForm(machineId,type) {
  const previous=activeFlow?.previous || currentMachineSession(machineId) || {};const same=type==='same-item';const machine=machineInfo(machineId);
  const remaining=Number(activeFlow?.response?.turnClock?.remainingMinutes ?? previous.assistantTurnClock?.remainingMinutes ?? 0);
  const body=`<form id="taNewOrderForm" data-machine-id="${escapeHtml(machineId)}" data-order-type="${type}" novalidate>
    ${same?`<section class="ta-inherited"><strong>Dados que serão mantidos</strong><span>Item ${escapeHtml(previous.item)} · Ciclo ${formatCycle(previous.cycleSeconds)} · Frequências e comprimento da peça</span></section>`:''}
    <div class="ta-form-grid"><label><span>Nova OP</span><input name="op" inputmode="numeric" required></label>${same?'':`<label><span>Novo item</span><input name="item" inputmode="numeric" required></label>`}<label><span>Meta da nova OP</span><div class="ta-number-input"><input name="opTarget" inputmode="numeric" min="1" required value="${escapeHtml(previous.opTarget || '')}"><b>peças</b></div></label><label><span>Produção inicial</span><div class="ta-number-input"><input name="productionInitial" inputmode="numeric" min="0" value="0" required><b>peças</b></div></label>${same?'':`<label><span>Tempo de ciclo</span><input name="cycle" value="" placeholder="Ex.: 4:47" required></label><label><span>Frequência I</span><input name="frequency1" inputmode="decimal" required></label><label><span>Frequência II <small>(opcional)</small></span><input name="frequency2" inputmode="decimal"></label><label><span>Comprimento da peça</span><div class="ta-number-input"><input name="pieceLengthMm" inputmode="decimal" required><b>mm</b></div></label>`}</div>
    ${same?'':`<label class="ta-full-field"><span>Descrição <small>(opcional)</small></span><input name="description"></label>`}
    ${materialRequiredFields()}
    <div class="ta-reason-group"><span>Tempo entre as ordens <small>(opcional)</small></span><div>${[['setup','Setup'],['adjustment','Ajuste'],['material','Aguardando material'],['quality','Qualidade'],['other','Outro']].map(([value,label])=>`<button type="button" data-ta-transition-reason="${value}">${label}</button>`).join('')}</div></div>
    <div class="field-error ta-error" data-ta-error role="alert"></div>
  </form>`;
  openAssistantLayer(sheet({ title:same?'Nova OP do mesmo item':'Nova OP de outro item',eyebrow:`${machine.name} · ${formatDuration(remaining)} RESTANTES`,body,actions:`<button class="ops-btn ops-btn--ghost" type="button" data-ta-back-next>Voltar</button><button class="ops-btn ops-btn--primary" type="submit" form="taNewOrderForm" data-ta-submit-form="taNewOrderForm">Iniciar nova OP</button>` }),'assistantNewOrderLayer');
  activeFlow={ ...activeFlow,type:'new-order-form',orderType:type,previous };
}
async function submitNewOrder(form) {
  const machineId=form.dataset.machineId;const type=form.dataset.orderType;const same=type==='same-item';const previous=activeFlow.previous || {};const machine=machineInfo(machineId);const operator=store.state.session;
  const selected=layers.querySelector('[data-ta-transition-reason][aria-pressed="true"]');
  const body={ productionDate:operator.productionDate || localDateKey(),shift:String(operator.shift),machineId,lineId:machine.lineId,lineName:machine.lineName,machineName:machine.name,orderType:type,op:form.elements.op.value.trim(),opTarget:asNumber(form.elements.opTarget.value),productionInitial:asInteger(form.elements.productionInitial.value),currentBarPieces:asInteger(form.elements.currentBarPieces.value),feederBars:asInteger(form.elements.feederBars.value),transitionReason:selected?.dataset.taTransitionReason || '' };
  if(!same){body.item=formControlValue(form,'item').trim();body.description=form.elements.description.value.trim();body.cycleSeconds=parseCycle(form.elements.cycle.value);body.frequency1=asNumber(form.elements.frequency1.value);body.frequency2=asNumber(form.elements.frequency2.value);body.pieceLengthMm=asNumber(form.elements.pieceLengthMm.value);}
  if(!body.op)return showError(form,'Informe o número da nova OP.');if(!(body.opTarget>0))return showError(form,'Informe a meta da nova OP.');if(!Number.isFinite(body.productionInitial))return showError(form,'Informe a produção inicial.');if(!Number.isFinite(body.currentBarPieces))return showError(form,'Informe quantas peças a barra atual ainda fará.');if(!Number.isFinite(body.feederBars))return showError(form,'Informe quantas barras estão no alimentador.');
  if(!same&&(!body.item||!(body.cycleSeconds>0)||!(body.frequency1>0)||!(body.pieceLengthMm>0)))return showError(form,'Informe item, ciclo, frequência e comprimento da peça.');
  const button=assistantSubmitButton(form);setBusy(button,true,'Iniciando…');
  try{const payload=await post('/api/v1/turn-assistant/start-order',body);const segment=(payload.segments||[]).find(item=>item.status==='open'&&item.segmentType==='order');mergeOrderIntoSession(machineId,payload.activeOrder,{ turnAssistantConfirmedAt:nowIso(),turnAssistantShiftKey:shiftKey(),productionBaselineAtShift:Number(payload.activeOrder.producedSoFar||0),producedThisShift:Number(payload.opShiftGoodPieces || 0),segmentStartedAt:segment?.startedAt || nowIso(),currentSegmentId:payload.segmentId,assistantSegments:payload.segments || [],turnClock:payload.turnClock,turnState:payload.turnState || null,runtimeState:payload.runtimeState || null,flowAxes:payload.flowAxes,materialConfirmedAt:nowIso(),assistantMachineStopped:false,reason:'turn-assistant-new-order' });contextCache.delete(`${machineId}|${shiftKey()}`);closeAssistantLayer();}catch(error){showError(form,error.message);setBusy(button,false);}
}
function stoppedForm(machineId) {
  const machine=machineInfo(machineId);const body=`<form id="taStoppedForm" data-machine-id="${escapeHtml(machineId)}"><p class="ta-help-text">Selecione o motivo. O tempo restante ficará registrado como máquina parada.</p><div class="ta-stop-reasons">${[['no-schedule','Sem programação'],['material','Aguardando material'],['setup','Aguardando setup'],['maintenance','Manutenção'],['quality','Qualidade'],['other','Outro']].map(([value,label])=>`<button type="button" data-ta-stop-reason="${value}">${label}</button>`).join('')}</div><label class="ta-full-field"><span>Observação <small>(opcional)</small></span><textarea name="note"></textarea></label><div class="field-error ta-error" data-ta-error></div></form>`;
  openAssistantLayer(sheet({ title:`${machine.name} ficará parada`,eyebrow:'SEM NOVA OP',body,actions:`<button class="ops-btn ops-btn--ghost" type="button" data-ta-back-next>Voltar</button><button class="ops-btn ops-btn--primary" type="submit" form="taStoppedForm" data-ta-submit-form="taStoppedForm">Confirmar parada</button>` }),'assistantStoppedLayer');activeFlow={ ...activeFlow,type:'stopped-form' };
}
async function submitStopped(form) {
  const machineId=form.dataset.machineId;const machine=machineInfo(machineId);const operator=store.state.session;const selected=layers.querySelector('[data-ta-stop-reason][aria-pressed="true"]');if(!selected)return showError(form,'Selecione o motivo da parada.');
  const body={ productionDate:operator.productionDate || localDateKey(),shift:String(operator.shift),machineId,lineId:machine.lineId,reason:selected.dataset.taStopReason,note:form.elements.note.value.trim() };
  const button=assistantSubmitButton(form);setBusy(button,true,'Salvando…');
  try{const payload=await post('/api/v1/turn-assistant/stopped',body);store.update(state=>{state.machineSessions[machineId]={ ...(state.machineSessions[machineId]||{}),machineId,lineId:machine.lineId,lineName:machine.lineName,machineName:machine.name,status:'stopped',physicalStatus:payload.flowAxes?.physicalStatus || 'stopped',opStatus:payload.flowAxes?.opStatus || 'none',workflowStatus:payload.flowAxes?.workflowStatus || 'conference_pending',turnState:payload.turnState || null,runtimeState:payload.runtimeState || null,assistantTurnClock:payload.turnClock || state.machineSessions[machineId]?.assistantTurnClock || null,assistantMachineStopped:true,statusNote:selected.textContent.trim(),updatedAt:nowIso() };},'turn-assistant-stopped');closeAssistantLayer();}catch(error){showError(form,error.message);setBusy(button,false);}
}

function handleStepper(button, delta, selector) {
  const input=button.closest('form,article,section')?.querySelector(selector);if(!input)return;const current=asInteger(input.value);input.value=String(Math.max(0,(Number.isFinite(current)?current:0)+delta));input.dispatchEvent(new Event('input',{ bubbles:true }));
}
function selectSingle(button, selector) {
  button.parentElement?.querySelectorAll(selector).forEach(item=>item.setAttribute('aria-pressed','false'));button.setAttribute('aria-pressed','true');
}

function intercept(event) {
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='open-conference'||action==='edit-conference'){
    event.preventDefault();event.stopImmediatePropagation();openHandoff(event.target.closest('[data-action]').dataset.machineId,action==='edit-conference'?'update':'handoff');return;
  }
  if(action==='open-first-conference'){
    event.preventDefault();event.stopImmediatePropagation();const first=store.state.assignments.find(item=>{const session=currentMachineSession(item.machineId);return !session||session.turnAssistantShiftKey!==shiftKey();});if(first)openHandoff(first.machineId);return;
  }
  if(action==='close-shift'){
    event.preventDefault();event.stopImmediatePropagation();openShiftClose();return;
  }
  if(action==='close-order'){
    event.preventDefault();event.stopImmediatePropagation();openOrderClose(event.target.closest('[data-action]').dataset.machineId);return;
  }
  const update=event.target.closest('[data-ta-update]');if(update){event.preventDefault();event.stopImmediatePropagation();openHandoff(update.dataset.taUpdate,'update');return;}
  const pointing=event.target.closest('[data-ta-point]');if(pointing){event.preventDefault();event.stopImmediatePropagation();openPointing(pointing.dataset.taPoint);return;}
  const reconfirm=event.target.closest('[data-ta-reconfirm]');if(reconfirm){event.preventDefault();event.stopImmediatePropagation();openHandoff(reconfirm.dataset.taReconfirm,'handoff');return;}
  const closeOrder=event.target.closest('[data-ta-close-order]');if(closeOrder){event.preventDefault();event.stopImmediatePropagation();openOrderClose(closeOrder.dataset.taCloseOrder);return;}
  if(event.target.closest('[data-ta-close]')){event.preventDefault();event.stopImmediatePropagation();closeAssistantLayer();return;}
  const nextMachine=event.target.closest('[data-ta-next-machine]');if(nextMachine){event.preventDefault();event.stopImmediatePropagation();openHandoff(nextMachine.dataset.taNextMachine);return;}
  const feeder=event.target.closest('[data-ta-feeder-value]');if(feeder){const input=feeder.closest('form')?.elements.feederBars;if(input){input.value=feeder.dataset.taFeederValue;input.dispatchEvent(new Event('input',{ bubbles:true }));}return;}
  if(event.target.closest('[data-ta-feeder-minus]'))return handleStepper(event.target.closest('[data-ta-feeder-minus]'),-1,'[name="feederBars"]');
  if(event.target.closest('[data-ta-feeder-plus]'))return handleStepper(event.target.closest('[data-ta-feeder-plus]'),1,'[name="feederBars"]');
  const rejectMinus=event.target.closest('[data-ta-reject-minus]');if(rejectMinus)return handleStepper(rejectMinus,-1,`[data-ta-rejects="${CSS.escape(rejectMinus.dataset.taRejectMinus)}"]`);
  const rejectPlus=event.target.closest('[data-ta-reject-plus]');if(rejectPlus)return handleStepper(rejectPlus,1,`[data-ta-rejects="${CSS.escape(rejectPlus.dataset.taRejectPlus)}"]`);
  const reason=event.target.closest('[data-ta-reason]');if(reason){selectSingle(reason,'[data-ta-reason]');return;}
  const transition=event.target.closest('[data-ta-transition-reason]');if(transition){selectSingle(transition,'[data-ta-transition-reason]');return;}
  const stopReason=event.target.closest('[data-ta-stop-reason]');if(stopReason){selectSingle(stopReason,'[data-ta-stop-reason]');return;}
  const nextOrder=event.target.closest('[data-ta-next-order]');if(nextOrder){const type=nextOrder.dataset.taNextOrder;const machineId=nextOrder.dataset.machineId;if(type==='stopped')stoppedForm(machineId);else newOrderForm(machineId,type);return;}
  if(event.target.closest('[data-ta-back-next]')){const { machineId,previous,response }=activeFlow;openNextOrderChoice(machineId,previous,response);return;}
}

document.addEventListener('click',intercept,true);
document.addEventListener('change',event=>{
  if(event.target.name==='productionMode'){
    const form=event.target.form;form.querySelectorAll('.ta-confirm-option').forEach(label=>label.classList.toggle('is-selected',label.contains(event.target)&&event.target.checked));
    const correction=form.querySelector('[data-ta-correction]');if(correction)correction.hidden=event.target.value!=='correct';
  }
},true);
document.addEventListener('input',event=>{
  const machineId=event.target.dataset.taGood || event.target.dataset.taRejects || event.target.dataset.taStops;if(machineId)updateTimePreview(machineId);
},true);
function submitAssistantForm(form) {
  const handlers={
    taHandoffForm:submitHandoff,
    taFirstOrderForm:submitFirstOrder,
    taPointingForm:submitPointing,
    taShiftCloseForm:submitShiftClose,
    taOrderCloseForm:submitOrderClose,
    taNewOrderForm:submitNewOrder,
    taStoppedForm:submitStopped
  };
  const handler=handlers[form?.id];
  if(!handler)return false;
  setSubmitFeedback(form,'Validando informações…','working');
  Promise.resolve(handler(form)).catch(error=>{
    console.error('Falha ao salvar dados do assistente:',error);
    showError(form,error?.message || 'Não foi possível salvar. Tente novamente.');
    setBusy(assistantSubmitButton(form),false);
  });
  return true;
}

bindAssistantSubmit(document,submitAssistantForm);
document.addEventListener('submit',event=>{
  if(!isAssistantForm(event.target))return;
  event.preventDefault();event.stopImmediatePropagation();submitAssistantForm(event.target);
},true);

function schedule() {
  cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
    enhanceCards();
    const oldConference=document.getElementById('conferenceLayer');
    if(oldConference&&!oldConference.dataset.turnAssistant&&!observerBusy&&authReady()){
      observerBusy=true;const machineId=store.state.activeMachineId;queueMicrotask(async()=>{try{await openHandoff(machineId);}finally{observerBusy=false;}});
    }
  });
}
new MutationObserver(schedule).observe(document.body,{ childList:true,subtree:true });
store.subscribe(schedule);
schedule();
