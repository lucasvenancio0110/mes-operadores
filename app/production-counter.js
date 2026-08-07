import { store, getMachine, currentMachineSession } from './core.js';
import { calculateEstimatedCounter } from './production-counter-engine.js?v=6.4.0';

const API='/api/v1/production-counter';
const cache=new Map();
let observerRaf=0;

const sessionContext=()=>({
  productionDate:store.state.session?.productionDate||new Date().toISOString().slice(0,10),
  shift:String(store.state.session?.shift||'1')
});

function machineContext(machineId){
  const machine=getMachine(machineId)||{};const local=currentMachineSession(machineId)||{};
  return {machineId,lineId:local.lineId||machine.lineId||'',machineName:local.machineName||machine.name||machineId,...sessionContext()};
}

async function request(path,options={}){
  const response=await fetch(`${API}${path}`,{credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json',...(options.headers||{})},...options});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error||`Erro ${response.status}`);
  return payload;
}

function conferenceValue(form){
  const mode=form.elements.productionMode?.value;
  const current=Number(currentMachineSession(form.dataset.machineId)?.producedSoFar||0);
  if(mode==='correct')return Number(form.elements.productionCorrected?.value||0);
  const summary=form.closest('.ta-sheet')?.querySelector('.ta-order-received dl dd:last-child')?.textContent||'';
  const parsed=Number(summary.replace(/[^0-9,.-]/g,'').replace(',','.'));
  return Number.isFinite(parsed)?parsed:current;
}

function injectConferenceField(form){
  if(form.querySelector('[name="initialShiftPieces"]'))return;
  const material=form.querySelector('.ta-material-block');
  const section=document.createElement('section');section.className='ta-confirm-block neomes-counter-conference';
  section.innerHTML=`<div class="ta-block-heading"><span>3</span><div><strong>Produção já feita neste turno</strong><small>Use a quantidade que já saiu desde a troca de turno até esta conferência. Este valor inicia somente o contador estimado.</small></div></div><label class="ta-large-field"><span>Quantas peças você já produziu neste turno?</span><div class="ta-number-input"><input name="initialShiftPieces" inputmode="numeric" min="0" required value="0"><b>peças</b></div></label><div class="neomes-counter-note">Não soma automaticamente na OP. A produção oficial continua sendo o valor informado no apontamento.</div>`;
  material?.after(section);
}

async function registerConference(form,snapshot){
  const machineId=form.dataset.machineId;if(!machineId)return;
  if(document.body.contains(form))return;
  const ctx=machineContext(machineId);
  try{
    const payload=await request('/conference',{method:'POST',body:JSON.stringify({...ctx,...snapshot})});
    cache.set(machineId,{payload,fetchedAt:Date.now()});
    enhance();
  }catch(error){console.warn('Contador estimado não iniciado:',error);}
}

function bindConference(form){
  if(form.dataset.counterBound)return;form.dataset.counterBound='true';injectConferenceField(form);
  form.addEventListener('submit',()=>{
    const initial=Number(form.elements.initialShiftPieces?.value);
    const currentBarPieces=Number(form.elements.currentBarPieces?.value);
    const feederBars=Number(form.elements.feederBars?.value);
    if(!Number.isFinite(initial)||initial<0)return;
    const snapshot={officialProduced:conferenceValue(form),initialShiftPieces:Math.floor(initial),currentBarPieces:Math.max(0,Math.floor(currentBarPieces||0)),feederBars:Math.max(0,Math.floor(feederBars||0))};
    setTimeout(()=>registerConference(form,snapshot),900);
  },true);
}

function displayEstimate(entry){
  const payload=entry?.payload;if(!payload?.configured||!payload.estimate)return null;
  const estimate=payload.estimate;const now=Date.now();const cycle=Number(estimate.cycleSeconds||0);
  const running=payload.runtimeState?.physicalStatus==='producing'&&cycle>0;
  const elapsed=running?Math.max(0,(now-entry.fetchedAt)/1000):0;
  const accumulatedPartial=Number(estimate.partialCycleSeconds||0)+elapsed;
  const extra=running?Math.floor(accumulatedPartial/cycle):0;
  const partial=running?accumulatedPartial%cycle:Number(estimate.partialCycleSeconds||0);
  const estimatedRemainingPieces=Math.max(0,Number(estimate.estimatedRemainingPieces||0)-extra);
  const estimatedRemainingSeconds=Math.max(0,estimatedRemainingPieces*cycle-partial);
  const secondsToNext=running&&estimatedRemainingPieces>0?(partial===0?cycle:cycle-partial):null;
  return {
    ...estimate,
    estimatedShiftPieces:Number(estimate.estimatedShiftPieces||0)+extra,
    estimatedOrderProduced:Number(estimate.estimatedOrderProduced||0)+extra,
    estimatedRemainingPieces,
    estimatedRemainingSeconds,
    partialCycleSeconds:partial,
    nextPieceAt:secondsToNext===null?null:new Date(now+secondsToNext*1000).toISOString(),
    estimatedFinishAt:new Date(now+estimatedRemainingSeconds*1000).toISOString()
  };
}

function fmtClock(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
function fmtDuration(seconds){const total=Math.max(0,Math.round(Number(seconds)||0));const hours=Math.floor(total/3600);const minutes=Math.floor((total%3600)/60);return hours?`${hours}h ${String(minutes).padStart(2,'0')}min`:`${minutes} min`;}

async function refresh(machineId,force=false){
  const existing=cache.get(machineId);if(!force&&existing&&Date.now()-existing.fetchedAt<14000)return existing.payload;
  const ctx=machineContext(machineId);const query=new URLSearchParams({machineId,productionDate:ctx.productionDate,shift:ctx.shift});
  try{const payload=await request(`/state?${query}`);cache.set(machineId,{payload,fetchedAt:Date.now()});return payload;}catch{return null;}
}

function statusLabel(status){return ({producing:'Produzindo',setup:'Setup',adjustment:'Ajuste',maintenance:'Manutenção',stopped:'Parada'})[status]||status;}

function ensureCounterPanel(sheet,machineId){
  let panel=sheet.querySelector('.neomes-live-counter');
  if(!panel){
    panel=document.createElement('section');panel.className='neomes-live-counter';panel.dataset.machineId=machineId;
    panel.innerHTML=`<header><div><small>CONTADOR ESTIMADO</small><strong data-counter-machine></strong></div><span data-counter-status>—</span></header><div class="neomes-counter-grid"><div><span>Estimado no turno</span><strong data-counter-shift>—</strong></div><div><span>Estimado na OP</span><strong data-counter-order>—</strong></div><div><span>Material estimado</span><strong data-counter-material>—</strong></div><div><span>Próxima peça</span><strong data-counter-next>—</strong></div><div><span>Previsão de encerramento</span><strong data-counter-finish>—</strong></div><div><span>Tempo produtivo restante</span><strong data-counter-remaining>—</strong></div></div><p data-counter-copy>Estimativa em tempo real. O apontamento informado pelo operador continua sendo a única produção oficial da OP.</p><div class="neomes-counter-status-actions">${[['producing','Produzindo'],['setup','Setup'],['adjustment','Ajuste'],['maintenance','Manutenção'],['stopped','Parada']].map(([value,label])=>`<button type="button" data-counter-status-set="${value}">${label}</button>`).join('')}</div><footer><button type="button" data-counter-edit>Editar dados</button><button type="button" data-counter-history>Histórico da máquina</button></footer>`;
    sheet.querySelector('.ta-order-received')?.after(panel);
    panel.addEventListener('click',event=>handlePanelAction(event,machineId));
  }
  return panel;
}

async function handlePanelAction(event,machineId){
  const statusButton=event.target.closest('[data-counter-status-set]');
  if(statusButton){
    statusButton.disabled=true;const ctx=machineContext(machineId);
    try{const payload=await request('/status',{method:'POST',body:JSON.stringify({...ctx,physicalStatus:statusButton.dataset.counterStatusSet})});cache.set(machineId,{payload,fetchedAt:Date.now()});renderPanels();}catch(error){alert(error.message);}finally{statusButton.disabled=false;}
    return;
  }
  if(event.target.closest('[data-counter-history]'))return openHistory(machineId);
  if(event.target.closest('[data-counter-edit]'))return openEditor(machineId);
}

function modal(title,body){
  document.querySelector('.neomes-counter-modal')?.remove();const dialog=document.createElement('dialog');dialog.className='neomes-counter-modal';dialog.innerHTML=`<section><header><strong>${title}</strong><button type="button" data-close>×</button></header><div class="neomes-counter-modal-body">${body}</div></section>`;document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return dialog;
}

async function openHistory(machineId){
  const dialog=modal('Histórico da máquina','<p>Carregando histórico…</p>');
  try{const payload=await request(`/history?machineId=${encodeURIComponent(machineId)}`);const body=dialog.querySelector('.neomes-counter-modal-body');body.innerHTML=payload.events.length?payload.events.map(event=>`<article class="neomes-history-event"><time>${new Date(event.createdAt).toLocaleString('pt-BR')}</time><strong>${event.title}</strong><span>${event.actorName||'Sistema'}${event.op?` · OP ${event.op}`:''}</span><pre>${escapeHtml(JSON.stringify(event.payload,null,2))}</pre></article>`).join(''):'<p>Nenhum evento registrado.</p>';}catch(error){dialog.querySelector('.neomes-counter-modal-body').textContent=error.message;}
}

function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);}

async function openEditor(machineId){
  const payload=await refresh(machineId,true);const order=payload?.activeOrder;if(!order)return alert('Não existe OP ativa nesta máquina.');
  const dialog=modal('Editar dados da máquina',`<form class="neomes-counter-editor"><label>OP<input name="op" value="${escapeHtml(order.op||'')}"></label><label>Item<input name="item" value="${escapeHtml(order.item||'')}"></label><label>Descrição<input name="description" value="${escapeHtml(order.description||'')}"></label><label>Meta da OP<input name="opTarget" inputmode="numeric" value="${order.opTarget||0}"></label><label>Tempo de ciclo (segundos)<input name="cycleSeconds" inputmode="decimal" value="${order.cycleSeconds||0}"></label><label>Comprimento da peça (mm)<input name="pieceLengthMm" inputmode="decimal" value="${order.pieceLengthMm||0}"></label><label>Peças restantes na barra atual<input name="currentBarPieces" inputmode="numeric" value="${order.currentBarPieces||0}"></label><label>Barras no alimentador<input name="feederBars" inputmode="numeric" value="${order.feederBars||0}"></label><label>Motivo / observação<textarea name="note" placeholder="Explique a alteração quando necessário"></textarea></label><button type="submit">Salvar alteração</button></form>`);
  dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;const ctx=machineContext(machineId);const data=Object.fromEntries(new FormData(form));for(const key of ['opTarget','cycleSeconds','pieceLengthMm','currentBarPieces','feederBars'])data[key]=Number(data[key]);const button=form.querySelector('button');button.disabled=true;try{await request('/order',{method:'POST',body:JSON.stringify({...ctx,...data})});await refresh(machineId,true);dialog.close();renderPanels();}catch(error){alert(error.message);}finally{button.disabled=false;}};
}

