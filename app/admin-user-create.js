const auth = window.NEOMES_AUTH;
const isAdministrator = Boolean(auth && !auth.offline && auth.user?.roleCode === 'admin');

let createLayer = null;
let createState = {
  step: 1,
  roles: [],
  lines: [],
  passwordMode: 'generated',
  allLines: true,
  values: {}
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  })[character]);
}

function roleLabel(code) {
  return ({
    admin:'Administrador',
    leadership:'Liderança',
    preparator:'Preparador',
    operator:'Operador',
    technical:'Técnico'
  })[code] || code;
}

function roleDescription(code) {
  return ({
    admin:'Gerencia usuários, acessos, configurações e todas as linhas.',
    leadership:'Consulta e acompanha as linhas autorizadas e seus registros.',
    preparator:'Acompanha as máquinas e informações lançadas pelos operadores.',
    operator:'Confere máquinas, informa recursos e realiza o fechamento do turno.',
    technical:'Consulta máquinas e registra atuações técnicas e manutenção.'
  })[code] || 'Perfil de acesso do usuário.';
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
  if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);
  return payload;
}

function valuesFromForm() {
  const form = createLayer?.querySelector('#guidedUserForm');
  if (!form) return createState.values;
  const values = Object.fromEntries(new FormData(form));
  values.lineAccess = [...form.querySelectorAll('[name="lineAccess"]:checked')].map(input => input.value);
  createState.values = { ...createState.values, ...values };
  return createState.values;
}

function selectedRole() {
  return createState.values.roleCode || 'operator';
}

function progress() {
  return `<div class="guided-user-progress" aria-label="Etapa ${createState.step} de 3">
    ${[1,2,3].map(step => `<span data-complete="${step <= createState.step}">${step}</span>`).join('')}
  </div>`;
}

function identificationStep() {
  const values = createState.values;
  return `<section class="guided-user-step">
    <header><p>ETAPA 1 DE 3</p><h3>Identificação</h3><span>Dados usados para reconhecer a pessoa no NEOMES.</span></header>
    <label><span>Nome completo</span><input name="name" autocomplete="name" required value="${escapeHtml(values.name || '')}" placeholder="Ex.: Ana Souza"></label>
    <label><span>Matrícula</span><input name="registration" inputmode="numeric" autocomplete="off" required value="${escapeHtml(values.registration || '')}" placeholder="Ex.: 6675"></label>
    <label><span>E-mail <small>opcional</small></span><input name="email" type="email" autocomplete="email" value="${escapeHtml(values.email || '')}" placeholder="nome@empresa.com"></label>
  </section>`;
}

function accessStep() {
  const values = createState.values;
  const currentRole = selectedRole();
  const currentShift = values.defaultShift || String(auth?.user?.defaultShift || '1');
  const selectedLines = new Set(values.lineAccess || []);
  return `<section class="guided-user-step">
    <header><p>ETAPA 2 DE 3</p><h3>Função e acesso</h3><span>Defina o que essa pessoa poderá consultar e registrar.</span></header>
    <fieldset class="guided-role-list"><legend>Perfil</legend>
      ${createState.roles.map(role => `<label class="guided-role" data-selected="${role.code === currentRole}">
        <input type="radio" name="roleCode" value="${escapeHtml(role.code)}" ${role.code === currentRole ? 'checked' : ''}>
        <span><strong>${escapeHtml(role.name || roleLabel(role.code))}</strong><small>${escapeHtml(roleDescription(role.code))}</small></span>
      </label>`).join('')}
    </fieldset>
    <label><span>Turno padrão</span><select name="defaultShift">
      ${['1','2','3'].map(shift => `<option value="${shift}" ${shift === currentShift ? 'selected' : ''}>${shift}º turno</option>`).join('')}
    </select></label>
    <fieldset class="guided-lines"><legend>Linhas permitidas</legend>
      <label class="guided-all-lines"><input type="checkbox" data-guided-all-lines ${createState.allLines ? 'checked' : ''}><span><strong>Todas conforme o perfil</strong><small>O acesso não será limitado a linhas específicas.</small></span></label>
      <div data-guided-line-grid ${createState.allLines ? 'hidden' : ''}>
        ${createState.lines.map(line => `<label><input type="checkbox" name="lineAccess" value="${escapeHtml(line.id)}" ${selectedLines.has(String(line.id)) ? 'checked' : ''}><span>${escapeHtml(line.name || `Linha ${line.id}`)}</span></label>`).join('')}
      </div>
    </fieldset>
  </section>`;
}

