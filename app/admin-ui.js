const auth = window.NEOMES_AUTH;
const canAdmin = auth && !auth.offline && (auth.user.roleCode === 'admin' || (auth.user.permissions || []).includes('users.view'));
let adminRoot = null;
let adminState = { tab:'users', users:[], roles:[], sessions:[], logs:[], summary:{}, catalog:[], search:'', role:'', status:'' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path,{ credentials:'same-origin', ...options, headers:{ Accept:'application/json', ...(options.body?{'Content-Type':'application/json'}:{}), ...(options.headers||{}) } });
  const payload = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error || `Erro ${response.status}`);
  return payload;
}

function roleLabel(code) {
  return ({ admin:'Administrador',leadership:'Liderança',preparator:'Preparador',operator:'Operador',technical:'Técnico' })[code] || code;
}

function statusLabel(status) {
  return ({ active:'Ativo',inactive:'Inativo',blocked:'Bloqueado',pending:'Pendente' })[status] || status;
}

function toast(message,tone='success') {
  let region=document.querySelector('.admin-toast-region');
  if(!region){region=document.createElement('div');region.className='admin-toast-region';document.body.appendChild(region);}
  region.innerHTML=`<div class="admin-toast" data-tone="${tone}" role="status">${escapeHtml(message)}</div>`;
  setTimeout(()=>{region.innerHTML='';},3200);
}

function injectEntries() {
  if(!canAdmin)return;
  document.querySelectorAll('.action-list').forEach(list=>{
    if(list.querySelector('[data-admin-entry]'))return;
    const button=document.createElement('button');
    button.type='button';button.className='action-row admin-entry';button.dataset.adminEntry='true';
    button.innerHTML='<div><strong>Administração</strong><span>Usuários, acessos, sessões e auditoria</span></div><span aria-hidden="true">›</span>';
    list.prepend(button);
  });
}

function frame(content) {
  return `<section class="admin-panel" role="dialog" aria-modal="true" aria-label="Administração do NEOMES">
    <header class="admin-topbar"><div><p>NEOMES</p><h1>Administração</h1></div><button type="button" data-admin-close aria-label="Fechar">×</button></header>
    <nav class="admin-tabs" aria-label="Seções administrativas">
      ${[['users','Usuários'],['roles','Perfis'],['sessions','Sessões'],['audit','Auditoria']].map(([id,label])=>`<button type="button" data-admin-tab="${id}" aria-current="${adminState.tab===id?'page':'false'}">${label}</button>`).join('')}
    </nav>
    <div class="admin-content">${content}</div>
  </section>`;
}

function loading() { return '<div class="admin-loading" role="status"><span></span><strong>Carregando dados…</strong></div>'; }
function empty(title,text) { return `<div class="admin-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`; }

function renderSummary() {
  const summary=adminState.summary||{};
  return `<div class="admin-summary">
    <div><span>Usuários ativos</span><strong>${Number(summary.activeUsers||0)}</strong></div>
    <div><span>Bloqueados</span><strong>${Number(summary.blockedUsers||0)}</strong></div>
    <div><span>Pendentes</span><strong>${Number(summary.pendingUsers||0)}</strong></div>
    <div><span>Sessões ativas</span><strong>${Number(summary.activeSessions||0)}</strong></div>
  </div>`;
}

function filteredUsers() {
  const term=adminState.search.toLowerCase();
  return adminState.users.filter(user=>(!term||user.name.toLowerCase().includes(term)||String(user.registration).includes(term))&&(!adminState.role||user.roleCode===adminState.role)&&(!adminState.status||user.status===adminState.status));
}

function userCard(user) {
  return `<article class="admin-user" data-status="${escapeHtml(user.status)}">
    <div class="admin-user__main"><span class="admin-avatar">${escapeHtml(user.name.slice(0,2).toUpperCase())}</span><div><strong>${escapeHtml(user.name)}</strong><small>Matrícula ${escapeHtml(user.registration)} · ${escapeHtml(roleLabel(user.roleCode))}</small></div></div>
    <div class="admin-user__meta"><span data-tone="${user.status}">${escapeHtml(statusLabel(user.status))}</span>${user.mustChangePassword?'<span data-tone="temporary">Senha temporária</span>':''}</div>
    <dl><div><dt>Turno</dt><dd>${escapeHtml(user.defaultShift)}º</dd></div><div><dt>Último acesso</dt><dd>${user.lastLoginAt?new Date(user.lastLoginAt).toLocaleString('pt-BR'):'Nunca'}</dd></div><div><dt>Linhas</dt><dd>${user.lineAccess?.length?escapeHtml(user.lineAccess.join(', ')):'Todas conforme perfil'}</dd></div></dl>
    <footer><button type="button" data-admin-edit-user="${escapeHtml(user.id)}">Editar</button><button type="button" data-admin-user-menu="${escapeHtml(user.id)}">Ações</button></footer>
  </article>`;
}

