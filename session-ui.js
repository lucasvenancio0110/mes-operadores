(() => {
  const MINIMUM_MACHINES = 3;
  const MAXIMUM_MACHINES = 12;

  state.sessionUser = state.sessionUser || null;
  state.dailyMachineAssignments = state.dailyMachineAssignments || {};
  state.shiftConferences = state.shiftConferences || {};

  let assignmentDraft = [];
  let assignmentStage = 'review';
  let assignmentLineId = '';
  let conferenceHandoff = null;

  const originalLoadDraft = loadDraft;
  const originalSaveDraft = saveDraft;

  function sessionUser() {
    return state.sessionUser;
  }

  function sessionKey() {
    const user = sessionUser();
    if (!user?.registration) return '';
    return `${localDateKey()}|${state.shift}|${user.registration}`;
  }

  function conferenceKey(machineId) {
    return `${sessionKey()}|${machineId}`;
  }

  function currentAssignments() {
    return state.dailyMachineAssignments[sessionKey()] || [];
  }

  function currentConference() {
    const machineId = currentSlot()?.machineId;
    return machineId ? state.shiftConferences[conferenceKey(machineId)] || null : null;
  }

  async function cloudRequest(path, options = {}) {
    if (!CLOUD_API_URL) return null;
    const response = await fetch(`${CLOUD_API_URL}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function setLayerOpen(id, open) {
    const layer = el(id);
    if (!layer) return;
    layer.classList.toggle('is-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function closeAllLayers() {
    document.querySelectorAll('.app-layer.is-open').forEach(layer => layer.classList.remove('is-open'));
    document.body.style.overflow = '';
  }

  function syncOperatorFields() {
    const user = sessionUser();
    el('f_operator').value = user?.name || '';
    if (el('f_registration')) el('f_registration').value = user?.registration || '';
    state.operatorName = user?.name || '';
    state.operatorRegistration = user?.registration || '';
    if (user?.defaultShift && ['1', '2', '3'].includes(String(user.defaultShift))) {
      state.shift = String(user.defaultShift);
    }
    el('f_shift').value = state.shift;
    el('activeShiftBadge').textContent = `${state.shift}º turno`;
    persistState();
  }

  function buildLayers() {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="app-layer menu-layer" id="mainMenuLayer">
        <aside class="menu-drawer" aria-label="Menu principal">
          <div class="menu-top">
            <strong class="menu-wordmark">NEODENT MES</strong>
            <button class="modal-close" type="button" data-close-layer="mainMenuLayer">×</button>
          </div>
          <div class="menu-user-card" id="menuUserCard"></div>
          <div class="menu-list">
            <button class="menu-action" type="button" id="menuMachines">Máquinas do turno<span>Consultar ou alterar as máquinas selecionadas</span></button>
            <button class="menu-action" type="button" id="menuConference">Conferência inicial<span>OP, item, ciclo, frequências, meta e passagem</span></button>
            <button class="menu-action" type="button" id="menuSync">Sincronizar agora<span>Atualizar registros e dados da nuvem</span></button>
            <button class="menu-action danger" type="button" id="menuLogout">Sair<span>Encerrar a identificação neste aparelho</span></button>
          </div>
        </aside>
      </div>

      <div class="app-layer" id="loginLayer">
        <section class="app-modal" aria-labelledby="loginTitle">
          <div class="login-brand">
            <strong>NEODENT</strong>
            <span>Manufacturing Execution System</span>
          </div>
          <div class="modal-head">
            <div>
              <p class="section-kicker">Identificação do operador</p>
              <h2 id="loginTitle">Entrar no turno</h2>
            </div>
          </div>
          <p class="modal-note">A identificação ficará salva neste aparelho. No próximo acesso você não precisará redigitar.</p>
          <form id="loginForm">
            <div class="field">
              <label for="loginName">Nome</label>
              <input type="text" id="loginName" autocomplete="name" required>
            </div>
            <div class="field">
              <label for="loginRegistration">Matrícula</label>
              <input type="text" inputmode="numeric" id="loginRegistration" required>
            </div>
            <div class="field">
              <label for="loginShift">Turno</label>
              <select id="loginShift">
                <option value="1">1º turno</option>
                <option value="2">2º turno</option>
                <option value="3">3º turno</option>
              </select>
            </div>
            <div class="form-message" id="loginMessage"></div>
            <button class="btn btn-primary" type="submit">Entrar</button>
          </form>
        </section>
      </div>

      <div class="app-layer" id="assignmentLayer">
        <section class="app-modal wide" aria-labelledby="assignmentTitle">
          <div class="modal-head">
            <div>
              <p class="section-kicker">Máquinas do turno</p>
              <h2 id="assignmentTitle">Selecione suas máquinas</h2>
            </div>
            <button class="modal-close" type="button" data-close-layer="assignmentLayer">×</button>
          </div>
          <div id="assignmentBody"></div>
        </section>
      </div>

      <div class="app-layer" id="conferenceLayer">
        <section class="app-modal wide" aria-labelledby="conferenceTitle">
          <div class="modal-head">
            <div>
              <p class="section-kicker">Início do turno</p>
              <h2 id="conferenceTitle">Conferência inicial</h2>
            </div>
            <button class="modal-close" type="button" data-close-layer="conferenceLayer">×</button>
          </div>
          <div class="conference-context" id="conferenceMachineContext"></div>
          <form id="conferenceForm">
            <div class="row2">
              <div class="field">
                <label for="confOp">OP</label>
                <input type="text" inputmode="numeric" id="confOp" required>
              </div>
              <div class="field">
                <label for="confItem">Item</label>
                <input type="text" id="confItem" required>
              </div>
            </div>
            <div class="row2">
              <div class="field">
                <label for="confSequence">Sequência</label>
                <input type="text" inputmode="numeric" id="confSequence">
              </div>
              <div class="field">
                <label for="confCycle">Tempo de ciclo</label>
                <input type="text" id="confCycle" placeholder="5:55" required>
              </div>
            </div>
            <div class="row2">
              <div class="field">
                <label for="confFrequency1">Frequência I</label>
                <input type="text" inputmode="decimal" id="confFrequency1">
              </div>
              <div class="field">
                <label for="confFrequency2">Frequência II</label>
                <input type="text" inputmode="decimal" id="confFrequency2">
              </div>
            </div>
            <div class="row2">
              <div class="field">
                <label for="confOpening">Produção acumulada no início</label>
                <input type="text" inputmode="numeric" id="confOpening" placeholder="0">
              </div>
              <div class="field">
                <label for="confMinutes">Minutos disponíveis</label>
                <input type="text" inputmode="numeric" id="confMinutes" value="480">
              </div>
            </div>
            <div class="conference-context" id="conferenceHandoff">Digite a OP para consultar o apontamento dos turnos anteriores.</div>
            <div class="conference-preview" id="conferencePreview"></div>
            <div class="form-message" id="conferenceMessage"></div>
            <div class="modal-actions">
              <button class="btn btn-ghost" type="button" data-close-layer="conferenceLayer">Cancelar</button>
              <button class="btn btn-primary" type="submit">Salvar conferência</button>
            </div>
          </form>
        </section>
      </div>`;
    document.body.appendChild(root);

    document.querySelectorAll('[data-close-layer]').forEach(button => {
      button.addEventListener('click', () => {
        const layerId = button.dataset.closeLayer;
        if (layerId === 'loginLayer' && !sessionUser()) return;
        if (layerId === 'assignmentLayer' && currentAssignments().length < MINIMUM_MACHINES) return;
        setLayerOpen(layerId, false);
      });
    });

    document.querySelectorAll('.app-layer').forEach(layer => {
      layer.addEventListener('click', event => {
        if (event.target !== layer) return;
        if (layer.id === 'loginLayer' && !sessionUser()) return;
        if (layer.id === 'assignmentLayer' && currentAssignments().length < MINIMUM_MACHINES) return;
        setLayerOpen(layer.id, false);
      });
    });
  }

  function setupHeaderMenu() {
    const badge = document.querySelector('.brand-mes-badge');
    if (!badge) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'btnMainMenu';
    button.className = 'brand-menu-button';
    button.setAttribute('aria-label', 'Abrir menu');
    button.innerHTML = '<span></span><span></span><span></span>';
    badge.replaceWith(button);
    button.addEventListener('click', () => {
      renderMenuUser();
      setLayerOpen('mainMenuLayer', true);
    });
  }

  function setupContextCard() {
    const card = document.querySelector('.context-card');
    if (!card) return;
    const title = card.querySelector('.card-title');
    if (title) title.innerHTML = '<span class="dot"></span>Sessão do turno';

    [...card.children].forEach(child => {
      if (child.matches('.field, .row2')) child.classList.add('session-hidden-field');
    });

    const oldButton = card.querySelector('#btnOpenCatalog');
    if (oldButton) {
      const button = oldButton.cloneNode(true);
      button.textContent = 'Trocar máquinas';
      oldButton.replaceWith(button);
      button.addEventListener('click', () => openAssignmentWizard('review'));
    }

    const summary = document.createElement('div');
    summary.className = 'session-context-summary';
    summary.id = 'sessionContextSummary';
    card.appendChild(summary);
  }

  function setupConferenceOverview() {
    const digitalPanel = document.querySelector('.digital-panel');
    if (!digitalPanel) return;
    const section = document.createElement('section');
    section.className = 'card shift-overview-card';
    section.id = 'shiftOverviewCard';
    digitalPanel.insertAdjacentElement('beforebegin', section);
  }

  function renderMenuUser() {
    const user = sessionUser();
    const card = el('menuUserCard');
    if (!card) return;
    card.innerHTML = user
      ? `<strong>${escapeHtml(user.name)}</strong><span>Matrícula ${escapeHtml(user.registration)} · ${escapeHtml(state.shift)}º turno</span>`
      : '<strong>Nenhum operador conectado</strong>';
  }

  function renderSessionSummary() {
    const user = sessionUser();
    const assignments = currentAssignments();
    const summary = el('sessionContextSummary');
    if (!summary) return;
    summary.innerHTML = user
      ? `<div><div class="session-user-name">${escapeHtml(user.name)}</div><div class="session-user-meta">Matrícula ${escapeHtml(user.registration)} · ${escapeHtml(state.shift)}º turno · ${escapeHtml(localDateKey().split('-').reverse().join('/'))}</div></div><span class="session-machine-count">${assignments.length} máquina${assignments.length === 1 ? '' : 's'}</span>`
      : '<div><div class="session-user-name">Operador não identificado</div><div class="session-user-meta">Abra o menu para entrar</div></div>';
  }

  function applyAssignments(assignments) {
    const normalized = assignments.map((assignment, index) => ({
      slotId: assignment.slotId || `daily-slot-${index + 1}`,
      lineId: assignment.lineId,
      machineId: assignment.machineId
    }));
    state.dailyMachineAssignments[sessionKey()] = normalized;
    normalized.forEach(assignment => {
      state.slots[assignment.slotId] = { lineId: assignment.lineId, machineId: assignment.machineId };
      state.drafts[assignment.slotId] = state.drafts[assignment.slotId] || {};
    });
    if (!normalized.some(assignment => assignment.slotId === state.activeSlot)) {
      state.activeSlot = normalized[0]?.slotId || 'm1';
    }
    persistState();
    renderMachineTabs();
    renderContextSelectors();
    renderSessionSummary();
    renderConferenceOverview();
    renderLatest();
    updateCalculations();
  }

  renderMachineTabs = function renderAssignedMachineTabs() {
    const container = el('machineTabs');
    const assignments = currentAssignments();
    if (!container) return;

    if (!assignments.length) {
      container.innerHTML = '<button class="machine-tab select-machines" type="button" data-add-machine><strong>Selecionar máquinas</strong><span>Escolha pelo menos três para iniciar o turno</span></button>';
    } else {
      container.innerHTML = assignments.map((assignment, index) => {
        const machine = getMachine(assignment.lineId, assignment.machineId);
        const line = getLine(assignment.lineId);
        const active = assignment.slotId === state.activeSlot ? ' active' : '';
        return `<button class="machine-tab${active}" type="button" data-slot="${escapeHtml(assignment.slotId)}"><strong>${escapeHtml(machine?.name || `Máquina ${index + 1}`)}</strong><span>${escapeHtml(line?.name || 'Linha não encontrada')}</span></button>`;
      }).join('') + '<button class="machine-tab add-machine" type="button" data-add-machine><strong>＋</strong><span>Adicionar</span></button>';
    }

    container.querySelectorAll('[data-slot]').forEach(button => {
      button.addEventListener('click', () => switchSlot(button.dataset.slot));
    });
    container.querySelectorAll('[data-add-machine]').forEach(button => {
      button.addEventListener('click', () => openAssignmentWizard(assignments.length ? 'review' : 'lines'));
    });
  };

  switchSlot = function switchAssignedMachine(slotId) {
    const assignment = currentAssignments().find(item => item.slotId === slotId);
    if (!assignment || slotId === state.activeSlot) return;
    originalSaveDraft();
    state.activeSlot = slotId;
    originalLoadDraft();
    renderMachineTabs();
    renderContextSelectors();
    applyConferenceToForm(currentConference(), false);
    renderConferenceOverview();
    updateCalculations();
    renderLatest();
    persistState();
  };

  function renderAssignmentWizard() {
    const body = el('assignmentBody');
    if (!body) return;

    if (assignmentStage === 'lines') {
      body.innerHTML = `
        <div class="assignment-progress">Máquina ${assignmentDraft.length + 1}</div>
        <p class="selector-title">Escolha a linha</p>
        <div class="selector-grid">${state.catalog.map(line => `<button class="selector-card" type="button" data-select-line="${escapeHtml(line.id)}"><strong>${escapeHtml(line.name)}</strong><span>${line.machines?.length || 0} equipamentos</span></button>`).join('')}</div>
        ${assignmentDraft.length ? '<div class="modal-actions"><button class="btn btn-ghost" type="button" data-assignment-review>Voltar para selecionadas</button></div>' : ''}`;
      return;
    }

    if (assignmentStage === 'machines') {
      const line = getLine(assignmentLineId);
      const selectedIds = new Set(assignmentDraft.map(item => item.machineId));
      body.innerHTML = `
        <div class="assignment-progress">Máquina ${assignmentDraft.length + 1}</div>
        <p class="selector-title">${escapeHtml(line?.name || '')} · escolha a máquina</p>
        <div class="selector-grid">${(line?.machines || []).map(machine => `<button class="selector-card" type="button" data-select-machine="${escapeHtml(machine.id)}" ${selectedIds.has(machine.id) ? 'disabled' : ''}><strong>${escapeHtml(machine.name)}</strong><span>${escapeHtml(machine.equipmentType || 'TNL')}</span></button>`).join('')}</div>
        <div class="modal-actions"><button class="btn btn-ghost" type="button" data-assignment-lines>Voltar às linhas</button></div>`;
      return;
    }

    const remaining = Math.max(MINIMUM_MACHINES - assignmentDraft.length, 0);
    body.innerHTML = `
      <p class="modal-note">As máquinas ficam vinculadas ao operador, à data e ao turno. No próximo acesso de hoje esta tela não será exibida novamente.</p>
      <div class="assignment-selected-list">${assignmentDraft.length ? assignmentDraft.map((assignment, index) => {
        const line = getLine(assignment.lineId);
        const machine = getMachine(assignment.lineId, assignment.machineId);
        return `<div class="assignment-selected"><span class="assignment-order">${index + 1}</span><div><strong>${escapeHtml(machine?.name || '')}</strong><span>${escapeHtml(line?.name || '')}</span></div><button class="assignment-remove" type="button" data-remove-assignment="${index}" aria-label="Remover">×</button></div>`;
      }).join('') : '<div class="empty">Nenhuma máquina selecionada.</div>'}</div>
      ${remaining ? `<div class="conference-context">Selecione mais ${remaining} máquina${remaining === 1 ? '' : 's'} para iniciar o turno.</div>` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-add-assignment ${assignmentDraft.length >= MAXIMUM_MACHINES ? 'disabled' : ''}>＋ Adicionar máquina</button>
        <button class="btn btn-primary" type="button" data-save-assignments ${assignmentDraft.length < MINIMUM_MACHINES ? 'disabled' : ''}>Concluir seleção</button>
      </div>`;
  }

  function openAssignmentWizard(stage = 'review') {
    assignmentDraft = currentAssignments().map(item => ({ ...item }));
    assignmentStage = assignmentDraft.length ? stage : 'lines';
    assignmentLineId = '';
    renderAssignmentWizard();
    setLayerOpen('mainMenuLayer', false);
    setLayerOpen('assignmentLayer', true);
  }

  async function saveAssignmentsToCloud(assignments) {
    const user = sessionUser();
    if (!CLOUD_API_URL || !user) return;
    await cloudRequest('/api/v1/assignments', {
      method: 'POST',
      body: JSON.stringify({
        productionDate: localDateKey(),
        shift: state.shift,
        registration: user.registration,
        operatorName: user.name,
        assignments
      })
    });
  }

  async function finishAssignmentWizard() {
    if (assignmentDraft.length < MINIMUM_MACHINES) return;
    const assignments = assignmentDraft.map((item, index) => ({
      slotId: `daily-slot-${index + 1}`,
      lineId: item.lineId,
      machineId: item.machineId
    }));
    applyAssignments(assignments);
    setLayerOpen('assignmentLayer', false);
    try {
      await saveAssignmentsToCloud(assignments);
      showToast('Máquinas do turno salvas.');
    } catch (error) {
      console.error('Falha ao salvar máquinas na nuvem:', error);
      showToast('Máquinas salvas neste aparelho; sincronização pendente.');
    }
  }

  async function loadAssignmentsForSession() {
    const user = sessionUser();
    if (!user) return;
    let assignments = currentAssignments();

    if (CLOUD_API_URL) {
      try {
        const query = new URLSearchParams({
          productionDate: localDateKey(),
          shift: state.shift,
          registration: user.registration
        });
        const payload = await cloudRequest(`/api/v1/assignments?${query.toString()}`);
        if (Array.isArray(payload?.assignments) && payload.assignments.length) {
          assignments = payload.assignments.map((item, index) => ({
            slotId: `daily-slot-${index + 1}`,
            lineId: item.lineId,
            machineId: item.machineId
          }));
        }
      } catch (error) {
        console.error('Falha ao carregar máquinas do turno:', error);
      }
    }

    if (assignments.length) {
      applyAssignments(assignments);
      if (CLOUD_API_URL) saveAssignmentsToCloud(assignments).catch(() => {});
    } else {
      renderMachineTabs();
      renderSessionSummary();
      openAssignmentWizard('lines');
    }
  }

  function conferenceValues() {
    return {
      opNumber: el('confOp').value.trim(),
      itemNumber: el('confItem').value.trim(),
      sequence: el('confSequence').value.trim(),
      cycleMinutes: parseTempo(el('confCycle').value),
      frequency1: toNum(el('confFrequency1').value),
      frequency2: toNum(el('confFrequency2').value),
      openingProduction: toNum(el('confOpening').value),
      availableMinutes: toNum(el('confMinutes').value)
    };
  }

  function renderConferencePreview() {
    const values = conferenceValues();
    const target = values.cycleMinutes > 0 && values.availableMinutes > 0
      ? values.availableMinutes / values.cycleMinutes
      : NaN;
    const measurements1 = Number.isFinite(target) && values.frequency1 > 0 ? Math.ceil(target / values.frequency1) : NaN;
    const measurements2 = Number.isFinite(target) && values.frequency2 > 0 ? Math.ceil(target / values.frequency2) : NaN;
    el('conferencePreview').innerHTML = `
      <div><span>Meta do turno</span><strong>${fmtNum(target, 1)}</strong></div>
      <div><span>Medições I</span><strong>${fmtNum(measurements1, 0)}</strong></div>
      <div><span>Medições II</span><strong>${fmtNum(measurements2, 0)}</strong></div>`;
  }

  async function lookupConferenceOrder() {
    if (!CLOUD_API_URL) return;
    const op = el('confOp').value.trim();
    if (!op) return;
    try {
      const payload = await cloudRequest(`/api/v1/orders?op=${encodeURIComponent(op)}`);
      const order = payload?.order;
      if (order) {
        if (!el('confItem').value) el('confItem').value = order.item || '';
        if (!el('confSequence').value) el('confSequence').value = order.sequence || '';
      }
      await loadConferenceHandoff();
      if (el('confItem').value) await lookupConferenceItem();
    } catch (error) {
      console.error('Falha ao consultar OP da conferência:', error);
    }
  }

  async function lookupConferenceItem() {
    if (!CLOUD_API_URL) return;
    const item = el('confItem').value.trim();
    const machineId = currentSlot()?.machineId || '';
    if (!item || !machineId) return;
    try {
      const query = new URLSearchParams({ itemNumber: item, machineId });
      const payload = await cloudRequest(`/api/v1/items?${query.toString()}`);
      const data = payload?.items?.[0];
      if (!data) return;
      if (!el('confCycle').value && Number(data.cycleTimeSeconds) > 0) el('confCycle').value = fmtTimeFromSeconds(Number(data.cycleTimeSeconds));
      if (!el('confFrequency1').value && data.frequency1 !== null && data.frequency1 !== undefined) el('confFrequency1').value = String(data.frequency1).replace('.', ',');
      if (!el('confFrequency2').value && data.frequency2 !== null && data.frequency2 !== undefined) el('confFrequency2').value = String(data.frequency2).replace('.', ',');
      renderConferencePreview();
    } catch (error) {
      console.error('Falha ao consultar item da conferência:', error);
    }
  }

  async function loadConferenceHandoff() {
    const machine = getCurrentContext().machine;
    const op = el('confOp').value.trim();
    if (!machine || !op || !CLOUD_API_URL) return;
    try {
      const query = new URLSearchParams({ machineId: machine.id, opNumber: op });
      conferenceHandoff = await cloudRequest(`/api/v1/shift-context?${query.toString()}`);
      const last = conferenceHandoff?.lastSession;
      if (last && !el('confOpening').value) el('confOpening').value = String(last.finalProduction ?? 0);
      el('conferenceHandoff').textContent = last
        ? `Último apontamento: ${last.finalProduction ?? 0} peças · ${last.shift}º turno · ${last.operatorName}. Produzido nos turnos registrados: ${conferenceHandoff.producedTotal || 0}.`
        : 'Nenhum apontamento anterior encontrado para esta OP nesta máquina.';
      renderConferencePreview();
    } catch (error) {
      el('conferenceHandoff').textContent = 'Não foi possível consultar a passagem de turno agora.';
      console.error('Falha ao consultar passagem de turno:', error);
    }
  }

  function openConference() {
    const { line, machine } = getCurrentContext();
    if (!machine) {
      showToast('Selecione uma máquina primeiro.');
      return;
    }
    const conference = currentConference();
    conferenceHandoff = conference?.handoff || null;
    el('conferenceMachineContext').textContent = `${machine.name} · ${line?.name || ''} · ${state.shift}º turno · ${sessionUser()?.name || ''}`;
    el('confOp').value = conference?.opNumber || el('f_op').value || '';
    el('confItem').value = conference?.itemNumber || el('f_item').value || '';
    el('confSequence').value = conference?.sequence || el('f_seq').value || '';
    el('confCycle').value = conference?.cycleTimeSeconds ? fmtTimeFromSeconds(conference.cycleTimeSeconds) : el('f_tempo').value || '';
    el('confFrequency1').value = conference?.frequency1 ?? el('f_freq1').value || '';
    el('confFrequency2').value = conference?.frequency2 ?? el('f_freq2').value || '';
    el('confOpening').value = conference?.openingProduction ?? '';
    el('confMinutes').value = conference?.availableMinutes ?? el('f_minutos').value || '480';
    el('conferenceHandoff').textContent = conference?.handoffText || 'Digite a OP para consultar o apontamento dos turnos anteriores.';
    el('conferenceMessage').className = 'form-message';
    renderConferencePreview();
    setLayerOpen('mainMenuLayer', false);
    setLayerOpen('conferenceLayer', true);
    if (el('confOp').value) loadConferenceHandoff();
  }

  function applyConferenceToForm(conference, force = false) {
    if (!conference) return;
    const setValue = (id, value) => {
      const input = el(id);
      if (!input || value === null || value === undefined || value === '') return;
      if (force || !input.value) input.value = String(value);
    };
    setValue('f_op', conference.opNumber);
    setValue('f_item', conference.itemNumber);
    setValue('f_seq', conference.sequence);
    setValue('f_tempo', fmtTimeFromSeconds(conference.cycleTimeSeconds));
    setValue('f_freq1', conference.frequency1 !== null ? String(conference.frequency1).replace('.', ',') : '');
    setValue('f_freq2', conference.frequency2 !== null ? String(conference.frequency2).replace('.', ',') : '');
    setValue('f_pecas', conference.openingProduction ?? 0);
    setValue('f_minutos', conference.availableMinutes ?? 480);
    updateCalculations();
    originalSaveDraft();
  }

  async function saveConference(event) {
    event.preventDefault();
    const values = conferenceValues();
    const { line, machine } = getCurrentContext();
    const user = sessionUser();
    const message = el('conferenceMessage');

    if (!user || !machine || !line) return;
    if (!values.opNumber || !values.itemNumber || !Number.isFinite(values.cycleMinutes) || values.cycleMinutes <= 0) {
      message.textContent = 'Informe OP, item e tempo de ciclo válido.';
      message.className = 'form-message show error';
      return;
    }

    const availableMinutes = Number.isFinite(values.availableMinutes) && values.availableMinutes > 0 ? values.availableMinutes : 480;
    const target = availableMinutes / values.cycleMinutes;
    const now = new Date().toISOString();
    const conference = {
      id: `shift-${localDateKey()}-${state.shift}-${user.registration}-${machine.id}-${values.opNumber}`.replace(/[^a-zA-Z0-9-_]/g, '-'),
      productionDate: localDateKey(),
      shift: state.shift,
      registration: user.registration,
      operatorName: user.name,
      lineId: line.id,
      lineName: line.name,
      machineId: machine.id,
      machineName: machine.name,
      opNumber: values.opNumber,
      itemNumber: values.itemNumber,
      sequence: values.sequence,
      cycleTimeSeconds: Math.round(values.cycleMinutes * 60),
      frequency1: Number.isFinite(values.frequency1) ? values.frequency1 : null,
      frequency2: Number.isFinite(values.frequency2) ? values.frequency2 : null,
      openingProduction: Number.isFinite(values.openingProduction) ? values.openingProduction : 0,
      availableMinutes,
      target,
      status: currentConference()?.status === 'closed' ? 'closed' : 'open',
      openedAt: currentConference()?.openedAt || now,
      finalProduction: currentConference()?.finalProduction ?? null,
      closedAt: currentConference()?.closedAt || null,
      handoff: conferenceHandoff,
      handoffText: el('conferenceHandoff').textContent,
      updatedAt: now
    };

    state.shiftConferences[conferenceKey(machine.id)] = conference;
    persistState();
    applyConferenceToForm(conference, true);
    renderConferenceOverview();
    setLayerOpen('conferenceLayer', false);
    showToast(`${machine.name} conferida para o turno.`);

    if (CLOUD_API_URL) {
      try {
        await cloudRequest('/api/v1/shift-sessions', { method: 'POST', body: JSON.stringify(conference) });
      } catch (error) {
        console.error('Falha ao salvar conferência na nuvem:', error);
        showToast('Conferência salva localmente; sincronização pendente.');
      }
    }
  }

  function renderConferenceOverview() {
    const card = el('shiftOverviewCard');
    if (!card) return;
    const { line, machine } = getCurrentContext();
    const conference = currentConference();

    if (!machine) {
      card.innerHTML = '<div class="empty">Selecione as máquinas do turno para iniciar a conferência.</div>';
      return;
    }

    if (!conference) {
      card.innerHTML = `
        <div class="shift-overview-head"><div><p class="section-kicker">Conferência inicial</p><div class="shift-machine-title">${escapeHtml(machine.name)}</div><div class="shift-machine-sub">${escapeHtml(line?.name || '')}</div></div><span class="shift-status pending">Pendente</span></div>
        <div class="shift-handoff">Confirme a OP, o item, o ciclo, as frequências, a produção recebida e a meta deste turno.</div>
        <div class="shift-overview-actions"><button class="btn btn-primary" type="button" id="btnOpenConference">Conferir máquina</button></div>`;
      el('btnOpenConference').addEventListener('click', openConference);
      return;
    }

    const measurements1 = conference.frequency1 > 0 ? Math.ceil(conference.target / conference.frequency1) : NaN;
    const measurements2 = conference.frequency2 > 0 ? Math.ceil(conference.target / conference.frequency2) : NaN;
    const statusClass = conference.status === 'closed' ? 'closed' : 'open';
    const statusText = conference.status === 'closed' ? 'Apontado' : 'Conferida';
    const produced = conference.finalProduction !== null && conference.finalProduction !== undefined
      ? Math.max(Number(conference.finalProduction) - Number(conference.openingProduction || 0), 0)
      : null;

    card.innerHTML = `
      <div class="shift-overview-head"><div><p class="section-kicker">Conferência inicial</p><div class="shift-machine-title">${escapeHtml(machine.name)} · OP ${escapeHtml(conference.opNumber)}</div><div class="shift-machine-sub">Item ${escapeHtml(conference.itemNumber)} · ${escapeHtml(line?.name || '')}</div></div><span class="shift-status ${statusClass}">${statusText}</span></div>
      <div class="shift-metrics">
        <div class="shift-metric"><span>Recebido</span><strong>${fmtNum(Number(conference.openingProduction), 0)}</strong></div>
        <div class="shift-metric"><span>Meta</span><strong>${fmtNum(Number(conference.target), 1)}</strong></div>
        <div class="shift-metric"><span>Ciclo</span><strong>${fmtTimeFromSeconds(conference.cycleTimeSeconds)}</strong></div>
        <div class="shift-metric"><span>Medições I</span><strong>${fmtNum(measurements1, 0)}</strong></div>
        <div class="shift-metric"><span>Medições II</span><strong>${fmtNum(measurements2, 0)}</strong></div>
        <div class="shift-metric"><span>Produzido turno</span><strong>${produced === null ? '–' : fmtNum(produced, 0)}</strong></div>
      </div>
      <div class="shift-handoff">${escapeHtml(conference.handoffText || 'A passagem de turno será atualizada após o apontamento final.')}</div>
      <div class="shift-overview-actions"><button class="btn btn-ghost" type="button" id="btnEditConference">Editar conferência</button></div>`;
    el('btnEditConference').addEventListener('click', openConference);
  }

  async function closeConferenceAfterRecord(snapshot) {
    const conference = snapshot.conference;
    if (!conference || !Number.isFinite(snapshot.finalProduction)) return;
    const message = el('formMessage');
    if (!message?.classList.contains('success')) return;

    const now = new Date().toISOString();
    conference.finalProduction = snapshot.finalProduction;
    conference.status = 'closed';
    conference.closedAt = now;
    conference.updatedAt = now;
    state.shiftConferences[conferenceKey(snapshot.machineId)] = conference;
    persistState();
    renderConferenceOverview();

    if (CLOUD_API_URL) {
      try {
        await cloudRequest('/api/v1/shift-sessions', { method: 'POST', body: JSON.stringify(conference) });
      } catch (error) {
        console.error('Falha ao fechar sessão de turno:', error);
      }
    }
  }

  async function login(event) {
    event.preventDefault();
    const name = el('loginName').value.trim();
    const registration = el('loginRegistration').value.trim();
    const shift = el('loginShift').value;
    const message = el('loginMessage');

    if (!name || !registration) {
      message.textContent = 'Informe nome e matrícula.';
      message.className = 'form-message show error';
      return;
    }

    let operator = { id: `operator-${registration}`, name, registration, defaultShift: shift };
    if (CLOUD_API_URL) {
      try {
        const payload = await cloudRequest('/api/v1/session/login', {
          method: 'POST',
          body: JSON.stringify({ name, registration, shift })
        });
        if (payload?.operator) operator = payload.operator;
      } catch (error) {
        console.error('Falha ao identificar operador na nuvem:', error);
        showToast('Login salvo localmente; a nuvem será atualizada depois.');
      }
    }

    state.sessionUser = operator;
    state.shift = String(operator.defaultShift || shift);
    syncOperatorFields();
    renderMenuUser();
    renderSessionSummary();
    setLayerOpen('loginLayer', false);
    await loadAssignmentsForSession();
  }

  function logout() {
    closeAllLayers();
    state.sessionUser = null;
    state.operatorName = '';
    state.operatorRegistration = '';
    el('f_operator').value = '';
    if (el('f_registration')) el('f_registration').value = '';
    persistState();
    renderSessionSummary();
    renderMachineTabs();
    el('loginName').value = '';
    el('loginRegistration').value = '';
    el('loginShift').value = detectShift();
    setLayerOpen('loginLayer', true);
  }

  function bindSessionEvents() {
    el('loginForm').addEventListener('submit', login);
    el('assignmentBody').addEventListener('click', event => {
      const lineButton = event.target.closest('[data-select-line]');
      const machineButton = event.target.closest('[data-select-machine]');
      const removeButton = event.target.closest('[data-remove-assignment]');
      if (lineButton) {
        assignmentLineId = lineButton.dataset.selectLine;
        assignmentStage = 'machines';
        renderAssignmentWizard();
      } else if (machineButton) {
        assignmentDraft.push({ lineId: assignmentLineId, machineId: machineButton.dataset.selectMachine });
        assignmentStage = assignmentDraft.length < MINIMUM_MACHINES ? 'lines' : 'review';
        assignmentLineId = '';
        renderAssignmentWizard();
      } else if (removeButton) {
        assignmentDraft.splice(Number(removeButton.dataset.removeAssignment), 1);
        renderAssignmentWizard();
      } else if (event.target.closest('[data-add-assignment]')) {
        assignmentStage = 'lines';
        renderAssignmentWizard();
      } else if (event.target.closest('[data-assignment-review]')) {
        assignmentStage = 'review';
        renderAssignmentWizard();
      } else if (event.target.closest('[data-assignment-lines]')) {
        assignmentStage = 'lines';
        renderAssignmentWizard();
      } else if (event.target.closest('[data-save-assignments]')) {
        finishAssignmentWizard();
      }
    });

    el('conferenceForm').addEventListener('submit', saveConference);
    ['confCycle', 'confFrequency1', 'confFrequency2', 'confMinutes'].forEach(id => el(id).addEventListener('input', renderConferencePreview));
    el('confOp').addEventListener('blur', lookupConferenceOrder);
    el('confItem').addEventListener('blur', lookupConferenceItem);

    el('menuMachines').addEventListener('click', () => openAssignmentWizard('review'));
    el('menuConference').addEventListener('click', openConference);
    el('menuSync').addEventListener('click', async () => {
      setLayerOpen('mainMenuLayer', false);
      await checkCloudConnection();
      showToast('Sincronização solicitada.');
    });
    el('menuLogout').addEventListener('click', logout);

    el('btnSave').addEventListener('click', () => {
      const conference = currentConference();
      const fields = getFormFields();
      const machineId = currentSlot()?.machineId;
      const snapshot = {
        conference,
        machineId,
        finalProduction: fields.finalProduction
      };
      window.setTimeout(() => closeConferenceAfterRecord(snapshot), 350);
    }, true);
  }

  function prefillLogin() {
    el('loginName').value = state.operatorName || '';
    el('loginRegistration').value = state.operatorRegistration || '';
    el('loginShift').value = state.shift || detectShift();
  }

  async function bootstrapSession() {
    renderSessionSummary();
    renderConferenceOverview();
    if (sessionUser()?.name && sessionUser()?.registration) {
      syncOperatorFields();
      await loadAssignmentsForSession();
      applyConferenceToForm(currentConference(), false);
      return;
    }
    prefillLogin();
    setLayerOpen('loginLayer', true);
  }

  buildLayers();
  setupHeaderMenu();
  setupContextCard();
  setupConferenceOverview();
  bindSessionEvents();
  renderMachineTabs();
  bootstrapSession();
})();