async function enhanceSheet(sheet){
  const form=sheet.querySelector('#taHandoffForm');if(form)bindConference(form);
  const machineId=form?.dataset.machineId||sheet.querySelector('[data-machine-id]')?.dataset.machineId||document.querySelector('#taHandoffForm')?.dataset.machineId;
  if(!machineId)return;
  const panel=ensureCounterPanel(sheet,machineId);await refresh(machineId);renderPanel(panel,machineId);
}

function renderPanel(panel,machineId){
  const entry=cache.get(machineId);const payload=entry?.payload;const estimate=displayEstimate(entry);panel.querySelector('[data-counter-machine]').textContent=getMachine(machineId)?.name||machineId;
  if(!payload?.configured||!estimate){panel.classList.add('is-not-configured');panel.querySelector('[data-counter-status]').textContent='Aguardando conferência';panel.querySelector('[data-counter-copy]').textContent='O contador começará quando a conferência deste turno for salva.';return;}
  panel.classList.remove('is-not-configured');const physical=payload.runtimeState?.physicalStatus||'stopped';panel.querySelector('[data-counter-status]').textContent=statusLabel(physical);panel.dataset.status=physical;panel.querySelector('[data-counter-shift]').textContent=`${estimate.estimatedShiftPieces} peças`;panel.querySelector('[data-counter-order]').textContent=`${Math.floor(estimate.estimatedOrderProduced)} peças`;panel.querySelector('[data-counter-material]').textContent=`${estimate.estimatedRemainingPieces} peças`;panel.querySelector('[data-counter-next]').textContent=physical==='producing'?fmtClock(estimate.nextPieceAt):'Pausado';panel.querySelector('[data-counter-finish]').textContent=fmtClock(estimate.estimatedFinishAt);panel.querySelector('[data-counter-remaining]').textContent=fmtDuration(estimate.estimatedRemainingSeconds);for(const button of panel.querySelectorAll('[data-counter-status-set]'))button.setAttribute('aria-pressed',String(button.dataset.counterStatusSet===physical));
}

function renderPanels(){for(const panel of document.querySelectorAll('.neomes-live-counter'))renderPanel(panel,panel.dataset.machineId);}

function enhance(){if(observerRaf)return;observerRaf=requestAnimationFrame(async()=>{observerRaf=0;for(const sheet of document.querySelectorAll('.ta-sheet'))await enhanceSheet(sheet);renderPanels();});}

new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});
setInterval(()=>{for(const panel of document.querySelectorAll('.neomes-live-counter'))refresh(panel.dataset.machineId,true).then(renderPanels);},15000);
setInterval(renderPanels,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){for(const panel of document.querySelectorAll('.neomes-live-counter'))refresh(panel.dataset.machineId,true).then(renderPanels);}});
enhance();
