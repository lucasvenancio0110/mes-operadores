import { store, currentMachineSession, getMachine } from './core.js';

const layers=document.getElementById('layers');
const STATUS_OPTIONS=[
  ['producing','Produzindo','Operação normal'],
  ['setup','Setup','Preparação ou troca em andamento'],
  ['adjustment','Ajuste','Correção ou regulagem em andamento'],
  ['maintenance','Manutenção','Atendimento técnico ou manutenção'],
  ['stopped','Parada','Máquina sem produzir']
];
let scheduled=false;

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const statusLabel=value=>STATUS_OPTIONS.find(([status])=>status===value)?.[1]||'Não informada';

function machineIdForCard(card,index){
  const explicit=card.querySelector('[data-ta-point],[data-ta-update],[data-ta-reconfirm],[data-ta-close-order],[data-action="open-conference"],[data-action="edit-conference"]');
  return explicit?.dataset.taPoint || explicit?.dataset.taUpdate || explicit?.dataset.taReconfirm || explicit?.dataset.taCloseOrder || explicit?.dataset.machineId || store.state.assignments?.[index]?.machineId || '';
}

function closeLayer(){
  if(!layers?.querySelector('[data-machine-runtime-layer]'))return;
  layers.innerHTML='';
  document.body.classList.remove('has-layer');
}

function runtimeContext(machineId){
  const session=currentMachineSession(machineId)||{};
  const machine=getMachine(machineId)||{};
  return {
    machineId,
    lineId:session.lineId||machine.lineId||'',
    productionDate:store.state.session?.productionDate||'',
    shift:String(store.state.session?.shift||''),
    op:session.op||''
  };
}

async function request(path,options={}){
  const response=await fetch(path,{
    credentials:'same-origin',
    ...options,
    headers:{ Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{}) }
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error||`Erro ${response.status}`);
  return payload;
}

function openStatus(machineId){
  const session=currentMachineSession(machineId)||{};
  const machine=getMachine(machineId)||{ name:machineId };
  const selected=session.physicalStatus||session.runtimeState?.physicalStatus||'producing';
  layers.innerHTML=`<div class="ops-layer runtime-layer" data-machine-runtime-layer>
    <section class="ops-sheet runtime-sheet" role="dialog" aria-modal="true" aria-labelledby="runtimeTitle">
      <header class="ops-sheet__head"><div><p class="ops-eyebrow">SITUAÇÃO FÍSICA</p><h2 id="runtimeTitle">${escapeHtml(machine.name)}</h2></div><button class="ops-icon-btn" type="button" data-runtime-close aria-label="Fechar">×</button></header>
      <div class="ops-sheet__body">
        <p class="runtime-help">A situação física é independente da OP e do fluxo de conferência/apontamento.</p>
        <div class="runtime-status-grid">${STATUS_OPTIONS.map(([value,label,detail])=>`<button type="button" data-runtime-choice="${value}" aria-pressed="${selected===value}"><strong>${label}</strong><span>${detail}</span></button>`).join('')}</div>
        <label class="runtime-note"><span>Motivo ou observação</span><textarea data-runtime-note placeholder="Obrigatório para parada e manutenção">${escapeHtml(session.runtimeState?.note||'')}</textarea></label>
        <div class="runtime-error" data-runtime-error role="alert"></div>
      </div>
      <footer class="ops-sheet__actions"><button class="ops-btn ops-btn--ghost" type="button" data-runtime-close>Cancelar</button><button class="ops-btn ops-btn--primary" type="button" data-runtime-save>Salvar situação</button></footer>
    </section>
  </div>`;
  document.body.classList.add('has-layer');
  const root=layers.querySelector('[data-machine-runtime-layer]');
  root.querySelectorAll('[data-runtime-close]').forEach(button=>button.addEventListener('click',closeLayer));
  root.querySelectorAll('[data-runtime-choice]').forEach(button=>button.addEventListener('click',()=>{
    root.querySelectorAll('[data-runtime-choice]').forEach(item=>item.setAttribute('aria-pressed','false'));
    button.setAttribute('aria-pressed','true');
  }));
  root.querySelector('[data-runtime-save]').addEventListener('click',async event=>{
    const button=event.currentTarget;
    const choice=root.querySelector('[data-runtime-choice][aria-pressed="true"]')?.dataset.runtimeChoice||'';
    const note=root.querySelector('[data-runtime-note]').value.trim();
    const error=root.querySelector('[data-runtime-error]');
    if(!choice)return void(error.textContent='Selecione a situação da máquina.');
    if(['maintenance','stopped'].includes(choice)&&!note)return void(error.textContent='Informe o motivo da parada ou manutenção.');
    button.disabled=true;button.textContent='Salvando…';error.textContent='';
    try{
      const payload=await request('/api/v1/machine-runtime/status',{ method:'POST',body:JSON.stringify({ ...runtimeContext(machineId),physicalStatus:choice,note }) });
      store.update(state=>{
        const current=state.machineSessions[machineId];
        if(!current)return;
        state.machineSessions[machineId]={ ...current,physicalStatus:payload.runtimeState.physicalStatus,runtimeState:payload.runtimeState,updatedAt:payload.runtimeState.updatedAt };
      },'machine-runtime-status');
      closeLayer();
    }catch(failure){error.textContent=failure.message;button.disabled=false;button.textContent='Salvar situação';}
  });
}