function usersView() {
  const users=filteredUsers();
  return `${renderSummary()}
    <div class="admin-toolbar"><label class="admin-search"><span>Buscar</span><input type="search" data-admin-search placeholder="Nome ou matrícula" value="${escapeHtml(adminState.search)}"></label><button class="admin-primary" type="button" data-admin-create-user>＋ Novo usuário</button></div>
    <div class="admin-filters"><select data-admin-role-filter><option value="">Todos os perfis</option>${adminState.roles.map(role=>`<option value="${escapeHtml(role.code)}" ${adminState.role===role.code?'selected':''}>${escapeHtml(role.name)}</option>`).join('')}</select><select data-admin-status-filter><option value="">Todos os status</option>${['active','pending','blocked','inactive'].map(status=>`<option value="${status}" ${adminState.status===status?'selected':''}>${statusLabel(status)}</option>`).join('')}</select></div>
    <div class="admin-users">${users.length?users.map(userCard).join(''):empty('Nenhum usuário encontrado','Revise os filtros ou cadastre uma nova pessoa.')}</div>`;
}

function rolesView() {
  return `<header class="admin-section-head"><div><p>CONTROLE DE ACESSO</p><h2>Perfis e permissões</h2></div></header><div class="admin-role-grid">${adminState.roles.map(role=>`<article class="admin-role"><header><strong>${escapeHtml(role.name)}</strong><span>${role.permissions.length} permissões</span></header><p>${escapeHtml(role.description)}</p><div>${role.permissions.map(permission=>`<span>${escapeHtml(permission)}</span>`).join('')}</div></article>`).join('')}</div>`;
}

function sessionsView() {
  return `<header class="admin-section-head"><div><p>SEGURANÇA</p><h2>Sessões ativas</h2></div><button class="admin-secondary" type="button" data-admin-refresh>Atualizar</button></header><div class="admin-list">${adminState.sessions.length?adminState.sessions.map(session=>`<article class="admin-session"><div><strong>${escapeHtml(session.name)}</strong><span>Matrícula ${escapeHtml(session.registration)} · ${escapeHtml(session.deviceName||'Dispositivo')}</span><small>Última atividade: ${new Date(session.lastActivityAt).toLocaleString('pt-BR')}</small></div><button type="button" data-admin-revoke-session="${escapeHtml(session.id)}">Encerrar</button></article>`).join(''):empty('Nenhuma sessão ativa','As sessões conectadas aparecerão aqui.')}</div>`;
}

function auditView() {
  return `<header class="admin-section-head"><div><p>RASTREABILIDADE</p><h2>Auditoria</h2></div><button class="admin-secondary" type="button" data-admin-refresh>Atualizar</button></header><div class="admin-list">${adminState.logs.length?adminState.logs.map(log=>`<article class="admin-log"><time>${new Date(log.createdAt).toLocaleString('pt-BR')}</time><strong>${escapeHtml(log.userName||'Sistema')} · ${escapeHtml(log.action)}</strong><p>${escapeHtml(log.description||'Ação registrada.')}</p>${log.ipAddress?`<small>IP ${escapeHtml(log.ipAddress)}</small>`:''}</article>`).join(''):empty('Sem eventos de auditoria','As ações administrativas e acessos aparecerão aqui.')}</div>`;
}

function renderPanel() {
  if(!adminRoot)return;
  const content=adminState.tab==='users'?usersView():adminState.tab==='roles'?rolesView():adminState.tab==='sessions'?sessionsView():auditView();
  adminRoot.innerHTML=frame(content);
}

async function loadData(tab=adminState.tab) {
  adminState.tab=tab;
  if(adminRoot)adminRoot.innerHTML=frame(loading());
  try{
    const tasks=[api('/api/v1/admin/summary'),api('/api/v1/admin/roles')];
    if(tab==='users')tasks.push(api('/api/v1/admin/users'));
    if(tab==='sessions')tasks.push(api('/api/v1/admin/sessions'));
    if(tab==='audit')tasks.push(api('/api/v1/admin/audit'));
    const results=await Promise.all(tasks);
    adminState.summary=results[0].summary||{};adminState.roles=results[1].roles||[];
    if(tab==='users')adminState.users=results[2].users||[];
    if(tab==='sessions')adminState.sessions=results[2].sessions||[];
    if(tab==='audit')adminState.logs=results[2].logs||[];
    if(!adminState.catalog.length){const catalog=await api('/api/v1/catalog');adminState.catalog=catalog.lines||[];}
    renderPanel();
  }catch(error){if(adminRoot)adminRoot.innerHTML=frame(`<div class="admin-error"><strong>Não foi possível carregar</strong><p>${escapeHtml(error.message)}</p></div>`);}
}

