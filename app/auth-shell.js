const app = document.getElementById('app');
const cacheKey = 'neomes-auth-cache:v1';
const rawFetch = window.fetch.bind(window);
let currentAuth = null;
let authBusy = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

function cloudAvailable() {
  return !window.location.hostname.endsWith('github.io');
}

function authCache() {
  try {
    const data = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (!data?.user || Number(data.offlineUntil || 0) < Date.now()) return null;
    return data;
  } catch { return null; }
}

function saveAuthCache(user, expiresAt) {
  const serverExpiry = new Date(expiresAt || Date.now() + 12 * 3600000).getTime();
  const offlineUntil = Math.min(serverExpiry, Date.now() + 12 * 3600000);
  const data = { user, expiresAt:new Date(serverExpiry).toISOString(), offlineUntil };
  localStorage.setItem(cacheKey,JSON.stringify(data));
  return data;
}

function clearAuthCache() {
  localStorage.removeItem(cacheKey);
  currentAuth = null;
  window.NEOMES_AUTH = null;
}

async function request(path, options = {}) {
  const response = await rawFetch(path, {
    credentials:'same-origin',
    ...options,
    headers:{ Accept:'application/json', ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Erro ${response.status}`);
    error.code = payload.code || '';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function brand() {
  return `<div class="auth-brand">
    <img src="assets/brand/neomes-logo-horizontal.svg" width="560" height="150" alt="NEOMES">
    <span>Gestão operacional segura</span>
  </div>`;
}

function shell(content, state = '') {
  app.innerHTML = `<main class="auth-page" data-state="${state}">
    <section class="auth-card">
      ${brand()}
      ${content}
    </section>
  </main>`;
}

function renderLoading(message = 'Validando acesso…') {
  shell(`<div class="auth-loading" role="status"><span></span><strong>${escapeHtml(message)}</strong><small>Conectando ao ambiente seguro do NEOMES.</small></div>`,'loading');
}

function renderCloudRequired() {
  shell(`<div class="auth-state"><strong>Abra a versão oficial</strong><p>A autenticação e os dados compartilhados funcionam somente no endereço Cloudflare do NEOMES.</p></div>`,'error');
}

function renderLogin(message = '') {
  const cached = authCache();
  shell(`<header class="auth-heading"><p>ACESSO PROTEGIDO</p><h1>Acesse sua operação</h1><span>Entre com sua matrícula e senha individual.</span></header>
    <form id="secureLoginForm" class="auth-form" novalidate>
      <label><span>Matrícula</span><input id="secureRegistration" name="registration" inputmode="numeric" autocomplete="username" required value="${escapeHtml(cached?.user?.registration || '')}"></label>
      <label><span>Senha</span><div class="auth-password"><input id="securePassword" name="password" type="password" autocomplete="current-password" required><button type="button" data-toggle-password="securePassword" aria-label="Mostrar senha">Mostrar</button></div></label>
      <div class="auth-error" id="secureLoginError" role="alert">${escapeHtml(message)}</div>
      <button class="auth-primary" type="submit">Entrar</button>
    </form>
    <p class="auth-footnote">O turno é identificado automaticamente pelo horário da fábrica. Sua senha não é salva no dispositivo.</p>`,'login');
}

function renderChangePassword(user, message = '') {
  shell(`<header class="auth-heading"><p>SEGURANÇA DA CONTA</p><h1>Crie sua nova senha</h1><span>${escapeHtml(user.name)}, a senha temporária deve ser substituída antes de continuar.</span></header>
    <form id="changePasswordForm" class="auth-form" novalidate>
      <label><span>Senha atual</span><div class="auth-password"><input id="currentPassword" type="password" autocomplete="current-password" required><button type="button" data-toggle-password="currentPassword">Mostrar</button></div></label>
      <label><span>Nova senha</span><div class="auth-password"><input id="newPassword" type="password" autocomplete="new-password" minlength="10" required><button type="button" data-toggle-password="newPassword">Mostrar</button></div></label>
      <label><span>Confirmar nova senha</span><input id="confirmPassword" type="password" autocomplete="new-password" minlength="10" required></label>
      <ul class="auth-requirements"><li>Pelo menos 10 caracteres</li><li>Letras e números</li><li>Não pode conter sua matrícula</li></ul>
      <div class="auth-error" id="changePasswordError" role="alert">${escapeHtml(message)}</div>
      <button class="auth-primary" type="submit">Salvar nova senha</button>
    </form>`,'password-change');
}

async function setOperationalSession(user, offline = false) {
  const { store, detectOperationalContext } = await import('./core.js');
  const operationalContext=offline ? detectOperationalContext() : (user.operationalContext || detectOperationalContext());
  store.update(state => {
    state.session = {
      id:user.id,
      name:user.name,
      registration:String(user.registration),
      shift:String(operationalContext.shift),
      productionDate:operationalContext.productionDate,
      operationalContext,
      startedAt:new Date().toISOString(),
      roleCode:user.roleCode,
      offlineAuthenticated:offline
    };
    state.auth = {
      userId:user.id,
      roleCode:user.roleCode,
      permissions:user.permissions || [],
      lineAccess:user.lineAccess || [],
      machineAccess:user.machineAccess || [],
      offline
    };
  },'secure-auth');
}

async function loadOperationalApp(user, offline = false) {
  currentAuth = { user, offline };
  window.NEOMES_AUTH = currentAuth;
  await setOperationalSession(user,offline);
  if (['preparator','leadership'].includes(user.roleCode)) {
    await import('./preparer-dashboard.js');
    return;
  }
  await import('./operator-main.js');
  await import('./cloud-state.js');
  await import('./exports.js');
  await import('./premium-runtime.js');
  await import('./production-planning.js');
  await import('./measurement-plan.js');
  await import('./conference-ux.js');
  await import('./shift-performance.js');
  await import('./shift-time-fix.js');
  await import('./measurement-frequency-fix.js');
  await import('./frequency-fields-v2.js');
  await import('./admin-ui.js');
}

async function login(form) {
  if (authBusy) return;
  const registration = form.querySelector('#secureRegistration').value.trim();
  const password = form.querySelector('#securePassword').value;
  const error = form.querySelector('#secureLoginError');
  if (!registration || !password) return void (error.textContent = 'Informe matrícula e senha.');
  if (!navigator.onLine) return void (error.textContent = 'O primeiro acesso precisa de conexão com a internet.');
  authBusy = true;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Entrando…';
  try {
    const payload = await request('/api/v1/auth/login',{ method:'POST',body:JSON.stringify({ registration,password }) });
    const cache = saveAuthCache(payload.user,payload.expiresAt);
    if (payload.user.mustChangePassword) return renderChangePassword(payload.user);
    await loadOperationalApp(payload.user,false);
    saveAuthCache(payload.user,cache.expiresAt);
  } catch (failure) {
    error.textContent = failure.message;
    button.disabled = false;
    button.textContent = 'Entrar';
  } finally { authBusy = false; }
}

async function changePassword(form) {
  if (authBusy) return;
  const currentPassword = form.querySelector('#currentPassword').value;
  const newPassword = form.querySelector('#newPassword').value;
  const confirmPassword = form.querySelector('#confirmPassword').value;
  const error = form.querySelector('#changePasswordError');
  if (newPassword !== confirmPassword) return void (error.textContent = 'A confirmação não corresponde à nova senha.');
  authBusy = true;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    const payload = await request('/api/v1/auth/change-password',{ method:'POST',body:JSON.stringify({ currentPassword,newPassword }) });
    saveAuthCache(payload.user,Date.now()+12*3600000);
    await loadOperationalApp(payload.user,false);
  } catch (failure) {
    error.textContent = failure.message;
    button.disabled = false;
    button.textContent = 'Salvar nova senha';
  } finally { authBusy = false; }
}

async function secureLogout() {
  if (!window.confirm('Deseja encerrar sua sessão neste aparelho?')) return;
  try { if (navigator.onLine) await request('/api/v1/auth/logout',{ method:'POST' }); } catch {}
  clearAuthCache();
  try {
    const { store } = await import('./core.js');
    store.update(state => { state.session=null; state.assignments=[]; state.activeMachineId=''; state.auth=null; },'secure-logout');
  } catch {}
  window.location.reload();
}

function installFetchGuard() {
  window.fetch = async (...argumentsList) => {
    const response = await rawFetch(...argumentsList);
    const target = typeof argumentsList[0] === 'string' ? argumentsList[0] : argumentsList[0]?.url || '';
    if (response.status === 401 && String(target).includes('/api/') && !String(target).includes('/auth/login')) {
      clearAuthCache();
      window.setTimeout(() => window.location.reload(),100);
    }
    return response;
  };
}

async function start() {
  if (!cloudAvailable()) return renderCloudRequired();
  renderLoading();
  installFetchGuard();
  try {
    const payload = await request('/api/v1/auth/me');
    saveAuthCache(payload.user,Date.now()+12*3600000);
    if (payload.user.mustChangePassword) return renderChangePassword(payload.user);
    return loadOperationalApp(payload.user,false);
  } catch (failure) {
    const cached = authCache();
    if (!navigator.onLine && cached?.user && !['admin'].includes(cached.user.roleCode)) return loadOperationalApp(cached.user,true);
    clearAuthCache();
    return renderLogin(failure.status && failure.status !== 401 ? failure.message : '');
  }
}

document.addEventListener('submit',event => {
  if (event.target.id === 'secureLoginForm') { event.preventDefault(); login(event.target); }
  if (event.target.id === 'changePasswordForm') { event.preventDefault(); changePassword(event.target); }
},true);

document.addEventListener('click',event => {
  const toggle = event.target.closest('[data-toggle-password]');
  if (toggle) {
    const input=document.getElementById(toggle.dataset.togglePassword);
    const visible=input.type==='text'; input.type=visible?'password':'text'; toggle.textContent=visible?'Mostrar':'Ocultar';
    return;
  }
  if (event.target.closest('[data-action="logout"]')) {
    event.preventDefault(); event.stopImmediatePropagation(); secureLogout();
  }
},true);

start();