function securityStep() {
  const values = createState.values;
  const generated = createState.passwordMode === 'generated';
  return `<section class="guided-user-step">
    <header><p>ETAPA 3 DE 3</p><h3>Senha inicial</h3><span>O usuário será obrigado a criar uma nova senha no primeiro acesso.</span></header>
    <div class="guided-password-choice" role="radiogroup" aria-label="Forma de criação da senha">
      <button type="button" data-password-mode="generated" aria-pressed="${generated}"><strong>Gerar automaticamente</strong><small>Mais rápido e recomendado</small></button>
      <button type="button" data-password-mode="manual" aria-pressed="${!generated}"><strong>Definir agora</strong><small>Você escolhe a senha provisória</small></button>
    </div>
    ${generated ? `<div class="guided-security-note"><strong>Senha temporária automática</strong><p>Ela será exibida somente depois que o cadastro for concluído.</p></div>` : `
      <label><span>Senha provisória</span><div class="guided-password-input"><input name="password" type="password" autocomplete="new-password" minlength="10" value="${escapeHtml(values.password || '')}"><button type="button" data-guided-toggle-password="password">Mostrar</button></div></label>
      <label><span>Confirmar senha</span><div class="guided-password-input"><input name="confirmPassword" type="password" autocomplete="new-password" minlength="10" value="${escapeHtml(values.confirmPassword || '')}"><button type="button" data-guided-toggle-password="confirmPassword">Mostrar</button></div></label>
      <ul class="guided-password-rules"><li>Pelo menos 10 caracteres</li><li>Deve conter letras e números</li><li>Não pode conter a matrícula</li></ul>`}
    <div class="guided-user-review">
      <strong>Resumo</strong>
      <dl><div><dt>Nome</dt><dd>${escapeHtml(values.name || '—')}</dd></div><div><dt>Matrícula</dt><dd>${escapeHtml(values.registration || '—')}</dd></div><div><dt>Perfil</dt><dd>${escapeHtml(roleLabel(selectedRole()))}</dd></div><div><dt>Turno</dt><dd>${escapeHtml(values.defaultShift || auth?.user?.defaultShift || '1')}º</dd></div></dl>
    </div>
  </section>`;
}

function formContent() {
  const content = createState.step === 1 ? identificationStep() : createState.step === 2 ? accessStep() : securityStep();
  return `<section class="guided-user-modal" role="dialog" aria-modal="true" aria-labelledby="guidedUserTitle">
    <header class="guided-user-topbar"><div><p>ADMINISTRAÇÃO</p><h2 id="guidedUserTitle">Novo usuário</h2></div><button type="button" data-guided-close aria-label="Fechar">×</button></header>
    ${progress()}
    <form id="guidedUserForm" novalidate>${content}<div class="guided-user-error" role="alert"></div>
      <footer><button type="button" class="guided-secondary" data-guided-back>${createState.step === 1 ? 'Cancelar' : 'Voltar'}</button><button type="submit" class="guided-primary">${createState.step === 3 ? 'Criar usuário' : 'Continuar'}</button></footer>
    </form>
  </section>`;
}

function render() {
  if (!createLayer) return;
  createLayer.innerHTML = formContent();
  const firstInput = createLayer.querySelector('input:not([type="radio"]):not([type="checkbox"]),select');
  window.setTimeout(() => firstInput?.focus({ preventScroll:true }), 80);
}

function closeCreate() {
  createLayer?.remove();
  createLayer = null;
  document.body.classList.remove('guided-user-open');
}

async function openCreate() {
  if (!isAdministrator || createLayer) return;
  createState = {
    step:1,
    roles:[],
    lines:[],
    passwordMode:'generated',
    allLines:true,
    values:{ roleCode:'operator', defaultShift:String(auth?.user?.defaultShift || '1'), lineAccess:[] }
  };
  createLayer = document.createElement('div');
  createLayer.className = 'guided-user-layer';
  createLayer.innerHTML = '<div class="guided-user-loading" role="status">Preparando cadastro…</div>';
  document.body.appendChild(createLayer);
  document.body.classList.add('guided-user-open');
  try {
    const [rolesPayload,catalogPayload] = await Promise.all([
      api('/api/v1/admin/roles'),
      api('/api/v1/catalog')
    ]);
    createState.roles = rolesPayload.roles || [];
    createState.lines = catalogPayload.lines || [];
    render();
  } catch (error) {
    createLayer.innerHTML = `<div class="guided-user-fatal"><strong>Não foi possível abrir o cadastro</strong><p>${escapeHtml(error.message)}</p><button type="button" data-guided-close>Fechar</button></div>`;
  }
}

function validateStep(values) {
  if (createState.step === 1) {
    if (!String(values.name || '').trim()) return 'Informe o nome completo.';
    if (!String(values.registration || '').trim()) return 'Informe a matrícula.';
    if (!/^\d+$/.test(String(values.registration).trim())) return 'A matrícula deve conter somente números.';
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return 'Informe um e-mail válido ou deixe o campo vazio.';
  }
  if (createState.step === 2) {
    if (!values.roleCode) return 'Selecione um perfil.';
    if (!['1','2','3'].includes(String(values.defaultShift))) return 'Selecione um turno válido.';
  }
  if (createState.step === 3 && createState.passwordMode === 'manual') {
    const password = String(values.password || '');
    if (password.length < 10) return 'A senha provisória deve ter pelo menos 10 caracteres.';
    if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'A senha provisória deve conter letras e números.';
    if (password.toLowerCase().includes(String(values.registration || '').toLowerCase())) return 'A senha provisória não pode conter a matrícula.';
    if (password !== String(values.confirmPassword || '')) return 'A confirmação da senha não corresponde.';
  }
  return '';
}

