(() => {
  const VALID_SHIFTS = new Set(['1', '2', '3']);
  const loginForm = document.getElementById('loginForm');
  const loginShift = document.getElementById('loginShift');

  if (!loginForm || !loginShift) return;

  let selectedShift = VALID_SHIFTS.has(String(loginShift.value))
    ? String(loginShift.value)
    : String(state.shift || detectShift());

  function updateVisibleShift(shift) {
    const hiddenShift = document.getElementById('f_shift');
    const badge = document.getElementById('activeShiftBadge');
    const sessionMeta = document.querySelector('.session-user-meta');
    const menuMeta = document.querySelector('#menuUserCard span');

    if (hiddenShift) hiddenShift.value = shift;
    if (badge) badge.textContent = `${shift}º turno`;

    if (sessionMeta) {
      sessionMeta.textContent = sessionMeta.textContent.replace(/\b[123]º turno\b/, `${shift}º turno`);
    }
    if (menuMeta) {
      menuMeta.textContent = menuMeta.textContent.replace(/\b[123]º turno\b/, `${shift}º turno`);
    }
  }

  function enforceSelectedShift() {
    if (!VALID_SHIFTS.has(selectedShift)) return;

    state.shift = selectedShift;
    state.activeSessionShift = selectedShift;

    if (state.sessionUser) {
      state.sessionUser.currentShift = selectedShift;
      state.sessionUser.defaultShift = selectedShift;
    }

    updateVisibleShift(selectedShift);
    persistState();
  }

  loginShift.addEventListener('change', () => {
    selectedShift = String(loginShift.value);
    enforceSelectedShift();
  });

  // Executa antes do manipulador de login do módulo principal.
  loginForm.addEventListener('submit', () => {
    selectedShift = String(loginShift.value);
    enforceSelectedShift();

    // Reaplica após operações assíncronas de login e carregamento do D1.
    [0, 80, 300, 1000].forEach(delay => {
      window.setTimeout(enforceSelectedShift, delay);
    });
  }, true);

  const rememberedShift = String(
    state.sessionUser?.currentShift ||
    state.activeSessionShift ||
    state.shift ||
    ''
  );

  if (VALID_SHIFTS.has(rememberedShift)) {
    selectedShift = rememberedShift;
    loginShift.value = rememberedShift;
    enforceSelectedShift();
  }
})();
