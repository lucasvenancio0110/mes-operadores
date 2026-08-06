import { detectOperationalContext, formatCycle, formatNumber } from './core.js';
import { calculatePreparerMetrics, closureCopy, preparerMachineState } from './preparer-dashboard-engine.js';

const app = document.getElementById('app');
const REFRESH_INTERVAL_MS = 15000;
const auth = window.NEOMES_AUTH || {};
const user = auth.user || {};
let snapshot = null;
let selectedLine = 'all';
let search = '';
let loading = false;
let refreshTimer = 0;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
const integer = value => formatNumber(Math.max(0,Number(value) || 0));

function initials(name) {
  const parts=String(name || 'Preparador').trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || 'P'}${parts.length > 1 ? parts.at(-1)?.[0] || '' : parts[0]?.[1] || ''}`.toUpperCase();
}

function dateTime(value) {
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '—';
  return new Intl.DateTimeFormat('pt-BR',{ timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit' }).format(date);
}

function timeOnly(value) {
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '—';
  return new Intl.DateTimeFormat('pt-BR',{ timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit' }).format(date);
}

function duration(minutes) {
  const total=Math.max(0,Math.round(Number(minutes) || 0));
  const hours=Math.floor(total/60);const rest=total%60;
  return hours ? `${hours}h ${String(rest).padStart(2,'0')}min` : `${rest}min`;
}

function baseLayout() {
  app.innerHTML=`<main class="prep-page">
    <header class="prep-header">
      <div class="prep-brand"><img src="assets/brand/neomes-logo-horizontal.svg" width="560" height="150" alt="NEOMES"><span>Cockpit da preparação</span></div>
      <div class="prep-user"><span class="prep-avatar" aria-hidden="true">${escapeHtml(initials(user.name))}</span><div><strong>${escapeHtml(user.name || 'Preparador')}</strong><small>Matrícula ${escapeHtml(user.registration || '—')} · <span id="prepShiftLabel">${escapeHtml(user.operationalContext?.shift || '—')}º turno</span></small></div><button type="button" data-action="logout">Sair</button></div>
    </header>
    <section class="prep-livebar" aria-live="polite"><div><i></i><strong>Acompanhamento ao vivo</strong><span id="prepSyncLabel">Conectando…</span></div><button type="button" id="prepRefresh" aria-label="Atualizar painel">Atualizar agora</button></section>
    <section id="prepSummary" class="prep-summary" aria-label="Resumo da linha"></section>
    <section class="prep-toolbar"><div id="prepLineFilters" class="prep-line-filters" aria-label="Filtrar linha"></div><label class="prep-search"><span>Buscar máquina, operador ou OP</span><input id="prepSearch" type="search" placeholder="Ex.: TNL 091"></label></section>
    <section id="prepContent" class="prep-content"><div class="prep-loading"><i></i><strong>Carregando as linhas autorizadas…</strong></div></section>
  </main>`;
}

function summaryCard(label,value,tone,detail) {
  return `<article data-tone="${tone}"><span>${escapeHtml(label)}</span><strong>${integer(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function renderSummary() {
  const summary=snapshot?.summary || {};
  document.getElementById('prepSummary').innerHTML=[
    summaryCard('Máquinas',summary.total,'neutral','nas linhas autorizadas'),
    summaryCard('Produzindo',summary.producing,'success','operação normal'),
    summaryCard('Setup',summary.setup,'attention','preparação em andamento'),
    summaryCard('Paradas',summary.stopped,'critical','inclui manutenção'),
    summaryCard('Conferências',summary.pending,'attention','aguardando operador'),
    summaryCard('Fecham em breve',summary.closingSoon,'neutral','previsão de até 2 horas'),
    summaryCard('Risco de material',summary.materialRisks,'critical','matéria-prima limita a OP')
  ].join('');
}

function renderFilters() {
  const lines=snapshot?.lines || [];
  if(selectedLine!=='all'&&!lines.some(line=>line.id===selectedLine))selectedLine='all';
  document.getElementById('prepLineFilters').innerHTML=[{ id:'all',name:'Todas as linhas' },...lines].map(line=>`<button type="button" data-line-filter="${escapeHtml(line.id)}" aria-pressed="${selectedLine===line.id}">${escapeHtml(line.name)}</button>`).join('');
}

function releaseMarkup(metrics) {
  if(!metrics.releases.length)return '<div class="prep-releases is-empty"><strong>Liberações do turno</strong><span>Nenhuma liberação prevista no saldo atual.</span></div>';
  return `<div class="prep-releases"><strong>Liberações do turno</strong>${metrics.releases.map((release,index)=>`<div><b>${index===0?'PRÓXIMA':`${index+1}ª`}</b><span>${index===0?'A próxima liberação':`A ${index+1}ª liberação`} será feita com <strong>${integer(release.turnPiece)} peças produzidas neste turno</strong>.<small>Medição ${integer(release.measurementNumber)} de ${integer(release.totalMeasurements)} · ${escapeHtml(release.frequencyLabel)}</small></span></div>`).join('')}</div>`;
}

function forecastMarkup(machine) {
  const copy=closureCopy(machine);const forecast=machine.forecast || {};
  if(copy.reason==='none')return `<div class="prep-forecast" data-reason="none"><span>PREVISÃO DE FECHAMENTO</span><strong>${escapeHtml(copy.primary)}</strong></div>`;
  return `<div class="prep-forecast" data-reason="${copy.reason}"><span>PREVISÃO DE FECHAMENTO</span><time>${escapeHtml(dateTime(forecast.estimatedAt))}</time><strong>${escapeHtml(copy.primary)}</strong>${copy.secondary?`<small>${escapeHtml(copy.secondary)} <b>${escapeHtml(dateTime(forecast.materialEstimatedAt))}</b></small>`:''}<em>Estimativa considerando produção contínua e sem nova parada.</em></div>`;
}

function machineCard(machine) {
  const order=machine.activeOrder;const state=preparerMachineState(machine);const metrics=calculatePreparerMetrics(machine);
  const operator=machine.assignedOperator;const turn=machine.turnState || {};const runtime=machine.runtimeState || {};
  return `<article class="prep-machine" data-tone="${state.tone}" data-machine-id="${escapeHtml(machine.machineId)}">
    <header><div><p>${escapeHtml(machine.lineName)}</p><h2>${escapeHtml(machine.machineName)}</h2></div><span>${escapeHtml(state.label)}</span></header>
    <section class="prep-operator"><span>Operador responsável</span><strong>${escapeHtml(operator?.name || 'Ainda não atribuído')}</strong><small>${operator?.registration?`Matrícula ${escapeHtml(operator.registration)}`:'Nenhuma atribuição neste turno'}</small></section>
    ${order?`<section class="prep-order"><div><span>OP ativa</span><strong>${escapeHtml(order.op)}</strong></div><div><span>Item</span><strong>${escapeHtml(order.item || '—')}</strong></div><p>${escapeHtml(order.description || 'Sem descrição informada')}</p></section>
      <section class="prep-metrics"><div><span>Produção da OP</span><strong>${integer(order.producedSoFar)} / ${integer(order.opTarget)}</strong></div><div><span>Falta produzir</span><strong>${integer(machine.forecast?.opRemaining)} peças</strong></div><div><span>Meta no saldo do turno</span><strong>${integer(metrics.shiftTarget)} peças</strong></div><div><span>Tempo de ciclo</span><strong>${escapeHtml(formatCycle(order.cycleSeconds))}</strong></div><div><span>Material disponível</span><strong>${integer(machine.forecast?.availablePieces)} peças</strong></div><div><span>Produzido neste turno</span><strong>${integer(turn.goodPieces)} peças</strong></div></section>
      <section class="prep-clock"><div><span>Relógio lógico usado</span><strong>${duration(machine.turnClock?.usedMinutes)}</strong></div><div><span>Saldo do turno</span><strong>${duration(metrics.remainingMinutes)}</strong></div><small>Paradas informadas: ${duration(turn.stopMinutes)} · Refugos: ${integer(turn.rejects)}</small></section>
      ${forecastMarkup(machine)}${releaseMarkup(metrics)}`:`<section class="prep-no-order"><strong>Nenhuma OP ativa</strong><span>A máquina permanece visível para o preparador, sem dados de produção para calcular.</span></section>`}
    <footer><span>${runtime.reason?`Situação: ${escapeHtml(runtime.reason)}${runtime.note?` · ${escapeHtml(runtime.note)}`:''}`:'Sem ocorrência física informada'}</span><time>Último apontamento: ${escapeHtml(dateTime(turn.lastPointingAt))}</time></footer>
  </article>`;
}

function visibleMachines() {
  const term=search.trim().toLocaleLowerCase('pt-BR');
  return (snapshot?.machines || []).filter(machine=>{
    if(selectedLine!=='all'&&machine.lineId!==selectedLine)return false;
    if(!term)return true;
    return [machine.machineName,machine.lineName,machine.activeOrder?.op,machine.activeOrder?.item,machine.assignedOperator?.name,machine.assignedOperator?.registration].some(value=>String(value || '').toLocaleLowerCase('pt-BR').includes(term));
  });
}

function renderMachines() {
  const content=document.getElementById('prepContent');const machines=visibleMachines();
  if(!(snapshot?.lines || []).length){
    content.innerHTML='<div class="prep-empty"><strong>Nenhuma linha vinculada ao seu usuário</strong><p>Peça ao administrador para liberar a linha que você prepara. O painel nunca mostra máquinas fora da sua autorização.</p></div>';
    return;
  }
  if(!machines.length){content.innerHTML='<div class="prep-empty"><strong>Nenhuma máquina encontrada</strong><p>Altere o filtro de linha ou a busca.</p></div>';return;}
  const groups=new Map();for(const machine of machines){if(!groups.has(machine.lineId))groups.set(machine.lineId,{ name:machine.lineName,machines:[] });groups.get(machine.lineId).machines.push(machine);}
  content.innerHTML=[...groups.values()].map(group=>`<section class="prep-line"><header><div><p>LINHA AUTORIZADA</p><h1>${escapeHtml(group.name)}</h1></div><span>${group.machines.length} máquina${group.machines.length===1?'':'s'}</span></header><div class="prep-machine-grid">${group.machines.map(machineCard).join('')}</div></section>`).join('');
}

function renderSnapshot() {
  renderSummary();renderFilters();renderMachines();
  const shiftLabel=document.getElementById('prepShiftLabel');if(shiftLabel)shiftLabel.textContent=`${snapshot?.shift || '—'}º turno · ${String(snapshot?.productionDate || '').split('-').reverse().join('/')}`;
  const label=document.getElementById('prepSyncLabel');
  label.textContent=`Atualizado às ${timeOnly(snapshot?.serverTime || new Date())} · atualização automática a cada 15 s`;
  document.querySelector('.prep-livebar')?.setAttribute('data-state','online');
}

async function refreshDashboard() {
  if(loading)return;loading=true;
  const button=document.getElementById('prepRefresh');if(button){button.disabled=true;button.textContent='Atualizando…';}
  try{
    const context=detectOperationalContext();
    const query=new URLSearchParams({ productionDate:context.productionDate || '',shift:String(context.shift || '') });
    const response=await fetch(`/api/v1/turn-assistant/line-dashboard?${query}`,{ credentials:'same-origin',headers:{ Accept:'application/json' },cache:'no-store' });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error || `Erro ${response.status}`);
    snapshot=payload;renderSnapshot();
  }catch(error){
    const bar=document.querySelector('.prep-livebar');bar?.setAttribute('data-state','offline');
    const label=document.getElementById('prepSyncLabel');if(label)label.textContent=`Sem atualização: ${error.message}`;
    if(!snapshot)document.getElementById('prepContent').innerHTML='<div class="prep-empty"><strong>Não foi possível carregar a linha</strong><p>Confira a conexão e toque em “Atualizar agora”. Nenhum dado foi alterado.</p></div>';
  }finally{loading=false;if(button){button.disabled=false;button.textContent='Atualizar agora';}}
}

function bindEvents() {
  app.addEventListener('click',event=>{
    const line=event.target.closest('[data-line-filter]');if(line){selectedLine=line.dataset.lineFilter;renderFilters();renderMachines();return;}
    if(event.target.closest('#prepRefresh'))refreshDashboard();
  });
  app.addEventListener('input',event=>{if(event.target.id==='prepSearch'){search=event.target.value;renderMachines();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshDashboard();});
  window.addEventListener('online',refreshDashboard);
  refreshTimer=window.setInterval(refreshDashboard,REFRESH_INTERVAL_MS);
}

export function startPreparerDashboard() {
  baseLayout();bindEvents();refreshDashboard();
  window.NEOMES_PREPARER_DASHBOARD={ refresh:refreshDashboard,destroy(){window.clearInterval(refreshTimer);} };
}

startPreparerDashboard();
