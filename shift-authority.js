(() => {
  const VALID_SHIFTS = new Set(['1', '2', '3']);
  const STORAGE_PREFIX = 'mes-active-shift:';
  const loginForm = document.getElementById('loginForm');
  const loginShift = document.getElementById('loginShift');
  const loginRegistration = document.getElementById('loginRegistration');

  if (!loginForm || !loginShift) return;

  let selectedShift = VALID_SHIFTS.has(String(loginShift.value))
    ? String(loginShift.value)
    : String(state.shift || detectShift());

  function registration() {
    return String(
      state.sessionUser?.registration ||
      loginRegistration?.value ||
      state.operatorRegistration ||
      ''
    ).trim();
  }

  function storageKey(registrationValue = registration()) {
    return `${STORAGE_PREFIX}${registrationValue || 'pending'}`;
  }

  function assignmentKey(shift) {
    const reg = registration();
    return reg ? `${localDateKey()}|${shift}|${reg}` : '';
  }

  function rememberShift(shift) {
    if (!VALID_SHIFTS.has(String(shift))) return;
    const reg = registration();
    sessionStorage.setItem('mes-selected-shift', String(shift));
    if (reg) localStorage.setItem(storageKey(reg), String(shift));
  }

  function updateVisibleShift(shift) {
    const hiddenShift = document.getElementById('f_shift');
    const badge = document.getElementById('activeShiftBadge');
    const sessionMeta = document.querySelector('.session-user-meta');
    const menuMeta = document.querySelector('#menuUserCard span');

    if (hiddenShift) hiddenShift.value = shift;
    if (loginShift) loginShift.value = shift;
    if (badge) badge.textContent = `${shift}º turno`;

    if (sessionMeta) {
      sessionMeta.textContent = sessionMeta.textContent.replace(/\b[123]º turno\b/, `${shift}º turno`);
    }
    if (menuMeta) {
      menuMeta.textContent = menuMeta.textContent.replace(/\b[123]º turno\b/, `${shift}º turno`);
    }
  }

  function copyAssignmentsToShift(oldShift, newShift) {
    if (!state.dailyMachineAssignments || oldShift === newShift) return;
    const oldKey = assignmentKey(oldShift);
    const newKey = assignmentKey(newShift);
    if (!oldKey || !newKey) return;

    if (!state.dailyMachineAssignments[newKey]?.length && state.dailyMachineAssignments[oldKey]?.length) {
      state.dailyMachineAssignments[newKey] = state.dailyMachineAssignments[oldKey].map(item => ({ ...item }));
    }
  }

  function enforceShift(shift = selectedShift, options = {}) {
    shift = String(shift);
    if (!VALID_SHIFTS.has(shift)) return;

    const previousShift = String(state.shift || '');
    if (options.copyAssignments !== false) copyAssignmentsToShift(previousShift, shift);

    selectedShift = shift;
    state.shift = shift;
    state.activeSessionShift = shift;

    if (state.sessionUser) {
      state.sessionUser.currentShift = shift;
      state.sessionUser.defaultShift = shift;
    }

    rememberShift(shift);
    updateVisibleShift(shift);
    persistState();

    try {
      renderMachineTabs();
      renderContextSelectors();
      updateCalculations();
    } catch (error) {
      console.debug('Turno atualizado antes da interface terminar de carregar.', error);
    }
  }

  function reinforceShift() {
    [0, 50, 150, 400, 900, 1800, 3500].forEach(delay => {
      window.setTimeout(() => enforceShift(selectedShift), delay);
    });
  }

  function buildShiftDialog() {
    if (document.getElementById('shiftChangeLayer')) return;

    const layer = document.createElement('div');
    layer.id = 'shiftChangeLayer';
    layer.className = 'app-layer';
    layer.innerHTML = `
      <section class="app-modal shift-change-modal">
        <div class="modal-head">
          <div><p class="section-kicker">Sessão do operador</p><h2>Alterar turno</h2></div>
          <button class="modal-close" id="closeShiftChange" type="button" aria-label="Fechar">×</button>
        </div>
        <p class="modal-note">O turno escolhido será usado nas máquinas, conferências e apontamentos desta sessão.</p>
        <div class="shift-choice-grid">
          <button type="button" data-shift-choice="1">1º turno</button>
          <button type="button" data-shift-choice="2">2º turno</button>
          <button type="button" data-shift-choice="3">3º turno</button>
        </div>
        <button class="btn btn-primary" id="confirmShiftChange" type="button" disabled>Confirmar turno</button>
      </section>`;
    document.body.appendChild(layer);

    let draftShift = '';
    const confirmButton = layer.querySelector('#confirmShiftChange');

    layer.querySelectorAll('[data-shift-choice]').forEach(button => {
      button.addEventListener('click', () => {
        draftShift = button.dataset.shiftChoice;
        layer.querySelectorAll('[data-shift-choice]').forEach(item => {
          item.classList.toggle('active', item === button);
        });
        confirmButton.disabled = false;
      });
    });

    layer.querySelector('#closeShiftChange').addEventListener('click', () => {
      layer.classList.remove('is-open');
      document.body.style.overflow = '';
    });

    confirmButton.addEventListener('click', () => {
      if (!VALID_SHIFTS.has(draftShift)) return;
      enforceShift(draftShift);
      layer.classList.remove('is-open');
      document.body.style.overflow = '';
      document.getElementById('mainMenuLayer')?.classList.remove('is-open');
      showToast(`Sessão alterada para o ${draftShift}º turno.`);
    });
  }

  function addMenuAction() {
    const menuList = document.querySelector('.menu-list');
    if (!menuList || document.getElementById('menuChangeShift')) return;

    const button = document.createElement('button');
    button.id = 'menuChangeShift';
    button.className = 'menu-action';
    button.type = 'button';
    button.innerHTML = 'Alterar turno<span>Trocar o turno ativo desta sessão</span>';
    menuList.insertBefore(button, menuList.querySelector('#menuSync'));

    button.addEventListener('click', () => {
      buildShiftDialog();
      const layer = document.getElementById('shiftChangeLayer');
      layer.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    });
  }

  loginShift.addEventListener('change', () => {
    selectedShift = String(loginShift.value);
    rememberShift(selectedShift);
  });

  loginRegistration?.addEventListener('input', () => {
    const remembered = localStorage.getItem(storageKey(loginRegistration.value.trim()));
    if (VALID_SHIFTS.has(remembered)) {
      selectedShift = remembered;
      loginShift.value = remembered;
    }
  });

  // Captura a escolha antes do login assíncrono consultar o D1.
  loginForm.addEventListener('submit', () => {
    selectedShift = String(loginShift.value);
    rememberShift(selectedShift);
    reinforceShift();
  }, true);

  const rememberedShift = String(
    sessionStorage.getItem('mes-selected-shift') ||
    localStorage.getItem(storageKey()) ||
    state.sessionUser?.currentShift ||
    state.activeSessionShift ||
    state.shift ||
    ''
  );

  if (VALID_SHIFTS.has(rememberedShift)) {
    selectedShift = rememberedShift;
    enforceShift(rememberedShift, { copyAssignments: false });
  }

  const menuObserver = new MutationObserver(() => addMenuAction());
  menuObserver.observe(document.body, { childList: true, subtree: true });
  addMenuAction();
  buildShiftDialog();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reinforceShift();
  });
})();