function eventTitle(event){
  const labels={
    'machine.status_changed':'Situação da máquina alterada',
    'turn.handoff_confirmed':'Conferência confirmada',
    'production.pointed':'Apontamento realizado',
    'order.closed':'OP encerrada',
    'order.started':'OP iniciada',
    'machine.stopped':'Máquina parada'
  };
  return labels[event.eventType]||String(event.eventType||'Evento operacional').replaceAll('.',' ');
}

async function openHistory(machineId){
  const machine=getMachine(machineId)||{ name:machineId };
  layers.innerHTML=`<div class="ops-layer runtime-layer" data-machine-runtime-layer><section class="ops-sheet runtime-sheet" role="dialog" aria-modal="true" aria-labelledby="runtimeHistoryTitle"><header class="ops-sheet__head"><div><p class="ops-eyebrow">HISTÓRICO DA MÁQUINA</p><h2 id="runtimeHistoryTitle">${escapeHtml(machine.name)}</h2></div><button class="ops-icon-btn" type="button" data-runtime-close aria-label="Fechar">×</button></header><div class="ops-sheet__body"><div class="runtime-history" data-runtime-history><p>Carregando histórico…</p></div></div></section></div>`;
  document.body.classList.add('has-layer');
  const root=layers.querySelector('[data-machine-runtime-layer]');
  root.querySelector('[data-runtime-close]').addEventListener('click',closeLayer);
  const output=root.querySelector('[data-runtime-history]');
  try{
    const payload=await request(`/api/v1/machine-runtime/history?machineId=${encodeURIComponent(machineId)}`);
    output.innerHTML=payload.events?.length?payload.events.map(event=>`<article class="runtime-history-item"><time>${escapeHtml(new Date(event.createdAt).toLocaleString('pt-BR'))}</time><strong>${escapeHtml(eventTitle(event))}</strong><span>${escapeHtml(event.actorName||'Sistema')}${event.op?` · OP ${escapeHtml(event.op)}`:''}</span>${event.eventType==='machine.status_changed'?`<p>${escapeHtml(statusLabel(event.payload?.after))}${event.payload?.note?` · ${escapeHtml(event.payload.note)}`:''}</p>`:''}</article>`).join(''):'<p>Nenhum evento operacional encontrado para esta máquina.</p>';
  }catch(failure){output.innerHTML=`<p class="runtime-error">${escapeHtml(failure.message)}</p>`;}
}

function enhance(){
  scheduled=false;
  const cards=[...document.querySelectorAll('.ops-machine-card')];
  cards.forEach((card,index)=>{
    const machineId=machineIdForCard(card,index);
    const session=currentMachineSession(machineId);
    if(!machineId||!session)return;
    const footer=card.querySelector('.ta-card-actions,.ops-machine-card__actions');
    if(!footer||card.querySelector('[data-runtime-tools]'))return;
    const tools=document.createElement('section');
    tools.className='runtime-card-tools';tools.dataset.runtimeTools='true';
    const physical=session.physicalStatus||session.runtimeState?.physicalStatus||session.status||'producing';
    tools.innerHTML=`<div><span>Situação física</span><strong>${escapeHtml(statusLabel(physical))}</strong></div><div class="runtime-card-actions"><button type="button" data-runtime-open>Informar situação</button><button type="button" data-runtime-history-open>Histórico</button></div>`;
    footer.before(tools);
    tools.querySelector('[data-runtime-open]').addEventListener('click',()=>openStatus(machineId));
    tools.querySelector('[data-runtime-history-open]').addEventListener('click',()=>openHistory(machineId));
  });
}

function schedule(){
  if(scheduled)return;
  scheduled=true;
  requestAnimationFrame(enhance);
}

new MutationObserver(schedule).observe(document.body,{ childList:true,subtree:true });
store.subscribe(schedule);
schedule();
