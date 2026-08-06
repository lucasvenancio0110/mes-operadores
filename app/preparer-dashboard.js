import { detectOperationalContext, formatCycle, formatNumber } from './core.js';
import { calculatePreparerMetrics, closureCopy, closureUrgency, preparerMachineState } from './preparer-dashboard-engine.js';
import { FACTORY_MAP_ZONES, mapMachineMetadata, normalizeMapMachineId } from './preparer-map-layout.js';

const app = document.getElementById('app');
const REFRESH_INTERVAL_MS = 15000;
const auth = window.NEOMES_AUTH || {};
const user = auth.user || {};
let snapshot = null;
let selectedLine = 'all';
let search = '';
let viewMode = 'map';
let attentionFilter = 'all';
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
    <section class="prep-toolbar">
      <div class="prep-toolbar-row"><div id="prepLineFilters" class="prep-line-filters" aria-label="Filtrar linha"></div><div id="prepViewMode" class="prep-view-mode" aria-label="Modo de visualização"></div></div>
      <div class="prep-toolbar-row prep-toolbar-row--secondary"><div id="prepAttentionFilters" class="prep-attention-filters" aria-label="Filtrar alertas"></div><label class="prep-search"><span>Buscar máquina, operador ou OP</span><input id="prepSearch" type="search" placeholder="Ex.: TNL 091"></label></div>
    </section>
    <section id="prepContent" class="prep-content"><div class="prep-loading"><i></i><strong>Carregando as linhas autorizadas…</strong></div></section>
    <div id="prepDetailLayer" class="prep-detail-layer" aria-hidden="true"><button type="button" class="prep-detail-backdrop" data-detail-close aria-label="Fechar detalhes"></button><aside class="prep-detail-panel" role="dialog" aria-modal="true" aria-labelledby="prepDetailTitle"><div id="prepDetailContent"></div></aside></div>
  </main>`;
}

function summaryCard(label,value,tone,detail) {
  return `<article data-tone="${tone}"><span>${escapeHtml(label)}</span><strong>${integer(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function renderSummary() {
  const summary=snapshot?.summary || {};
  const urgency=(snapshot?.machines || []).map(machine=>closureUrgency(machine,snapshot?.serverTime || new Date()));
  const withinSixteen=urgency.filter(item=>['attention','critical'].includes(item.code)).length;
  const underEight=urgency.filter(item=>item.code==='critical').length;
  document.getElementById('prepSummary').innerHTML=[
    summaryCard('Máquinas',summary.total,'neutral','nas linhas autorizadas'),
    summaryCard('Produzindo',summary.producing,'success','operação normal'),
    summaryCard('Setup',summary.setup,'attention','preparação em andamento'),
    summaryCard('Paradas',summary.stopped,'critical','inclui manutenção'),
    summaryCard('Conferências',summary.pending,'attention','aguardando operador'),
    summaryCard('Fecham em até 16h',withinSixteen,'attention','atenção para o próximo turno'),
    summaryCard('Fecham em menos de 8h',underEight,'critical','prioridade imediata'),
    summaryCard('Risco de material',summary.materialRisks,'critical','matéria-prima limita a OP')
  ].join('');
}

function renderFilters() {
  const lines=snapshot?.lines || [];
  if(selectedLine!=='all'&&!lines.some(line=>line.id===selectedLine))selectedLine='all';
  document.getElementById('prepLineFilters').innerHTML=[{ id:'all',name:'Todas as linhas' },...lines].map(line=>`<button type="button" data-line-filter="${escapeHtml(line.id)}" aria-pressed="${selectedLine===line.id}">${escapeHtml(line.name)}</button>`).join('');
}

function renderViewControls() {
  document.getElementById('prepViewMode').innerHTML=[
    { id:'map',label:'Mapa de cards' },
    { id:'cards',label:'Cards detalhados' }
  ].map(item=>`<button type="button" data-view-mode="${item.id}" aria-pressed="${viewMode===item.id}">${item.label}</button>`).join('');
  const machines=snapshot?.machines || [];
  const urgencies=machines.map(machine=>closureUrgency(machine,snapshot?.serverTime || new Date()));
  const occurrences=machines.filter(machine=>preparerMachineState(machine).code!=='producing').length;
  const options=[
    { id:'all',label:'Todas',count:machines.length },
    { id:'attention',label:'Até 16h',count:urgencies.filter(item=>['attention','critical'].includes(item.code)).length },
    { id:'critical',label:'Menos de 8h',count:urgencies.filter(item=>item.code==='critical').length },
    { id:'occurrence',label:'Ocorrências',count:occurrences }
  ];
  document.getElementById('prepAttentionFilters').innerHTML=options.map(item=>`<button type="button" data-attention-filter="${item.id}" aria-pressed="${attentionFilter===item.id}">${item.label}<span>${integer(item.count)}</span></button>`).join('');
}

function releaseMarkup(metrics) {
  if(!metrics.releases.length)return '<div class="prep-releases is-empty"><strong>Liberações do turno</strong><span>Nenhuma liberação prevista no saldo atual.</span></div>';
  return `<div class="prep-releases"><strong>Liberações do turno</strong>${metrics.releases.map((release,index)=>`<div><b>${index===0?'PRÓXIMA':`${index+1}ª`}</b><span>${index===0?'A próxima liberação':`A ${index+1}ª liberação`} será feita com <strong>${integer(release.turnPiece)} peças produzidas neste turno</strong>.<small>Medição ${integer(release.measurementNumber)} de ${integer(release.totalMeasurements)} · ${escapeHtml(release.frequencyLabel)}</small></span></div>`).join('')}</div>`;
}

function forecastMarkup(machine) {
  const copy=closureCopy(machine);const forecast=machine.forecast || {};const urgency=closureUrgency(machine,snapshot?.serverTime || new Date());
  if(copy.reason==='none')return `<div class="prep-forecast" data-reason="none"><span>PREVISÃO DE FECHAMENTO</span><strong>${escapeHtml(copy.primary)}</strong></div>`;
  return `<div class="prep-forecast" data-reason="${copy.reason}" data-urgency="${urgency.code}"><div class="prep-forecast-heading"><span>PREVISÃO DE FECHAMENTO</span><b>◷ ${escapeHtml(urgency.label)}</b></div><time>${escapeHtml(dateTime(forecast.estimatedAt))}</time><strong>${escapeHtml(copy.primary)}</strong>${copy.secondary?`<small>${escapeHtml(copy.secondary)} <b>${escapeHtml(dateTime(forecast.materialEstimatedAt))}</b></small>`:''}<em>Estimativa considerando produção contínua e sem nova parada.</em></div>`;
}

function machineCard(machine) {
  const order=machine.activeOrder;const state=preparerMachineState(machine);const metrics=calculatePreparerMetrics(machine);
  const operator=machine.assignedOperator;const turn=machine.turnState || {};const runtime=machine.runtimeState || {};const metadata=mapMachineMetadata(machine.machineId);
  return `<article class="prep-machine" data-tone="${state.tone}" data-machine-id="${escapeHtml(machine.machineId)}">
    <header><div><p>${escapeHtml(machine.lineName)}</p><h2>${escapeHtml(machine.machineName)}</h2></div><span>${escapeHtml(state.label)}</span></header>
    <section class="prep-operator"><span>Operador responsável</span><strong>${escapeHtml(operator?.name || 'Ainda não atribuído')}</strong><small>${operator?.registration?`Matrícula ${escapeHtml(operator.registration)}`:'Nenhuma atribuição neste turno'}</small></section>
    ${order?`<section class="prep-order"><div><span>OP ativa</span><strong>${escapeHtml(order.op)}</strong></div><div><span>Item</span><strong>${escapeHtml(order.item || '—')}</strong></div><p>${escapeHtml(order.description || 'Sem descrição informada')}</p></section>
      <section class="prep-metrics"><div><span>Produção da OP</span><strong>${integer(order.producedSoFar)} / ${integer(order.opTarget)}</strong></div><div><span>Falta produzir</span><strong>${integer(machine.forecast?.opRemaining)} peças</strong></div><div><span>Meta no saldo do turno</span><strong>${integer(metrics.shiftTarget)} peças</strong></div><div><span>Tempo de ciclo</span><strong>${escapeHtml(formatCycle(order.cycleSeconds))}</strong></div><div><span>Material disponível</span><strong>${integer(machine.forecast?.availablePieces)} peças</strong></div><div><span>Produzido neste turno</span><strong>${integer(turn.goodPieces)} peças</strong></div></section>
      <section class="prep-clock"><div><span>Relógio lógico usado</span><strong>${duration(machine.turnClock?.usedMinutes)}</strong></div><div><span>Saldo do turno</span><strong>${duration(metrics.remainingMinutes)}</strong></div><small>Paradas informadas: ${duration(turn.stopMinutes)} · Refugos: ${integer(turn.rejects)}</small></section>
      ${forecastMarkup(machine)}${releaseMarkup(metrics)}`:`<section class="prep-no-order"><strong>Nenhuma OP ativa</strong><span>A máquina permanece visível para o preparador, sem dados de produção para calcular.</span></section>`}
    <section class="prep-machine-record"><span>REGISTRO TÉCNICO · WORK CENTER</span><strong>${escapeHtml(metadata.workcenter || 'Não informado')}</strong><small>${metadata.provisional?'Posição provisória no mapa; será ajustada após validação física.':'Classificação homologada usada somente como observação.'}</small></section>
    <footer><span>${runtime.reason?`Situação: ${escapeHtml(runtime.reason)}${runtime.note?` · ${escapeHtml(runtime.note)}`:''}`:'Sem ocorrência física informada'}</span><time>Último apontamento: ${escapeHtml(dateTime(turn.lastPointingAt))}</time></footer>
  </article>`;
}

function closureRemainingLabel(minutes) {
  if(minutes===null||minutes===undefined)return 'Sem previsão calculada';
  const total=Math.max(0,Math.round(Number(minutes)||0));const hours=Math.floor(total/60);const rest=total%60;
  if(!hours)return `${rest}min restantes`;
  return `${hours}h${rest?` ${String(rest).padStart(2,'0')}min`:''} restantes`;
}

function matchesSecondaryFilters(machine) {
  const term=search.trim().toLocaleLowerCase('pt-BR');
  if(term&&![machine.machineName,machine.lineName,machine.activeOrder?.op,machine.activeOrder?.item,machine.assignedOperator?.name,machine.assignedOperator?.registration].some(value=>String(value || '').toLocaleLowerCase('pt-BR').includes(term)))return false;
  const urgency=closureUrgency(machine,snapshot?.serverTime || new Date());
  if(attentionFilter==='attention'&&!['attention','critical'].includes(urgency.code))return false;
  if(attentionFilter==='critical'&&urgency.code!=='critical')return false;
  if(attentionFilter==='occurrence'&&preparerMachineState(machine).code==='producing')return false;
  return true;
}

function visibleMachines({ ignoreLine=false } = {}) {
  return (snapshot?.machines || []).filter(machine=>(ignoreLine||selectedLine==='all'||machine.lineId===selectedLine)&&matchesSecondaryFilters(machine));
}

function mapMachineCard(machine,neighbor=false) {
  const order=machine.activeOrder;const state=preparerMachineState(machine);const urgency=closureUrgency(machine,snapshot?.serverTime || new Date());const metadata=mapMachineMetadata(machine.machineId);
  const produced=Math.max(0,Number(order?.producedSoFar)||0);const target=Math.max(0,Number(order?.opTarget)||0);const progress=target?Math.min(100,Math.max(0,produced/target*100)):0;
  return `<button type="button" class="prep-map-machine${neighbor?' is-neighbor':''}" data-map-machine="${escapeHtml(machine.machineId)}" data-status="${state.code}" data-urgency="${urgency.code}" aria-label="Abrir detalhes da ${escapeHtml(machine.machineName)}">
    <header><div><small>${escapeHtml(machine.lineName)}</small><strong>${escapeHtml(machine.machineName)}</strong></div><span class="prep-map-status" data-tone="${state.tone}"><i></i>${escapeHtml(state.label)}</span></header>
    <div class="prep-map-operator"><span>Operador</span><strong>${escapeHtml(machine.assignedOperator?.name || 'Não atribuído')}</strong></div>
    ${order?`<div class="prep-map-order"><span><small>OP</small><strong>${escapeHtml(order.op)}</strong></span><span><small>ITEM</small><strong>${escapeHtml(order.item || '—')}</strong></span></div><div class="prep-map-progress"><div><i style="width:${progress.toFixed(2)}%"></i></div><span><strong>${integer(produced)}</strong> de ${integer(target)} peças</span></div>`:'<div class="prep-map-no-order"><strong>Sem OP ativa</strong><span>Aguardando programação</span></div>'}
    <footer data-urgency="${urgency.code}"><div><span aria-hidden="true">◷</span><small>FECHAMENTO</small></div><time>${escapeHtml(urgency.estimatedAt?dateTime(urgency.estimatedAt):'Sem previsão')}</time><strong>${escapeHtml(closureRemainingLabel(urgency.remainingMinutes))}</strong></footer>
    ${metadata.provisional?'<em class="prep-map-provisional">POSIÇÃO PROVISÓRIA</em>':''}
  </button>`;
}

function renderMap(content) {
  const selectedMachines=visibleMachines();
  if(!selectedMachines.length){content.innerHTML='<div class="prep-empty"><strong>Nenhuma máquina encontrada</strong><p>Altere a linha, o filtro de atenção ou a busca.</p></div>';return;}
  const selectedZoneIds=new Set(selectedMachines.map(machine=>mapMachineMetadata(machine.machineId).placement?.zoneId).filter(Boolean));
  const pool=selectedLine==='all'?selectedMachines:visibleMachines({ ignoreLine:true }).filter(machine=>selectedZoneIds.has(mapMachineMetadata(machine.machineId).placement?.zoneId));
  const byId=new Map(pool.map(machine=>[normalizeMapMachineId(machine.machineId),machine]));
  const zones=FACTORY_MAP_ZONES.filter(zone=>selectedLine==='all'||selectedZoneIds.has(zone.id)).map(zone=>{
    const cards=zone.rows.flat().map(machineId=>{
      if(!machineId)return '<span class="prep-map-slot-empty" aria-hidden="true"></span>';
      const machine=byId.get(machineId);
      if(!machine)return '<span class="prep-map-slot-empty" aria-hidden="true"></span>';
      return mapMachineCard(machine,selectedLine!=='all'&&machine.lineId!==selectedLine);
    }).join('');
    const count=zone.rows.flat().filter(machineId=>machineId&&byId.has(machineId)).length;
    if(!count)return '';
    return `<section class="prep-map-zone"><header><div><p>BLOCO OPERACIONAL</p><h1>${escapeHtml(zone.title)}</h1><span>${escapeHtml(zone.description)}</span></div><b>${integer(count)} visíveis</b></header><div class="prep-map-grid" style="--map-columns:${zone.columns}">${cards}</div></section>`;
  }).join('');
  const unplaced=selectedMachines.filter(machine=>!mapMachineMetadata(machine.machineId).placement);
  const lineName=selectedLine==='all'?'Mapa geral':snapshot?.lines?.find(line=>line.id===selectedLine)?.name || 'Linha selecionada';
  content.innerHTML=`<section class="prep-map-shell"><header class="prep-map-intro"><div><p>VISÃO ESPACIAL EM CARDS</p><h1>${escapeHtml(lineName)}</h1><span>${selectedLine==='all'?'Todos os blocos autorizados em posição relativa.':'A linha está em destaque; máquinas vizinhas aparecem apagadas como referência física.'}</span></div><div class="prep-map-legend"><span><i data-kind="status"></i>Status da máquina</span><span data-urgency="attention">◷ Até 16h</span><span data-urgency="critical">◷ Menos de 8h</span></div></header>${zones}${unplaced.length?`<section class="prep-map-zone prep-map-zone--unplaced"><header><div><p>CADASTRO PENDENTE</p><h1>Sem posição definida</h1><span>Continuam disponíveis sem comprometer o mapa.</span></div></header><div class="prep-map-unplaced">${unplaced.map(machine=>mapMachineCard(machine)).join('')}</div></section>`:''}</section>`;
}

function renderDetailedMachines(content) {
  const machines=visibleMachines();
  if(!machines.length){content.innerHTML='<div class="prep-empty"><strong>Nenhuma máquina encontrada</strong><p>Altere a linha, o filtro de atenção ou a busca.</p></div>';return;}
  const groups=new Map();for(const machine of machines){if(!groups.has(machine.lineId))groups.set(machine.lineId,{ name:machine.lineName,machines:[] });groups.get(machine.lineId).machines.push(machine);}
  content.innerHTML=[...groups.values()].map(group=>`<section class="prep-line"><header><div><p>LINHA AUTORIZADA</p><h1>${escapeHtml(group.name)}</h1></div><span>${group.machines.length} máquina${group.machines.length===1?'':'s'}</span></header><div class="prep-machine-grid">${group.machines.map(machineCard).join('')}</div></section>`).join('');
}

function renderMachines() {
  const content=document.getElementById('prepContent');
  if(!(snapshot?.lines || []).length){content.innerHTML='<div class="prep-empty"><strong>Nenhuma linha vinculada ao seu usuário</strong><p>Peça ao administrador para liberar as linhas necessárias. O painel nunca mostra máquinas fora da autorização.</p></div>';return;}
  if(viewMode==='map')renderMap(content);else renderDetailedMachines(content);
}

function openMachineDetail(machineId) {
  const id=normalizeMapMachineId(machineId);const machine=(snapshot?.machines || []).find(item=>normalizeMapMachineId(item.machineId)===id);if(!machine)return;
  const layer=document.getElementById('prepDetailLayer');const content=document.getElementById('prepDetailContent');
  content.innerHTML=`<header class="prep-detail-heading"><div><p>DETALHES DA MÁQUINA</p><h1 id="prepDetailTitle">${escapeHtml(machine.machineName)}</h1></div><button type="button" data-detail-close aria-label="Fechar detalhes">×</button></header>${machineCard(machine)}`;
  layer.classList.add('is-open');layer.setAttribute('aria-hidden','false');document.body.classList.add('prep-detail-open');
  content.querySelector('[data-detail-close]')?.focus();
}

function closeMachineDetail() {
  const layer=document.getElementById('prepDetailLayer');if(!layer)return;
  layer.classList.remove('is-open');layer.setAttribute('aria-hidden','true');document.body.classList.remove('prep-detail-open');
}

function renderSnapshot() {
  renderSummary();renderFilters();renderViewControls();renderMachines();
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
    const line=event.target.closest('[data-line-filter]');if(line){selectedLine=line.dataset.lineFilter;closeMachineDetail();renderFilters();renderMachines();return;}
    const mode=event.target.closest('[data-view-mode]');if(mode){viewMode=mode.dataset.viewMode;closeMachineDetail();renderViewControls();renderMachines();return;}
    const attention=event.target.closest('[data-attention-filter]');if(attention){attentionFilter=attention.dataset.attentionFilter;closeMachineDetail();renderViewControls();renderMachines();return;}
    const machine=event.target.closest('[data-map-machine]');if(machine){openMachineDetail(machine.dataset.mapMachine);return;}
    if(event.target.closest('[data-detail-close]')){closeMachineDetail();return;}
    if(event.target.closest('#prepRefresh'))refreshDashboard();
  });
  app.addEventListener('input',event=>{if(event.target.id==='prepSearch'){search=event.target.value;renderMachines();}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMachineDetail();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshDashboard();});
  window.addEventListener('online',refreshDashboard);
  refreshTimer=window.setInterval(refreshDashboard,REFRESH_INTERVAL_MS);
}

export function startPreparerDashboard() {
  baseLayout();bindEvents();refreshDashboard();
  window.NEOMES_PREPARER_DASHBOARD={ refresh:refreshDashboard,destroy(){window.clearInterval(refreshTimer);} };
}

startPreparerDashboard();
