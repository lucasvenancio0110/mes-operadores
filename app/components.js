import {
  store, getMachine, currentMachineSession, calculateSession, deriveAlerts,
  formatNumber, formatCycle, formatDate, formatClock
} from './core.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

const paths = {
  overview:'<path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/>',
  machines:'<path d="M4 5h16v14H4V5Zm3 3v3h4V8H7Zm7 0v8h3V8h-3ZM7 14v2h4v-2H7Z"/>',
  andon:'<path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"/>',
  alerts:'<path d="M12 3 2.8 19h18.4L12 3Zm0 5v5m0 3v.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  more:'<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  search:'<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  plus:'<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sync:'<path d="M20 7h-5V2m-11 15h5v5M19 12a7 7 0 0 0-12-5L5 9m0 3a7 7 0 0 0 12 5l2-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  chevron:'<path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  clock:'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  check:'<path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  logout:'<path d="M10 4H5v16h5m4-4 4-4-4-4m4 4H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
};

export function icon(name, label = '') {
  return `<svg viewBox="0 0 24 24" aria-hidden="${label ? 'false' : 'true'}"${label ? ` aria-label="${escapeHtml(label)}" role="img"` : ''}>${paths[name] || paths.more}</svg>`;
}

export const STATUS = {
  pending:{ label:'Pendente', tone:'warning' },
  producing:{ label:'Produzindo', tone:'success' },
  setup:{ label:'Setup', tone:'info' },
  adjustment:{ label:'Ajuste', tone:'info' },
  stopped:{ label:'Parada', tone:'danger' },
  maintenance:{ label:'Manutenção', tone:'danger' },
  pointed:{ label:'Apontado', tone:'brand' },
  closed:{ label:'OP encerrada', tone:'neutral' }
};

export function statusMeta(status) {
  return STATUS[status] || STATUS.pending;
}

function sessionCounts(state) {
  const values = state.assignments.map(item => state.machineSessions[item.machineId]?.status || 'pending');
  return {
    producing:values.filter(value => value === 'producing').length,
    stopped:values.filter(value => ['stopped','maintenance'].includes(value)).length,
    setup:values.filter(value => ['setup','adjustment'].includes(value)).length,
    pending:values.filter(value => value === 'pending').length
  };
}

