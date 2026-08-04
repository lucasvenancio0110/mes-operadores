function canResetPassword() {
  const auth = window.NEOMES_AUTH;
  return Boolean(auth && !auth.offline && (
    auth.user?.roleCode === 'admin'
    || (auth.user?.permissions || []).includes('users.reset_password')
  ));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials:'same-origin',
    ...options,
    headers:{
      Accept:'application/json',
      ...(options.body ? { 'Content-Type':'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Erro ${response.status}`);
    error.code = payload.code || '';
    throw error;
  }
  return payload;
}

function adminLayer() {
  return document.querySelector('.admin-layer');
}

function removeModal() {
  adminLayer()?.querySelector('.admin-modal-layer')?.remove();
}

function createModal(title, content) {
  const root = adminLayer();
  if (!root) return null;
  removeModal();
  const layer = document.createElement('div');
  layer.className = 'admin-modal-layer admin-password-reset-layer';
  layer.innerHTML = `<section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="adminResetTitle">
    <header><h2 id="adminResetTitle">${escapeHtml(title)}</h2><button type="button" data-reset-close aria-label="Fechar">×</button></header>
    <div>${content}</div>
  </section>`;
  root.appendChild(layer);
  return layer;
}

function actionUserName(button) {
  const title = button.closest('.admin-modal')?.querySelector('header h2')?.textContent || '';
  return title.replace(/^Ações\s*·\s*/i,'').trim() || 'este usuário';
}

function openConfirmation(id, name) {
  createModal('Redefinir senha',`<div class="admin-temporary admin-reset-confirmation">
    <p>Será criada uma nova senha temporária para <strong>${escapeHtml(name)}</strong>.</p>
    <div class="admin-reset-warning">
      <strong>O que acontecerá</strong>
      <span>A senha atual deixará de funcionar.</span>
      <span>Todas as sessões desse usuário serão encerradas.</span>
      <span>No próximo acesso, ele deverá criar uma senha pessoal.</span>
    </div>
    <div class="admin-form-error" data-reset-error role="alert"></div>
    <footer>
      <button type="button" class="admin-secondary" data-reset-close>Cancelar</button>
      <button type="button" class="admin-primary" data-reset-confirm="${escapeHtml(id)}" data-reset-name="${escapeHtml(name)}">Gerar nova senha</button>
    </footer>
  </div>`);
}

function showPassword(payload, fallbackName) {
  const user = payload.user || {};
  const password = String(payload.temporaryPassword || '');
  createModal('Senha redefinida',`<div class="admin-temporary admin-reset-success">
    <p>A nova senha temporária de <strong>${escapeHtml(user.name || fallbackName || 'usuário')}</strong> foi criada.</p>
    <code>${escapeHtml(password)}</code>
    <button class="admin-primary" type="button" data-reset-copy="${escapeHtml(password)}">Copiar senha</button>
    <small>Esta senha aparece somente agora. O usuário deverá trocá-la no primeiro acesso.</small>
    <div class="admin-reset-complete"><span aria-hidden="true">✓</span><strong>Sessões anteriores encerradas</strong></div>
    <footer><button type="button" class="admin-secondary" data-reset-finish>Concluir</button></footer>
  </div>`);
}

async function executeReset(button) {
  const id = button.dataset.resetConfirm;
  const name = button.dataset.resetName || 'usuário';
  const modal = button.closest('.admin-modal-layer');
  const error = modal?.querySelector('[data-reset-error]');
  button.disabled = true;
  button.textContent = 'Gerando…';
  if (error) error.textContent = '';

  try {
    const payload = await api(`/api/v1/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method:'POST',
      body:'{}'
    });
    showPassword(payload,name);
  } catch (failure) {
    if (error) error.textContent = failure.message;
    button.disabled = false;
    button.textContent = 'Gerar nova senha';
  }
}

function refreshUsers() {
  document.querySelector('[data-admin-tab="users"]')?.click();
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-admin-reset-password]');
  if (trigger && canResetPassword()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openConfirmation(trigger.dataset.adminResetPassword,actionUserName(trigger));
    return;
  }

  const confirm = event.target.closest('[data-reset-confirm]');
  if (confirm) {
    event.preventDefault();
    event.stopImmediatePropagation();
    executeReset(confirm);
    return;
  }

  const copy = event.target.closest('[data-reset-copy]');
  if (copy) {
    event.preventDefault();
    event.stopImmediatePropagation();
    navigator.clipboard?.writeText(copy.dataset.resetCopy);
    copy.textContent = 'Senha copiada';
    window.setTimeout(() => { copy.textContent = 'Copiar senha'; },1800);
    return;
  }

  if (event.target.closest('[data-reset-finish]')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    removeModal();
    refreshUsers();
    return;
  }

  if (event.target.closest('[data-reset-close]')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    removeModal();
  }
},true);