async function submitStep(form) {
  const values = valuesFromForm();
  const error = form.querySelector('.guided-user-error');
  const problem = validateStep(values);
  if (problem) {
    error.textContent = problem;
    return;
  }
  if (createState.step < 3) {
    createState.step += 1;
    render();
    return;
  }

  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Criando…';
  try {
    const body = {
      name:String(values.name).trim(),
      registration:String(values.registration).trim(),
      email:String(values.email || '').trim(),
      roleCode:selectedRole(),
      defaultShift:String(values.defaultShift || '1'),
      lineAccess:createState.allLines ? [] : (values.lineAccess || []),
      machineAccess:[]
    };
    if (createState.passwordMode === 'manual') body.password = String(values.password || '');
    const payload = await api('/api/v1/admin/users',{ method:'POST',body:JSON.stringify(body) });
    showSuccess(payload);
  } catch (failure) {
    error.textContent = failure.message;
    button.disabled = false;
    button.textContent = 'Criar usuário';
  }
}

function showSuccess(payload) {
  const user = payload.user || {};
  const password = payload.temporaryPassword || '';
  createLayer.innerHTML = `<section class="guided-user-modal guided-user-success" role="dialog" aria-modal="true">
    <div class="guided-success-mark" aria-hidden="true">✓</div>
    <p>USUÁRIO CRIADO</p><h2>${escapeHtml(user.name || createState.values.name)}</h2>
    <span>Matrícula ${escapeHtml(user.registration || createState.values.registration)} · ${escapeHtml(roleLabel(user.roleCode || selectedRole()))}</span>
    <div class="guided-credential"><small>Senha temporária</small><code>${escapeHtml(password)}</code><button type="button" data-guided-copy="${escapeHtml(password)}">Copiar senha</button></div>
    <div class="guided-success-note"><strong>Primeiro acesso</strong><p>Essa pessoa entrará com a matrícula e a senha acima. Em seguida, deverá criar uma nova senha pessoal.</p></div>
    <footer><button type="button" class="guided-secondary" data-guided-create-another>Cadastrar outro</button><button type="button" class="guided-primary" data-guided-finish>Concluir</button></footer>
  </section>`;
  document.querySelector('[data-admin-tab="users"]')?.click();
}

function goBack() {
  valuesFromForm();
  if (createState.step === 1) return closeCreate();
  createState.step -= 1;
  render();
}

function setPasswordMode(mode) {
  valuesFromForm();
  createState.passwordMode = mode === 'manual' ? 'manual' : 'generated';
  render();
}

if (isAdministrator) {
  document.addEventListener('click', event => {
    const createButton = event.target.closest('[data-admin-create-user]');
    if (createButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openCreate();
      return;
    }
    if (!createLayer) return;
    if (event.target === createLayer || event.target.closest('[data-guided-close],[data-guided-finish]')) return closeCreate();
    if (event.target.closest('[data-guided-back]')) return goBack();
    if (event.target.closest('[data-guided-create-another]')) { closeCreate(); return openCreate(); }
    const passwordMode = event.target.closest('[data-password-mode]')?.dataset.passwordMode;
    if (passwordMode) return setPasswordMode(passwordMode);
    const toggle = event.target.closest('[data-guided-toggle-password]');
    if (toggle) {
      const input = createLayer.querySelector(`[name="${toggle.dataset.guidedTogglePassword}"]`);
      if (!input) return;
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      toggle.textContent = visible ? 'Mostrar' : 'Ocultar';
      return;
    }
    const copy = event.target.closest('[data-guided-copy]')?.dataset.guidedCopy;
    if (copy) {
      navigator.clipboard?.writeText(copy);
      const button = event.target.closest('[data-guided-copy]');
      button.textContent = 'Copiada';
      window.setTimeout(() => { if (button.isConnected) button.textContent = 'Copiar senha'; }, 1800);
    }
  }, true);

  document.addEventListener('change', event => {
    if (!createLayer) return;
    if (event.target.matches('[name="roleCode"]')) {
      valuesFromForm();
      createState.values.roleCode = event.target.value;
      render();
    }
    if (event.target.matches('[data-guided-all-lines]')) {
      valuesFromForm();
      createState.allLines = event.target.checked;
      if (createState.allLines) createState.values.lineAccess = [];
      render();
    }
  }, true);

  document.addEventListener('submit', event => {
    if (event.target.id !== 'guidedUserForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitStep(event.target);
  }, true);
}