export function renderHeader(state) {
  const session = state.session;
  const syncState = !state.sync.online ? 'offline' : state.syncQueue.length ? 'pending' : state.sync.status;
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">NM</div>
        <div class="brand-copy"><div class="brand-name">NEODENT MES</div><div class="brand-subtitle">Manufacturing Execution System</div></div>
      </div>
      <div class="header-actions">
        <button class="shift-chip" id="headerShift" type="button" aria-label="Alterar turno">${escapeHtml(session?.shift || '—')}º turno</button>
        <button class="sync-chip" id="headerSync" type="button" data-state="${escapeHtml(syncState)}" aria-label="Status da sincronização"></button>
        <button class="icon-button" id="headerMenu" type="button" aria-label="Abrir menu">${icon('menu')}</button>
      </div>
    </header>`;
}

export function renderConnection(state) {
  const localOnly = !window.location.origin || window.location.hostname.endsWith('github.io');
  let message = '<strong>Dados sincronizados</strong><span> · Cloudflare conectado</span>';
  let status = 'synced';
  if (localOnly) { message = '<strong>Modo local</strong><span> · abra a versão Cloudflare para compartilhar entre aparelhos</span>'; status = 'offline'; }
  else if (!state.sync.online) { message = '<strong>Sem conexão</strong><span> · os apontamentos serão enviados quando a internet voltar</span>'; status = 'offline'; }
  else if (state.syncQueue.length) { message = `<strong>${state.syncQueue.length} pendência${state.syncQueue.length === 1 ? '' : 's'}</strong><span> · aguardando sincronização</span>`; status = 'pending'; }
  else if (state.sync.status === 'error') { message = `<strong>Falha na sincronização</strong><span> · ${escapeHtml(state.sync.error || 'tente novamente')}</span>`; status = 'error'; }
  return `<div class="connection-banner" data-state="${status}"><div>${message}</div><button type="button" data-action="sync">Sincronizar</button></div>`;
}

export function renderSessionStrip(state) {
  const session = state.session;
  if (!session) return '';
  const counts = sessionCounts(state);
  const initials = session.name.split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase();
  return `<section class="session-strip" aria-label="Resumo da sessão do turno">
    <div class="session-person"><div class="avatar">${escapeHtml(initials)}</div><div><strong>${escapeHtml(session.name)}</strong><span>Matrícula ${escapeHtml(session.registration)} · ${escapeHtml(session.shift)}º turno · ${formatDate(session.productionDate)}</span></div></div>
    <div class="session-counts">
      <div class="mini-stat"><strong>${state.assignments.length}</strong><span>Máquinas</span></div>
      <div class="mini-stat"><strong>${counts.producing}</strong><span>Produzindo</span></div>
      <div class="mini-stat"><strong>${counts.setup}</strong><span>Setup/Ajuste</span></div>
      <div class="mini-stat"><strong>${counts.stopped + counts.pending}</strong><span>Atenção</span></div>
    </div>
  </section>`;
}

export function renderMachineRail(state) {
  const alerts = deriveAlerts();
  if (!state.assignments.length) return `<div class="machine-rail"><button class="machine-pill add-machine-pill" type="button" data-action="assign-machines"><span>＋</span><strong>Selecionar máquinas</strong></button></div>`;
  const cards = state.assignments.map(item => {
    const machine = getMachine(item.machineId);
    const session = currentMachineSession(item.machineId);
    const status = session?.status || 'pending';
    const progress = calculateSession(session).progress;
    const count = alerts.filter(alert => alert.machineId === item.machineId && !state.acknowledgements[alert.id]).length;
    return `<button class="machine-pill" type="button" data-machine-id="${escapeHtml(item.machineId)}" aria-current="${state.activeMachineId === item.machineId}">
      <div class="machine-pill-top"><strong>${escapeHtml(machine?.name || item.machineId)}</strong><span class="status-dot" data-status="${escapeHtml(status)}" aria-label="${escapeHtml(statusMeta(status).label)}"></span></div>
      <small>${escapeHtml(machine?.lineName || '')} · ${escapeHtml(statusMeta(status).label)}</small>
      <div class="machine-pill-progress" aria-label="Progresso ${formatNumber(progress)}%"><span style="width:${Math.min(progress,100)}%"></span></div>
      ${count ? `<span class="machine-pill-alert" aria-label="${count} alertas">${count}</span>` : ''}
    </button>`;
  }).join('');
  return `<div class="machine-rail">${cards}<button class="machine-pill add-machine-pill" type="button" data-action="assign-machines"><span>＋</span><strong>Adicionar</strong></button></div>`;
}

export function emptyState(title, detail, action = '', actionLabel = '') {
  return `<section class="empty-state"><div><div class="empty-icon">＋</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p>${action ? `<button class="btn btn-primary" type="button" data-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>` : ''}</div></section>`;
}

function machineAlert(session, machineId, state) {
  const alert = deriveAlerts().find(item => item.machineId === machineId && !state.acknowledgements[item.id]);
  if (!alert) return '';
  return `<div class="alert-inline"><span aria-hidden="true">⚠</span><div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.detail)}</span></div></div>`;
}

export function renderOverview(state) {
  if (!state.assignments.length) return emptyState('Nenhuma máquina vinculada','Selecione as máquinas que estão sob sua responsabilidade neste turno.','assign-machines','Selecionar máquinas');
  const machine = getMachine(state.activeMachineId) || getMachine(state.assignments[0].machineId);
  const session = currentMachineSession(machine?.id);
  if (!machine) return emptyState('Máquina não encontrada','Atualize o catálogo ou selecione outra máquina.','assign-machines','Trocar máquinas');
  if (!session) return `<div class="dashboard-grid"><section class="card machine-hero">
    <div class="machine-hero-header"><div><div class="machine-title">${escapeHtml(machine.name)}</div><div class="machine-meta">${escapeHtml(machine.lineName)} · aguardando conferência</div></div><span class="status-badge" data-status="pending">Pendente</span></div>
    <div class="hero-body">${emptyState('Conferência inicial pendente','Confirme a OP, o item, o ciclo e o status inicial para começar o acompanhamento.','open-conference','Fazer conferência inicial')}</div>
  </section><aside class="secondary-column"><section class="card more-card"><h2>Próximo passo</h2><p class="subtle">A conferência cria a meta do período restante e permite a passagem automática entre turnos.</p></section></aside></div>`;

  const calc = calculateSession(session);
  const status = session.status || 'producing';
  const statusLabel = statusMeta(status).label;
  const produced = Number(session.producedThisShift || 0);
  const total = Number(session.producedSoFar || 0) + produced;
  const potential = Number(session.bars || 0) * Number(session.piecesPerBar || 0);
  const autonomyMinutes = session.piecesPerBar > 0 && session.cycleSeconds > 0 ? potential * session.cycleSeconds / 60 : NaN;
  return `<div class="dashboard-grid">
    <section class="card machine-hero">
      <div class="machine-hero-header"><div><div class="machine-title">${escapeHtml(machine.name)}</div><div class="machine-meta">${escapeHtml(machine.lineName)} · atualizada ${formatClock(session.updatedAt || session.checkedAt)}</div></div><span class="status-badge" data-status="${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></div>
      <div class="hero-body">
        <div class="order-line"><div><strong>OP ${escapeHtml(session.op || 'não informada')}</strong><span>Item ${escapeHtml(session.item || 'não informado')}${session.description ? ` · ${escapeHtml(session.description)}` : ''}</span></div><button class="icon-button" type="button" data-action="open-conference" aria-label="Editar conferência">⋮</button></div>
        <div class="progress-block">
          <div class="progress-top"><div class="progress-main"><span>Peças produzidas neste turno</span><strong>${formatNumber(produced)}</strong></div><div class="progress-percent">${formatNumber(calc.progress)}%</div></div>
          <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(calc.progress)}"><span style="width:${Math.min(calc.progress,100)}%"></span></div>
          <div class="progress-foot"><span>Meta ${formatNumber(calc.target,1)}</span><span>Faltam ${formatNumber(calc.remaining,1)}</span></div>
        </div>
        <div class="metrics-grid">
          <div class="metric"><span>Produzidas até agora</span><strong>${formatNumber(total)}</strong></div>
          <div class="metric"><span>Previsão ao final</span><strong>${formatNumber(calc.expectedTotal,1)}</strong></div>
          <div class="metric"><span>Ciclo padrão</span><strong>${formatCycle(session.cycleSeconds)}</strong></div>
          <div class="metric"><span>Tempo restante</span><strong>${formatNumber(session.availableMinutes)} min</strong></div>
          <div class="metric"><span>Medições I / II</span><strong>${formatNumber(calc.measurement1)} / ${formatNumber(calc.measurement2)}</strong></div>
          <div class="metric"><span>Matéria-prima</span><strong>${potential > 0 ? `${formatNumber(potential)} pç` : 'Não informada'}</strong></div>
          ${Number.isFinite(autonomyMinutes) ? `<div class="metric wide"><span>Autonomia estimada</span><strong>${formatNumber(autonomyMinutes / 60,1)} h</strong></div>` : ''}
        </div>
        ${machineAlert(session,machine.id,state)}
      </div>
      <div class="hero-actions"><button class="btn btn-secondary" type="button" data-action="open-conference">Editar conferência</button><button class="btn btn-primary" type="button" data-action="open-pointing">Confirmar apontamento</button></div>
    </section>
    <aside class="secondary-column">
      <section class="card more-card"><h2>Ordem atual</h2><div class="review-list"><div class="review-row"><span>OP</span><strong>${escapeHtml(session.op || '—')}</strong></div><div class="review-row"><span>Item</span><strong>${escapeHtml(session.item || '—')}</strong></div><div class="review-row"><span>Início</span><strong>${formatClock(session.checkedAt)}</strong></div><div class="review-row"><span>Status</span><strong>${escapeHtml(statusLabel)}</strong></div></div></section>
      <section class="card more-card"><h2>Ações rápidas</h2><div class="action-list"><button class="action-row" data-action="set-status"><div><strong>Atualizar status</strong><span>Produção, setup, ajuste ou parada</span></div>${icon('chevron')}</button><button class="action-row" data-action="close-order"><div><strong>Encerrar ordem</strong><span>Finalizar a OP e iniciar outra</span></div>${icon('chevron')}</button></div></section>
    </aside>
  </div>`;
}

export function renderMachines(state) {
  if (!state.assignments.length) return emptyState('Sem máquinas no turno','Adicione máquinas para acompanhar a produção.','assign-machines','Adicionar máquinas');
  const query = state.ui.machineSearch.toLowerCase();
  const filter = state.ui.machineFilter;
  const rows = state.assignments.map(item => {
    const machine = getMachine(item.machineId); const session = currentMachineSession(item.machineId); const status = session?.status || 'pending'; const calc = calculateSession(session);
    return { machine,session,status,calc };
  }).filter(item => (!query || `${item.machine?.name} ${item.session?.op || ''} ${item.session?.item || ''}`.toLowerCase().includes(query)) && (filter === 'all' || item.status === filter));
  return `<div class="toolbar"><label class="search-field">${icon('search')}<input id="machineSearch" type="search" value="${escapeHtml(state.ui.machineSearch)}" placeholder="Buscar máquina, OP ou item" aria-label="Buscar máquinas"></label><div class="filter-chips" aria-label="Filtrar por status">${['all','producing','pending','setup','stopped'].map(value => `<button class="filter-chip" type="button" data-machine-filter="${value}" aria-pressed="${filter === value}">${value === 'all' ? 'Todas' : statusMeta(value).label}</button>`).join('')}</div></div>
  <div class="machine-list">${rows.length ? rows.map(({machine,session,status,calc}) => `<button class="machine-row" type="button" data-machine-id="${escapeHtml(machine.id)}"><span class="status-dot" data-status="${escapeHtml(status)}"></span><span class="machine-row-main"><strong>${escapeHtml(machine.name)}</strong><span>${escapeHtml(machine.lineName)} · ${session?.op ? `OP ${escapeHtml(session.op)} · Item ${escapeHtml(session.item || '—')}` : 'Conferência pendente'}</span></span><span class="machine-row-metric"><strong>${session ? `${formatNumber(calc.progress)}%` : '—'}</strong><span>${escapeHtml(statusMeta(status).label)}</span></span></button>`).join('') : emptyState('Nenhuma máquina encontrada','Ajuste a busca ou remova o filtro.')}</div>`;
}

export function renderAndon(state) {
  if (!state.assignments.length) return emptyState('Andon sem máquinas','Selecione as máquinas do turno para montar o painel.','assign-machines','Selecionar máquinas');
  return `<div class="andon-grid">${state.assignments.map(item => {
    const machine = getMachine(item.machineId); const session = currentMachineSession(item.machineId); const status = session?.status || 'pending'; const calc = calculateSession(session); const updated = session?.updatedAt || session?.checkedAt;
    return `<article class="andon-card" data-status="${escapeHtml(status)}" data-machine-id="${escapeHtml(machine.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(machine.name)}">
      <div class="andon-head"><div><div class="andon-title">${escapeHtml(machine.name)}</div><div class="andon-op">${session?.op ? `OP ${escapeHtml(session.op)} · ${escapeHtml(session.item || '')}` : 'Sem OP conferida'}</div></div><span class="status-dot" data-status="${escapeHtml(status)}" title="${escapeHtml(statusMeta(status).label)}"></span></div>
      <div class="andon-metrics"><div><span>Produção</span><strong>${formatNumber(session?.producedThisShift || 0)}</strong></div><div><span>Meta</span><strong>${formatNumber(calc.target,1)}</strong></div><div><span>Ciclo</span><strong>${formatCycle(session?.cycleSeconds)}</strong></div></div>
      <div class="progress-track" style="margin-top:10px"><span style="width:${Math.min(calc.progress,100)}%"></span></div><div class="progress-foot"><span>${escapeHtml(statusMeta(status).label)}</span><span>${updated ? formatClock(updated) : 'Sem atualização'}</span></div>
    </article>`;
  }).join('')}</div>`;
}

export function renderAlerts(state) {
  const filter = state.ui.alertFilter;
  const all = deriveAlerts().filter(alert => !state.acknowledgements[alert.id]);
  const alerts = filter === 'all' ? all : all.filter(alert => alert.level === filter);
  return `<div class="filter-chips" style="margin-bottom:12px">${['all','attention','important','critical'].map(value => `<button class="filter-chip" type="button" data-alert-filter="${value}" aria-pressed="${filter === value}">${value === 'all' ? `Todos (${all.length})` : value === 'attention' ? 'Atenção' : value === 'important' ? 'Importante' : 'Crítico'}</button>`).join('')}</div>
  <div class="alert-list">${alerts.length ? alerts.map(alert => { const machine = getMachine(alert.machineId); return `<article class="alert-card" data-level="${escapeHtml(alert.level)}"><div class="alert-head"><div><span class="alert-level">${escapeHtml(alert.level)}</span><h3>${escapeHtml(alert.title)}</h3></div><strong class="mono">${escapeHtml(machine?.name || '')}</strong></div><p>${escapeHtml(alert.detail)}</p><div class="alert-actions"><button class="btn btn-secondary" type="button" data-machine-id="${escapeHtml(alert.machineId)}">Ver máquina</button><button class="btn btn-ghost" type="button" data-ack-alert="${escapeHtml(alert.id)}">Reconhecer</button></div></article>`; }).join('') : emptyState('Nenhum alerta pendente','As máquinas selecionadas não possuem situações que exijam atenção agora.')}</div>`;
}

function timelineRecords(state) {
  return [...state.records].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,30);
}

export function renderMore(state) {
  const records = timelineRecords(state);
  const session = state.session;
  return `<div class="more-grid">
    <section class="card more-card"><h2>Sessão</h2><div class="review-list"><div class="review-row"><span>Operador</span><strong>${escapeHtml(session?.name || '—')}</strong></div><div class="review-row"><span>Matrícula</span><strong>${escapeHtml(session?.registration || '—')}</strong></div><div class="review-row"><span>Turno</span><strong>${escapeHtml(session?.shift || '—')}º</strong></div><div class="review-row"><span>Início</span><strong>${formatClock(session?.startedAt)}</strong></div></div></section>
    <section class="card more-card"><h2>Ferramentas</h2><div class="action-list"><button class="action-row" data-action="sync"><div><strong>Sincronizar agora</strong><span>${state.syncQueue.length ? `${state.syncQueue.length} pendências` : 'Dados atualizados'}</span></div>${icon('sync')}</button><button class="action-row" data-action="copy-summary"><div><strong>Copiar resumo do turno</strong><span>Texto pronto para WhatsApp</span></div>${icon('download')}</button><button class="action-row" data-action="export-csv"><div><strong>Exportar CSV</strong><span>Registros de produção</span></div>${icon('download')}</button><button class="action-row" data-action="install-app"><div><strong>Instalar aplicativo</strong><span>Adicionar à tela inicial</span></div>${icon('download')}</button><button class="action-row" data-action="logout"><div><strong style="color:var(--color-danger)">Sair</strong><span>Trocar operador neste aparelho</span></div>${icon('logout')}</button></div></section>
    <section class="card more-card history-card"><h2>Linha do tempo</h2><div class="timeline">${records.length ? records.map(record => `<article class="timeline-item"><time class="timeline-time">${formatClock(record.createdAt)}</time><span class="timeline-marker"></span><div class="timeline-content"><strong>${escapeHtml(record.machineName || '')} · OP ${escapeHtml(record.op || '')}</strong><span>${record.eventType === 'order-close' ? 'Ordem encerrada' : 'Apontamento confirmado'} · ${formatNumber(record.producedThisShift ?? record.finalProduction)} peças · ${escapeHtml(record.operatorName || '')}</span></div></article>`).join('') : '<p class="subtle">Nenhum evento registrado ainda.</p>'}</div></section>
  </div>`;
}

export function renderNavigation(route) {
  const items = [
    ['overview','overview','Visão geral'],['machines','machines','Máquinas'],['andon','andon','Andon'],['alerts','alerts','Alertas'],['more','more','Mais']
  ];
  const buttons = items.map(([value,iconName,label]) => `<button class="nav-button" type="button" data-route="${value}" aria-current="${route === value ? 'page' : 'false'}">${icon(iconName)}<span>${label}</span></button>`).join('');
  return `<nav class="bottom-nav" aria-label="Navegação principal">${buttons}</nav><aside class="desktop-sidebar" aria-label="Navegação principal"><div class="desktop-logo">NM</div>${buttons}</aside>`;
}
