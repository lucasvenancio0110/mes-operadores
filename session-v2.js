(() => {
  const MIN_MACHINES = 3;
  const MAX_MACHINES = 12;

  state.sessionUser = state.sessionUser || null;
  state.dailyMachineAssignments = state.dailyMachineAssignments || {};
  state.shiftConferences = state.shiftConferences || {};

  const originalLoadDraft = loadDraft;
  const originalSaveDraft = saveDraft;
  let assignmentDraft = [];
  let assignmentMode = 'review';
  let selectedLineId = '';
  let handoffData = null;

  const user = () => state.sessionUser;
  const key = () => user()?.registration ? `${localDateKey()}|${state.shift}|${user().registration}` : '';
  const assignments = () => state.dailyMachineAssignments[key()] || [];
  const confKey = machineId => `${key()}|${machineId}`;
  const conference = () => currentSlot()?.machineId ? state.shiftConferences[confKey(currentSlot().machineId)] || null : null;

  async function api(path, options = {}) {
    if (!CLOUD_API_URL) return null;
    const response = await fetch(`${CLOUD_API_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function layer(id, open) {
    const node = el(id);
    if (!node) return;
    node.classList.toggle('is-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function buildUi() {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="app-layer menu-layer" id="mainMenuLayer">
        <aside class="menu-drawer">
          <div class="menu-top"><strong class="menu-wordmark">NEODENT MES</strong><button class="modal-close" type="button" data-close="mainMenuLayer">×</button></div>
          <div class="menu-user-card" id="menuUserCard"></div>
          <div class="menu-list">
            <button class="menu-action" id="menuMachines" type="button">Máquinas do turno<span>Consultar ou alterar as máquinas selecionadas</span></button>
            <button class="menu-action" id="menuConference" type="button">Conferência inicial<span>OP, item, ciclo, frequências, meta e passagem</span></button>
            <button class="menu-action" id="menuSync" type="button">Sincronizar agora<span>Atualizar dados com o Cloudflare</span></button>
            <button class="menu-action danger" id="menuLogout" type="button">Sair<span>Encerrar a identificação neste aparelho</span></button>
          </div>
        </aside>
      </div>

      <div class="app-layer" id="loginLayer">
        <section class="app-modal">
          <div class="login-brand"><strong>NEODENT</strong><span>Manufacturing Execution System</span></div>
          <div class="modal-head"><div><p class="section-kicker">Identificação</p><h2>Entrar no turno</h2></div></div>
          <p class="modal-note">O login ficará salvo neste aparelho. Para trocar de operador, use o menu.</p>
          <form id="loginForm">
            <div class="field"><label for="loginName">Nome</label><input id="loginName" type="text" required></div>
            <div class="field"><label for="loginRegistration">Matrícula</label><input id="loginRegistration" inputmode="numeric" type="text" required></div>
            <div class="field"><label for="loginShift">Turno</label><select id="loginShift"><option value="1">1º turno</option><option value="2">2º turno</option><option value="3">3º turno</option></select></div>
            <div class="form-message" id="loginMessage"></div>
            <button class="btn btn-primary" type="submit">Entrar</button>
          </form>
        </section>
      </div>

      <div class="app-layer" id="assignmentLayer">
        <section class="app-modal wide">
          <div class="modal-head"><div><p class="section-kicker">Início do turno</p><h2>Quais são suas máquinas?</h2></div><button class="modal-close" type="button" data-close="assignmentLayer">×</button></div>
          <div id="assignmentBody"></div>
        </section>
      </div>

      <div class="app-layer" id="conferenceLayer">
        <section class="app-modal wide">
          <div class="modal-head"><div><p class="section-kicker">Início do turno</p><h2>Conferência inicial</h2></div><button class="modal-close" type="button" data-close="conferenceLayer">×</button></div>
          <div class="conference-context" id="conferenceMachineContext"></div>
          <form id="conferenceForm">
            <div class="row2"><div class="field"><label for="confOp">OP</label><input id="confOp" inputmode="numeric" required></div><div class="field"><label for="confItem">Item</label><input id="confItem" required></div></div>
            <div class="row2"><div class="field"><label for="confSequence">Sequência</label><input id="confSequence" inputmode="numeric"></div><div class="field"><label for="confCycle">Tempo de ciclo</label><input id="confCycle" placeholder="5:55" required></div></div>
            <div class="row2"><div class="field"><label for="confFrequency1">Frequência I</label><input id="confFrequency1" inputmode="decimal"></div><div class="field"><label for="confFrequency2">Frequência II</label><input id="confFrequency2" inputmode="decimal"></div></div>
            <div class="row2"><div class="field"><label for="confOpening">Produção recebida</label><input id="confOpening" inputmode="numeric" placeholder="0"></div><div class="field"><label for="confMinutes">Minutos disponíveis</label><input id="confMinutes" inputmode="numeric" value="480"></div></div>
            <div class="conference-context" id="conferenceHandoff">Digite a OP para consultar os turnos anteriores.</div>
            <div class="conference-preview" id="conferencePreview"></div>
            <div class="form-message" id="conferenceMessage"></div>
            <div class="modal-actions"><button class="btn btn-ghost" type="button" data-close="conferenceLayer">Cancelar</button><button class="btn btn-primary" type="submit">Salvar conferência</button></div>
          </form>
        </section>
      </div>`;
    document.body.appendChild(root);

    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.close === 'loginLayer' && !user()) return;
      if (button.dataset.close === 'assignmentLayer' && assignments().length < MIN_MACHINES) return;
      layer(button.dataset.close, false);
    }));
  }

  function setupHeader() {
    const badge = document.querySelector('.brand-mes-badge');
    if (!badge) return;
    const button = document.createElement('button');
    button.className = 'brand-menu-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Abrir menu');
    button.innerHTML = '<span></span><span></span><span></span>';
    badge.replaceWith(button);
    button.addEventListener('click', () => {
      renderMenu();
      layer('mainMenuLayer', true);
    });
  }

  function setupContext() {
    const card = document.querySelector('.context-card');
    if (!card) return;
    const title = card.querySelector('.card-title');
    if (title) title.innerHTML = '<span class="dot"></span>Sessão do turno';
    [...card.children].forEach(child => {
      if (child.matches('.field,.row2')) child.classList.add('session-hidden-field');
    });
    const oldButton = card.querySelector('#btnOpenCatalog');
    if (oldButton) {
      const button = oldButton.cloneNode(true);
      button.textContent = 'Trocar máquinas';
      oldButton.replaceWith(button);
      button.addEventListener('click', openAssignments);
    }
    const summary = document.createElement('div');
    summary.id = 'sessionContextSummary';
    summary.className = 'session-context-summary';
    card.appendChild(summary);

    const overview = document.createElement('section');
    overview.id = 'shiftOverviewCard';
    overview.className = 'card shift-overview-card';
    document.querySelector('.digital-panel')?.insertAdjacentElement('beforebegin', overview);
  }

  function syncLegacyFields() {
    const current = user();
    state.operatorName = current?.name || '';
    state.operatorRegistration = current?.registration || '';
    el('f_operator').value = state.operatorName;
    if (el('f_registration')) el('f_registration').value = state.operatorRegistration;
    el('f_shift').value = state.shift;
    el('activeShiftBadge').textContent = `${state.shift}º turno`;
    persistState();
  }

  function renderMenu() {
    const current = user();
    el('menuUserCard').innerHTML = current
      ? `<strong>${escapeHtml(current.name)}</strong><span>Matrícula ${escapeHtml(current.registration)} · ${escapeHtml(state.shift)}º turno</span>`
      : '<strong>Nenhum operador conectado</strong>';
  }

  function renderSessionSummary() {
    const current = user();
    const list = assignments();
    el('sessionContextSummary').innerHTML = current
      ? `<div><div class="session-user-name">${escapeHtml(current.name)}</div><div class="session-user-meta">Matrícula ${escapeHtml(current.registration)} · ${escapeHtml(state.shift)}º turno · ${localDateKey().split('-').reverse().join('/')}</div></div><span class="session-machine-count">${list.length} máquina${list.length === 1 ? '' : 's'}</span>`
      : '<div><div class="session-user-name">Operador não identificado</div><div class="session-user-meta">Abra o menu para entrar</div></div>';
  }

  function applyAssignments(list) {
    const normalized = list.map((item, index) => ({
      slotId: `daily-slot-${index + 1}`,
      lineId: item.lineId,
      machineId: item.machineId
    }));
    state.dailyMachineAssignments[key()] = normalized;
    normalized.forEach(item => {
      state.slots[item.slotId] = { lineId: item.lineId, machineId: item.machineId };
      state.drafts[item.slotId] = state.drafts[item.slotId] || {};
    });
    if (!normalized.some(item => item.slotId === state.activeSlot)) state.activeSlot = normalized[0]?.slotId || 'm1';
    persistState();
    renderMachineTabs();
    renderContextSelectors();
    renderSessionSummary();
    renderOverview();
    renderLatest();
    updateCalculations();
  }

  renderMachineTabs = function renderDailyMachines() {
    const list = assignments();
    const container = el('machineTabs');
    if (!list.length) {
      container.innerHTML = '<button class="machine-tab select-machines" type="button" data-add><strong>Selecionar máquinas</strong><span>Escolha pelo menos três para iniciar</span></button>';
    } else {
      container.innerHTML = list.map((item, index) => {
        const machine = getMachine(item.lineId, item.machineId);
        const line = getLine(item.lineId);
        return `<button class="machine-tab${item.slotId === state.activeSlot ? ' active' : ''}" type="button" data-slot="${escapeHtml(item.slotId)}"><strong>${escapeHtml(machine?.name || `Máquina ${index + 1}`)}</strong><span>${escapeHtml(line?.name || '')}</span></button>`;
      }).join('') + '<button class="machine-tab add-machine" type="button" data-add><strong>＋</strong><span>Adicionar</span></button>';
    }
    container.querySelectorAll('[data-slot]').forEach(button => button.addEventListener('click', () => switchSlot(button.dataset.slot)));
    container.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', openAssignments));
  };

  switchSlot = function switchDailyMachine(slotId) {
    if (!assignments().some(item => item.slotId === slotId) || state.activeSlot === slotId) return;
    originalSaveDraft();
    state.activeSlot = slotId;
    originalLoadDraft();
    renderMachineTabs();
    renderContextSelectors();
    fillFromConference(conference(), false);
    renderOverview();
    updateCalculations();
    renderLatest();
    persistState();
  };

  function renderAssignments() {
    const body = el('assignmentBody');
    if (assignmentMode === 'lines') {
      body.innerHTML = `<div class="assignment-progress">Máquina ${assignmentDraft.length + 1}</div><p class="selector-title">Escolha a linha</p><div class="selector-grid">${state.catalog.map(line => `<button class="selector-card" type="button" data-line="${escapeHtml(line.id)}"><strong>${escapeHtml(line.name)}</strong><span>${line.machines?.length || 0} equipamentos</span></button>`).join('')}</div>${assignmentDraft.length ? '<div class="modal-actions"><button class="btn btn-ghost" type="button" data-review>Voltar</button></div>' : ''}`;
      return;
    }
    if (assignmentMode === 'machines') {
      const line = getLine(selectedLineId);
      const used = new Set(assignmentDraft.map(item => item.machineId));
      body.innerHTML = `<div class="assignment-progress">Máquina ${assignmentDraft.length + 1}</div><p class="selector-title">${escapeHtml(line?.name || '')} · escolha a máquina</p><div class="selector-grid">${(line?.machines || []).map(machine => `<button class="selector-card" type="button" data-machine="${escapeHtml(machine.id)}" ${used.has(machine.id) ? 'disabled' : ''}><strong>${escapeHtml(machine.name)}</strong><span>${escapeHtml(machine.equipmentType || 'TNL')}</span></button>`).join('')}</div><div class="modal-actions"><button class="btn btn-ghost" type="button" data-lines>Voltar às linhas</button></div>`;
      return;
    }
    const remaining = Math.max(MIN_MACHINES - assignmentDraft.length, 0);
    body.innerHTML = `<p class="modal-note">Essa escolha vale para o operador, a data e o turno atual.</p><div class="assignment-selected-list">${assignmentDraft.map((item, index) => { const line = getLine(item.lineId); const machine = getMachine(item.lineId, item.machineId); return `<div class="assignment-selected"><span class="assignment-order">${index + 1}</span><div><strong>${escapeHtml(machine?.name || '')}</strong><span>${escapeHtml(line?.name || '')}</span></div><button class="assignment-remove" type="button" data-remove="${index}">×</button></div>`; }).join('') || '<div class="empty">Nenhuma máquina selecionada.</div>'}</div>${remaining ? `<div class="conference-context">Selecione mais ${remaining} máquina${remaining === 1 ? '' : 's'}.</div>` : ''}<div class="modal-actions"><button class="btn btn-ghost" type="button" data-add-machine ${assignmentDraft.length >= MAX_MACHINES ? 'disabled' : ''}>＋ Adicionar</button><button class="btn btn-primary" type="button" data-finish ${assignmentDraft.length < MIN_MACHINES ? 'disabled' : ''}>Concluir</button></div>`;
  }

  function openAssignments() {
    assignmentDraft = assignments().map(item => ({ lineId: item.lineId, machineId: item.machineId }));
    assignmentMode = assignmentDraft.length ? 'review' : 'lines';
    selectedLineId = '';
    renderAssignments();
    layer('mainMenuLayer', false);
    layer('assignmentLayer', true);
  }

  async function saveAssignments() {
    if (assignmentDraft.length < MIN_MACHINES) return;
    applyAssignments(assignmentDraft);
    layer('assignmentLayer', false);
    if (CLOUD_API_URL) {
      try {
        await api('/api/v1/assignments', { method: 'POST', body: JSON.stringify({ productionDate: localDateKey(), shift: state.shift, registration: user().registration, operatorName: user().name, assignments: assignmentDraft }) });
      } catch (error) {
        console.error(error);
        showToast('Máquinas salvas localmente; sincronização pendente.');
      }
    }
    showToast('Máquinas do turno definidas.');
  }

  async function loadAssignments() {
    let list = assignments();
    if (CLOUD_API_URL) {
      try {
        const params = new URLSearchParams({ productionDate: localDateKey(), shift: state.shift, registration: user().registration });
        const payload = await api(`/api/v1/assignments?${params.toString()}`);
        if (payload?.assignments?.length) list = payload.assignments;
      } catch (error) {
        console.error(error);
      }
    }
    if (list.length) applyAssignments(list);
    else openAssignments();
  }

  function confValues() {
    return {
      op: el('confOp').value.trim(), item: el('confItem').value.trim(), sequence: el('confSequence').value.trim(),
      cycle: parseTempo(el('confCycle').value), f1: toNum(el('confFrequency1').value), f2: toNum(el('confFrequency2').value),
      opening: toNum(el('confOpening').value), minutes: toNum(el('confMinutes').value)
    };
  }

  function renderConfPreview() {
    const values = confValues();
    const target = values.cycle > 0 && values.minutes > 0 ? values.minutes / values.cycle : NaN;
    const m1 = Number.isFinite(target) && values.f1 > 0 ? Math.ceil(target / values.f1) : NaN;
    const m2 = Number.isFinite(target) && values.f2 > 0 ? Math.ceil(target / values.f2) : NaN;
    el('conferencePreview').innerHTML = `<div><span>Meta</span><strong>${fmtNum(target, 1)}</strong></div><div><span>Medições I</span><strong>${fmtNum(m1, 0)}</strong></div><div><span>Medições II</span><strong>${fmtNum(m2, 0)}</strong></div>`;
  }

  async function loadHandoff() {
    const machine = getCurrentContext().machine;
    const op = el('confOp').value.trim();
    if (!CLOUD_API_URL || !machine || !op) return;
    try {
      const params = new URLSearchParams({ machineId: machine.id, opNumber: op });
      handoffData = await api(`/api/v1/shift-context?${params.toString()}`);
      const last = handoffData?.lastSession;
      if (last && !el('confOpening').value) el('confOpening').value = String(last.finalProduction ?? 0);
      el('conferenceHandoff').textContent = last ? `Último apontamento: ${last.finalProduction ?? 0} peças · ${last.shift}º turno · ${last.operatorName}. Produzido nos turnos registrados: ${handoffData.producedTotal || 0}.` : 'Nenhum apontamento anterior encontrado para esta OP nesta máquina.';
      renderConfPreview();
    } catch (error) {
      el('conferenceHandoff').textContent = 'Não foi possível consultar a passagem de turno agora.';
    }
  }

  function openConference() {
    const { line, machine } = getCurrentContext();
    if (!machine) return showToast('Selecione uma máquina primeiro.');
    const current = conference();
    handoffData = current?.handoff || null;
    el('conferenceMachineContext').textContent = `${machine.name} · ${line?.name || ''} · ${state.shift}º turno · ${user()?.name || ''}`;
    el('confOp').value = current?.opNumber || el('f_op').value || '';
    el('confItem').value = current?.itemNumber || el('f_item').value || '';
    el('confSequence').value = current?.sequence || el('f_seq').value || '';
    el('confCycle').value = current?.cycleTimeSeconds ? fmtTimeFromSeconds(current.cycleTimeSeconds) : (el('f_tempo').value || '');
    el('confFrequency1').value = current?.frequency1 ?? (el('f_freq1').value || '');
    el('confFrequency2').value = current?.frequency2 ?? (el('f_freq2').value || '');
    el('confOpening').value = current?.openingProduction ?? '';
    el('confMinutes').value = current?.availableMinutes ?? (el('f_minutos').value || '480');
    el('conferenceHandoff').textContent = current?.handoffText || 'Digite a OP para consultar os turnos anteriores.';
    renderConfPreview();
    layer('mainMenuLayer', false);
    layer('conferenceLayer', true);
    if (el('confOp').value) loadHandoff();
  }

  function fillFromConference(current, force) {
    if (!current) return;
    const put = (id, value) => { const input = el(id); if (input && value !== null && value !== undefined && value !== '' && (force || !input.value)) input.value = String(value); };
    put('f_op', current.opNumber); put('f_item', current.itemNumber); put('f_seq', current.sequence);
    put('f_tempo', fmtTimeFromSeconds(current.cycleTimeSeconds)); put('f_freq1', current.frequency1); put('f_freq2', current.frequency2);
    put('f_pecas', current.openingProduction ?? 0); put('f_minutos', current.availableMinutes ?? 480);
    updateCalculations(); originalSaveDraft();
  }

  async function saveConference(event) {
    event.preventDefault();
    const values = confValues();
    const { line, machine } = getCurrentContext();
    if (!values.op || !values.item || !Number.isFinite(values.cycle) || values.cycle <= 0) {
      el('conferenceMessage').textContent = 'Informe OP, item e tempo de ciclo válido.';
      el('conferenceMessage').className = 'form-message show error';
      return;
    }
    const minutes = Number.isFinite(values.minutes) && values.minutes > 0 ? values.minutes : 480;
    const now = new Date().toISOString();
    const current = conference();
    const data = {
      id: `shift-${localDateKey()}-${state.shift}-${user().registration}-${machine.id}-${values.op}`.replace(/[^a-zA-Z0-9-_]/g, '-'),
      productionDate: localDateKey(), shift: state.shift, registration: user().registration, operatorName: user().name,
      lineId: line.id, lineName: line.name, machineId: machine.id, machineName: machine.name,
      opNumber: values.op, itemNumber: values.item, sequence: values.sequence,
      cycleTimeSeconds: Math.round(values.cycle * 60), frequency1: Number.isFinite(values.f1) ? values.f1 : null, frequency2: Number.isFinite(values.f2) ? values.f2 : null,
      openingProduction: Number.isFinite(values.opening) ? values.opening : 0, availableMinutes: minutes, target: minutes / values.cycle,
      finalProduction: current?.finalProduction ?? null, status: current?.status || 'open', openedAt: current?.openedAt || now, closedAt: current?.closedAt || null,
      handoff: handoffData, handoffText: el('conferenceHandoff').textContent, updatedAt: now
    };
    state.shiftConferences[confKey(machine.id)] = data;
    persistState(); fillFromConference(data, true); renderOverview(); layer('conferenceLayer', false);
    if (CLOUD_API_URL) api('/api/v1/shift-sessions', { method: 'POST', body: JSON.stringify(data) }).catch(console.error);
    showToast(`${machine.name} conferida.`);
  }

  function renderOverview() {
    const card = el('shiftOverviewCard');
    const { line, machine } = getCurrentContext();
    const current = conference();
    if (!machine) return card.innerHTML = '<div class="empty">Selecione as máquinas do turno para começar.</div>';
    if (!current) {
      card.innerHTML = `<div class="shift-overview-head"><div><p class="section-kicker">Conferência inicial</p><div class="shift-machine-title">${escapeHtml(machine.name)}</div><div class="shift-machine-sub">${escapeHtml(line?.name || '')}</div></div><span class="shift-status pending">Pendente</span></div><div class="shift-handoff">Confirme a OP, o item, o ciclo, as frequências, a produção recebida e a meta.</div><div class="shift-overview-actions"><button class="btn btn-primary" id="openConferenceButton" type="button">Conferir máquina</button></div>`;
      el('openConferenceButton').addEventListener('click', openConference); return;
    }
    const produced = current.finalProduction === null || current.finalProduction === undefined ? null : Math.max(Number(current.finalProduction) - Number(current.openingProduction || 0), 0);
    const measure1 = current.frequency1 > 0 ? Math.ceil(current.target / current.frequency1) : NaN;
    const measure2 = current.frequency2 > 0 ? Math.ceil(current.target / current.frequency2) : NaN;
    card.innerHTML = `<div class="shift-overview-head"><div><p class="section-kicker">Conferência inicial</p><div class="shift-machine-title">${escapeHtml(machine.name)} · OP ${escapeHtml(current.opNumber)}</div><div class="shift-machine-sub">Item ${escapeHtml(current.itemNumber)} · ${escapeHtml(line?.name || '')}</div></div><span class="shift-status ${current.status === 'closed' ? 'closed' : 'open'}">${current.status === 'closed' ? 'Apontado' : 'Conferida'}</span></div><div class="shift-metrics"><div class="shift-metric"><span>Recebido</span><strong>${fmtNum(Number(current.openingProduction), 0)}</strong></div><div class="shift-metric"><span>Meta</span><strong>${fmtNum(Number(current.target), 1)}</strong></div><div class="shift-metric"><span>Ciclo</span><strong>${fmtTimeFromSeconds(current.cycleTimeSeconds)}</strong></div><div class="shift-metric"><span>Medições I</span><strong>${fmtNum(measure1, 0)}</strong></div><div class="shift-metric"><span>Medições II</span><strong>${fmtNum(measure2, 0)}</strong></div><div class="shift-metric"><span>Produzido</span><strong>${produced === null ? '–' : fmtNum(produced, 0)}</strong></div></div><div class="shift-handoff">${escapeHtml(current.handoffText || 'A passagem será atualizada após o apontamento final.')}</div><div class="shift-overview-actions"><button class="btn btn-ghost" id="editConferenceButton" type="button">Editar conferência</button></div>`;
    el('editConferenceButton').addEventListener('click', openConference);
  }

  async function closeAfterSave(snapshot) {
    if (!el('formMessage')?.classList.contains('success') || !snapshot.current || !Number.isFinite(snapshot.final)) return;
    snapshot.current.finalProduction = snapshot.final; snapshot.current.status = 'closed'; snapshot.current.closedAt = new Date().toISOString(); snapshot.current.updatedAt = snapshot.current.closedAt;
    state.shiftConferences[confKey(snapshot.machineId)] = snapshot.current; persistState(); renderOverview();
    if (CLOUD_API_URL) api('/api/v1/shift-sessions', { method: 'POST', body: JSON.stringify(snapshot.current) }).catch(console.error);
  }

  async function login(event) {
    event.preventDefault();
    const name = el('loginName').value.trim(), registration = el('loginRegistration').value.trim(), shift = el('loginShift').value;
    if (!name || !registration) { el('loginMessage').textContent = 'Informe nome e matrícula.'; el('loginMessage').className = 'form-message show error'; return; }
    let operator = { id: `operator-${registration}`, name, registration, defaultShift: shift };
    if (CLOUD_API_URL) { try { const payload = await api('/api/v1/session/login', { method: 'POST', body: JSON.stringify({ name, registration, shift }) }); operator = payload.operator || operator; } catch (error) { console.error(error); } }
    state.sessionUser = operator; state.shift = String(operator.defaultShift || shift); syncLegacyFields(); renderMenu(); renderSessionSummary(); layer('loginLayer', false); await loadAssignments();
  }

  function logout() {
    layer('mainMenuLayer', false); state.sessionUser = null; state.operatorName = ''; state.operatorRegistration = ''; persistState();
    el('loginName').value = ''; el('loginRegistration').value = ''; el('loginShift').value = detectShift(); renderSessionSummary(); renderMachineTabs(); layer('loginLayer', true);
  }

  function bind() {
    el('loginForm').addEventListener('submit', login);
    el('assignmentBody').addEventListener('click', event => {
      const lineButton = event.target.closest('[data-line]'), machineButton = event.target.closest('[data-machine]'), removeButton = event.target.closest('[data-remove]');
      if (lineButton) { selectedLineId = lineButton.dataset.line; assignmentMode = 'machines'; renderAssignments(); }
      else if (machineButton) { assignmentDraft.push({ lineId: selectedLineId, machineId: machineButton.dataset.machine }); selectedLineId = ''; assignmentMode = assignmentDraft.length < MIN_MACHINES ? 'lines' : 'review'; renderAssignments(); }
      else if (removeButton) { assignmentDraft.splice(Number(removeButton.dataset.remove), 1); renderAssignments(); }
      else if (event.target.closest('[data-add-machine]')) { assignmentMode = 'lines'; renderAssignments(); }
      else if (event.target.closest('[data-review]')) { assignmentMode = 'review'; renderAssignments(); }
      else if (event.target.closest('[data-lines]')) { assignmentMode = 'lines'; renderAssignments(); }
      else if (event.target.closest('[data-finish]')) saveAssignments();
    });
    el('conferenceForm').addEventListener('submit', saveConference);
    ['confCycle','confFrequency1','confFrequency2','confMinutes'].forEach(id => el(id).addEventListener('input', renderConfPreview));
    el('confOp').addEventListener('blur', loadHandoff);
    el('menuMachines').addEventListener('click', openAssignments); el('menuConference').addEventListener('click', openConference);
    el('menuSync').addEventListener('click', async () => { layer('mainMenuLayer', false); await checkCloudConnection(); showToast('Sincronização solicitada.'); });
    el('menuLogout').addEventListener('click', logout);
    el('btnSave').addEventListener('click', () => { const fields = getFormFields(); const snapshot = { current: conference(), machineId: currentSlot()?.machineId, final: fields.finalProduction }; setTimeout(() => closeAfterSave(snapshot), 350); }, true);
  }

  async function start() {
    renderSessionSummary(); renderOverview();
    if (user()?.name && user()?.registration) { syncLegacyFields(); await loadAssignments(); fillFromConference(conference(), false); }
    else { el('loginName').value = state.operatorName || ''; el('loginRegistration').value = state.operatorRegistration || ''; el('loginShift').value = state.shift || detectShift(); layer('loginLayer', true); }
  }

  buildUi(); setupHeader(); setupContext(); bind(); renderMachineTabs(); start();
})();
