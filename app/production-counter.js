import { store, getMachine, currentMachineSession } from './core.js';

const API='/api/v1/production-counter';
const cache=new Map();
const pendingConferences=new Map();
const registering=new Set();
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
  if(!material)return;
  const section=document.createElement('section');section.className='ta-confirm-block neomes-counter-conference';
  section.innerHTML=`<div class="ta-block-heading"><span>3</span><div><strong>Produção já feita neste turno</strong><small>Esse valor inicia somente o contador estimado.</small></div></div><label class="ta-large-field"><span>Quantas peças você já produziu neste turno?</span><div class="ta-number-input"><input name="initialShiftPieces" inputmode="numeric" min="0" required value="0"><b>peças</b></div></label><div class="neomes-counter-note">O apontamento continua sendo a produção oficial da OP.</div>`;
  material.after(section);
}

function bindConference(form){
  if(form.dataset.counterBound)return;
  form.dataset.counterBound='true';
  injectConferenceField(form);
  form.addEventListener('submit',()=>{
    const machineId=form.dataset.machineId;
    const initial=Number(form.elements.initialShiftPieces?.value);
    const currentBarPieces=Number(form.elements.currentBarPieces?.value);
    const feederBars=Number(form.elements.feederBars?.value);
    if(!machineId||!Number.isFinite(initial)||initial<0)return;
    pendingConferences.set(machineId,{
      officialProduced:conferenceValue(form),
      initialShiftPieces:Math.floor(initial),
      currentBarPieces:Math.max(0,Math.floor(currentBarPieces||0)),
      feederBars:Math.max(0,Math.floor(feederBars||0))
    });
  },true);
}

async function registerPendingConference(machineId){
  const snapshot=pendingConferences.get(machineId);
  const local=currentMachineSession(machineId);
  if(!snapshot||registering.has(machineId)||!local?.turnAssistantConfirmedAt)return;
  registering.add(machineId);
  try{
    const payload=await request('/conference',{method:'POST',body:JSON.stringify({...machineContext(machineId),...snapshot})});
    pendingConferences.delete(machineId);
    cache.set(machineId,{payload,fetchedAt:Date.now()});
    renderMachineCards();
  }catch(error){
    console.warn('Contador estimado não iniciado:',error);
  }finally{
    registering.delete(machineId);
  }
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
  return {
    ...estimate,
    estimatedShiftPieces:Number(estimate.estimatedShiftPieces||0)+extra,
    estimatedRemainingSeconds,
    estimatedFinishAt:new Date(now+estimatedRemainingSeconds*1000).toISOString()
  };
}

function fmtDuration(seconds){
  const total=Math.max(0,Math.round(Number(seconds)||0));
  const hours=Math.floor(total/3600);const minutes=Math.floor((total%3600)/60);
  return hours?`${hours}h ${String(minutes).padStart(2,'0')}min`:`${minutes} min`;
}

function fmtForecast(value){
  const date=new Date(value);if(Number.isNaN(date.getTime()))return '—';
  const now=new Date();const sameDay=date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth()&&date.getDate()===now.getDate();
  const time=date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  return sameDay?time:`${date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} · ${time}`;
}

async function refresh(machineId,force=false){
  const existing=cache.get(machineId);if(!force&&existing&&Date.now()-existing.fetchedAt<14000)return existing.payload;
  const ctx=machineContext(machineId);const query=new URLSearchParams({machineId,productionDate:ctx.productionDate,shift:ctx.shift});
  try{const payload=await request(`/state?${query}`);cache.set(machineId,{payload,fetchedAt:Date.now()});return payload;}catch{return null;}
}

function ensureInlineCounter(card){
  const facts=card.querySelector('.ta-compact-facts');if(!facts)return null;
  let counter=facts.querySelector('[data-inline-counter]');
  if(!counter){
    counter=document.createElement('div');counter.dataset.inlineCounter='true';counter.innerHTML='<span>Contador do turno</span><strong data-counter-shift>—</strong>';
    facts.append(counter);
  }
  return counter;
}

function renderMachineCard(card,machineId){
  const counter=ensureInlineCounter(card);if(!counter)return;
  const estimate=displayEstimate(cache.get(machineId));
  const shiftValue=counter.querySelector('[data-counter-shift]');
  if(!estimate){shiftValue.textContent='—';return;}
  shiftValue.textContent=String(Math.floor(estimate.estimatedShiftPieces));
  const facts=[...card.querySelectorAll('.ta-compact-facts > div')];
  const remaining=facts.find(item=>item.querySelector('span')?.textContent?.trim()==='Saldo da máquina'||item.querySelector('span')?.textContent?.trim()==='Tempo restante');
  if(remaining){
    remaining.querySelector('span').textContent='Tempo restante';
    const strong=remaining.querySelector('strong');if(strong)strong.textContent=fmtDuration(estimate.estimatedRemainingSeconds);
  }
  const forecast=card.querySelector('.ta-forecast-time');
  if(forecast)forecast.textContent=fmtForecast(estimate.estimatedFinishAt);
}

function renderMachineCards(){
  const cards=[...document.querySelectorAll('.ops-machine-card')];
  cards.forEach((card,index)=>{
    const machineId=store.state.assignments[index]?.machineId;if(!machineId)return;
    renderMachineCard(card,machineId);
  });
}

async function syncMachineCards(force=false){
  const cards=[...document.querySelectorAll('.ops-machine-card')];
  await Promise.all(cards.map(async(card,index)=>{
    const machineId=store.state.assignments[index]?.machineId;if(!machineId)return;
    await registerPendingConference(machineId);
    await refresh(machineId,force);
  }));
  renderMachineCards();
}

function enhance(){
  if(observerRaf)return;
  observerRaf=requestAnimationFrame(async()=>{
    observerRaf=0;
    for(const form of document.querySelectorAll('#taHandoffForm'))bindConference(form);
    await syncMachineCards(false);
  });
}

new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});
setInterval(renderMachineCards,1000);
setInterval(()=>syncMachineCards(true),15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncMachineCards(true);});
enhance();