function openPanel() {
  if(!canAdmin)return;
  adminRoot=document.createElement('div');adminRoot.className='admin-layer';document.body.appendChild(adminRoot);document.body.classList.add('admin-open');
  loadData('users');
}
function closePanel(){adminRoot?.remove();adminRoot=null;document.body.classList.remove('admin-open');}

function accessFields(user={}) {
  const selected=new Set(user.lineAccess||[]);
  return `<fieldset class="admin-access"><legend>Linhas permitidas</legend><p>Sem seleção significa acesso conforme o perfil. Selecione para restringir.</p><div>${adminState.catalog.map(line=>`<label><input type="checkbox" name="lineAccess" value="${escapeHtml(line.id)}" ${selected.has(line.id)?'checked':''}><span>${escapeHtml(line.name)}</span></label>`).join('')}</div></fieldset>`;
}

function userForm(user=null) {
  const editing=Boolean(user);const role=user?.roleCode||'operator';const shift=user?.defaultShift||'1';
  return `<form class="admin-form" id="adminUserForm" data-user-id="${escapeHtml(user?.id||'')}">
    <label><span>Nome completo</span><input name="name" required value="${escapeHtml(user?.name||'')}"></label>
    <label><span>Matrícula</span><input name="registration" inputmode="numeric" required ${editing?'readonly':''} value="${escapeHtml(user?.registration||'')}"></label>
    <div class="admin-form-row"><label><span>Perfil</span><select name="roleCode">${adminState.roles.map(item=>`<option value="${escapeHtml(item.code)}" ${item.code===role?'selected':''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><label><span>Turno padrão</span><select name="defaultShift">${['1','2','3'].map(value=>`<option value="${value}" ${value===shift?'selected':''}>${value}º turno</option>`).join('')}</select></label></div>
    <label><span>E-mail (opcional)</span><input name="email" type="email" value="${escapeHtml(user?.email||'')}"></label>
    ${editing?`<label><span>Status</span><select name="status">${['active','pending','blocked','inactive'].map(status=>`<option value="${status}" ${user.status===status?'selected':''}>${statusLabel(status)}</option>`).join('')}</select></label>`:`<label><span>Senha inicial (opcional)</span><input name="password" type="password" autocomplete="new-password" placeholder="O sistema gera uma senha se ficar vazio"></label>`}
    ${accessFields(user)}
    <div class="admin-form-error" role="alert"></div>
    <footer><button type="button" class="admin-secondary" data-admin-modal-close>Cancelar</button><button type="submit" class="admin-primary">${editing?'Salvar alterações':'Criar usuário'}</button></footer>
  </form>`;
}

function openModal(title,content) {
  const modal=document.createElement('div');modal.className='admin-modal-layer';modal.innerHTML=`<section class="admin-modal" role="dialog" aria-modal="true"><header><h2>${escapeHtml(title)}</h2><button type="button" data-admin-modal-close>×</button></header><div>${content}</div></section>`;adminRoot.appendChild(modal);
}
function closeModal(){adminRoot?.querySelector('.admin-modal-layer')?.remove();}

function selectedAccess(form){return [...form.querySelectorAll('[name="lineAccess"]:checked')].map(input=>input.value);}

async function saveUser(form) {
  const id=form.dataset.userId;const data=Object.fromEntries(new FormData(form));data.lineAccess=selectedAccess(form);data.machineAccess=[];
  const error=form.querySelector('.admin-form-error');const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    const payload=await api(id?`/api/v1/admin/users/${encodeURIComponent(id)}`:'/api/v1/admin/users',{method:id?'PUT':'POST',body:JSON.stringify(data)});
    closeModal();await loadData('users');toast(id?'Usuário atualizado.':'Usuário criado.');
    if(payload.temporaryPassword)showTemporaryPassword(payload.temporaryPassword,payload.user);
  }catch(failure){error.textContent=failure.message;button.disabled=false;}
}

function showTemporaryPassword(password,user) {
  openModal('Senha temporária',`<div class="admin-temporary"><p>Entregue esta senha para <strong>${escapeHtml(user?.name||'o usuário')}</strong>. Ela será mostrada somente agora.</p><code>${escapeHtml(password)}</code><button class="admin-primary" type="button" data-copy-password="${escapeHtml(password)}">Copiar senha</button><small>O usuário será obrigado a criar uma nova senha no primeiro acesso.</small></div>`);
}

function openUserActions(user) {
  const status=user.status;
  openModal(`Ações · ${user.name}`,`<div class="admin-action-menu">
    <button type="button" data-admin-reset-password="${escapeHtml(user.id)}"><strong>Redefinir senha</strong><span>Gera senha temporária e encerra sessões</span></button>
    <button type="button" data-admin-revoke-user="${escapeHtml(user.id)}"><strong>Encerrar sessões</strong><span>Desconecta todos os dispositivos</span></button>
    ${status==='blocked'?`<button type="button" data-admin-user-action="unblock" data-user-id="${escapeHtml(user.id)}"><strong>Desbloquear conta</strong></button>`:`<button type="button" data-admin-user-action="block" data-user-id="${escapeHtml(user.id)}"><strong>Bloquear conta</strong></button>`}
    ${status==='inactive'?`<button type="button" data-admin-user-action="enable" data-user-id="${escapeHtml(user.id)}"><strong>Reativar conta</strong></button>`:`<button type="button" data-admin-user-action="disable" data-user-id="${escapeHtml(user.id)}"><strong>Desativar conta</strong></button>`}
  </div>`);
}

async function userAction(id,action) {
  const warnings={block:'A conta será bloqueada e suas sessões serão encerradas.',disable:'A conta será desativada e suas sessões serão encerradas.',unblock:'A conta será desbloqueada.',enable:'A conta será reativada.'};
  if(!window.confirm(warnings[action]||'Confirmar ação?'))return;
  try{await api(`/api/v1/admin/users/${encodeURIComponent(id)}/${action}`,{method:'POST'});closeModal();await loadData('users');toast('Ação concluída.');}catch(error){toast(error.message,'danger');}
}

async function resetPassword(id) {
  if(!window.confirm('A senha atual será invalidada e todas as sessões deste usuário serão encerradas.'))return;
  try{const payload=await api(`/api/v1/admin/users/${encodeURIComponent(id)}/reset-password`,{method:'POST',body:'{}'});closeModal();showTemporaryPassword(payload.temporaryPassword,adminState.users.find(user=>user.id===id));await loadData('users');}catch(error){toast(error.message,'danger');}
}

async function revokeUser(id) {
  if(!window.confirm('Encerrar todas as sessões deste usuário?'))return;
  try{await api(`/api/v1/admin/users/${encodeURIComponent(id)}/revoke-sessions`,{method:'POST'});closeModal();toast('Sessões encerradas.');await loadData('users');}catch(error){toast(error.message,'danger');}
}

async function revokeSession(id) {
  if(!window.confirm('Encerrar esta sessão agora?'))return;
  try{await api(`/api/v1/admin/sessions/${encodeURIComponent(id)}/revoke`,{method:'POST'});toast('Sessão encerrada.');await loadData('sessions');}catch(error){toast(error.message,'danger');}
}

if(canAdmin){
  new MutationObserver(injectEntries).observe(document.body,{childList:true,subtree:true});injectEntries();
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-admin-entry]'))return openPanel();
    if(event.target.closest('[data-admin-close]'))return closePanel();
    const tab=event.target.closest('[data-admin-tab]')?.dataset.adminTab;if(tab)return loadData(tab);
    if(event.target.closest('[data-admin-create-user]'))return openModal('Novo usuário',userForm());
    const edit=event.target.closest('[data-admin-edit-user]')?.dataset.adminEditUser;if(edit)return openModal('Editar usuário',userForm(adminState.users.find(user=>user.id===edit)));
    const menu=event.target.closest('[data-admin-user-menu]')?.dataset.adminUserMenu;if(menu)return openUserActions(adminState.users.find(user=>user.id===menu));
    if(event.target.closest('[data-admin-modal-close]'))return closeModal();
    const reset=event.target.closest('[data-admin-reset-password]')?.dataset.adminResetPassword;if(reset)return resetPassword(reset);
    const revokeUserId=event.target.closest('[data-admin-revoke-user]')?.dataset.adminRevokeUser;if(revokeUserId)return revokeUser(revokeUserId);
    const actionButton=event.target.closest('[data-admin-user-action]');if(actionButton)return userAction(actionButton.dataset.userId,actionButton.dataset.adminUserAction);
    const session=event.target.closest('[data-admin-revoke-session]')?.dataset.adminRevokeSession;if(session)return revokeSession(session);
    if(event.target.closest('[data-admin-refresh]'))return loadData(adminState.tab);
    const copy=event.target.closest('[data-copy-password]')?.dataset.copyPassword;if(copy){navigator.clipboard?.writeText(copy);return toast('Senha copiada.');}
  });
  document.addEventListener('submit',event=>{if(event.target.id==='adminUserForm'){event.preventDefault();saveUser(event.target);}});
  document.addEventListener('input',event=>{if(event.target.matches('[data-admin-search]')){adminState.search=event.target.value;renderPanel();}});
  document.addEventListener('change',event=>{if(event.target.matches('[data-admin-role-filter]')){adminState.role=event.target.value;renderPanel();}if(event.target.matches('[data-admin-status-filter]')){adminState.status=event.target.value;renderPanel();}});
}
