(() => {
  const saveButton = document.getElementById('btnSave');
  const legacyProductionCard = saveButton?.closest('.card');
  const legacyDigitalPanel = document.querySelector('.digital-panel');
  const overviewCard = document.getElementById('shiftOverviewCard');

  if (!saveButton || !legacyProductionCard || !legacyDigitalPanel || !overviewCard) return;

  legacyProductionCard.classList.add('legacy-production-form');
  legacyDigitalPanel.classList.add('legacy-production-panel');

  let currentSnapshot = null;
  let closingOrder = false;

  const layer = document.createElement('div');
  layer.id = 'productionEntryLayer';
  layer.className = 'app-layer production-entry-layer';
  layer.innerHTML = `
    <section class="production-entry-modal" role="dialog" aria-modal="true" aria-labelledby="productionEntryTitle">
      <header class="production-entry-header">
        <div>
          <p class="section-kicker">Apontamento do turno</p>
          <h2 id="productionEntryTitle">Confirmar apontamento</h2>
          <p id="productionEntryContext" class="production-entry-context"></p>
        </div>
        <button class="modal-close" id="closeProductionEntry" type="button" aria-label="Fechar apontamento">×</button>
      </header>

      <div class="production-entry-body" id="productionEntryMain">
        <section class="pointing-card order-summary-card">
          <div class="pointing-card-head">
            <div><span class="pointing-eyebrow">Ordem em produção</span><strong id="pointingOrderTitle">—</strong></div>
            <span class="pointing-status">Em produção</span>
          </div>
          <div class="order-data-grid">
            <div><span>Item</span><strong id="pointingItem">—</strong></div>
            <div><span>Ciclo</span><strong id="pointingCycle">—</strong></div>
            <div><span>Freq. I</span><strong id="pointingFrequency1">—</strong></div>
            <div><span>Freq. II</span><strong id="pointingFrequency2">—</strong></div>
            <div class="wide"><span>Minutos disponíveis</span><strong id="pointingMinutes">—</strong></div>
          </div>
        </section>

        <section class="pointing-card progress-card">
          <p class="pointing-section-title">Situação da produção</p>
          <div class="production-progress-grid">
            <div class="progress-metric featured">
              <span>Peças produzidas até agora</span>
              <strong id="piecesProducedSoFar">0</strong>
            </div>
            <div class="progress-metric">
              <span>Meta deste turno</span>
              <strong id="pointingTarget">—</strong>
            </div>
            <div class="progress-metric">
              <span>Previsão ao final</span>
              <strong id="pointingExpectedTotal">—</strong>
            </div>
          </div>
        </section>

        <section class="pointing-card pointing-input-card">
          <p class="pointing-section-title">Seu apontamento</p>
          <label class="pointing-main-label" for="piecesThisShift">Peças produzidas neste turno</label>
          <input class="pointing-main-input" id="piecesThisShift" type="text" inputmode="numeric" autocomplete="off" placeholder="Ex.: 95">
          <p class="pointing-help">Informe somente o que foi produzido no seu turno. O total da OP será calculado automaticamente.</p>

          <label class="pointing-notes-label" for="pointingNotes">Observações <span>opcional</span></label>
          <textarea id="pointingNotes" rows="3" placeholder="Paradas, motivo ou atuação realizada..."></textarea>

          <div class="pointing-result" id="pointingResult" aria-live="polite">
            <div><span>Total após este apontamento</span><strong id="totalAfterPointing">—</strong></div>
            <div><span>Saldo da meta</span><strong id="pointingBalance">—</strong></div>
          </div>
          <div class="form-message" id="pointingMessage" aria-live="polite"></div>
        </section>

        <div class="pointing-actions">
          <button class="btn btn-primary" id="confirmPointing" type="button">Confirmar apontamento</button>
          <button class="btn btn-danger-outline" id="requestCloseOrder" type="button">Encerrar ordem</button>
        </div>
      </div>

      <div class="production-entry-body is-hidden" id="closeOrderConfirm">
        <section class="pointing-card confirm-order-card">
          <span class="pointing-eyebrow danger">Encerramento da ordem</span>
          <h3>Encerrar esta OP?</h3>
          <p id="closeOrderText"></p>
          <div class="order-close-summary">
            <div><span>Produzidas neste turno</span><strong id="closeProducedValue">0</strong></div>
            <div><span>Total da OP</span><strong id="closeTotalValue">0</strong></div>
          </div>
          <p class="pointing-help">O apontamento será confirmado e a ordem ficará encerrada nesta máquina.</p>
        </section>
        <div class="pointing-actions">
          <button class="btn btn-primary" id="confirmCloseOrder" type="button">Confirmar encerramento</button>
          <button class="btn btn-ghost" id="cancelCloseOrder" type="button">Voltar</button>
        </div>
      </div>

      <div class="production-entry-body is-hidden" id="nextOrderPanel">
        <section class="pointing-card next-order-card">
          <span class="pointing-eyebrow">Ordem encerrada</span>
          <h3>O que será iniciado agora?</h3>
          <p>Escolha a próxima situação da máquina.</p>
          <div class="next-order-options">
            <button type="button" id="nextSameItem"><strong>Nova OP com o mesmo item</strong><span>Mantém ciclo e frequências</span></button>
            <button type="button" id="nextOtherItem"><strong>Nova OP com outro item</strong><span>Faz uma nova conferência</span></button>
            <button type="button" id="machineStopped"><strong>Máquina ficará parada</strong><span>Nenhuma nova ordem agora</span></button>
          </div>
        </section>
      </div>
    </section>`;
  document.body.appendChild(layer);

  const byId = id => document.getElementById(id);
  const mainPanel = byId('productionEntryMain');
  const closePanel = byId('closeOrderConfirm');
  const nextPanel = byId('nextOrderPanel');
  const piecesInput = byId('piecesThisShift');
  const notesInput = byId('pointingNotes');

  function numberFrom(value) {
    const parsed = Number.parseFloat(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function conferenceKey() {
    const registration = state.sessionUser?.registration || state.operatorRegistration || '';
    const machineId = currentSlot()?.machineId || '';
    return registration && machineId
      ? `${localDateKey()}|${state.shift}|${registration}|${machineId}`
      : '';
  }

  function currentConference() {
    const key = conferenceKey();
    return key ? state.shiftConferences?.[key] || null : null;
  }

  function latestKnownTotal(op, machineId) {
    const records = (state.records || [])
      .filter(record => record.status !== 'cancelled')
      .filter(record => record.machineId === machineId && String(record.op) === String(op))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latest = records[0];
    const value = numberFrom(latest?.totalAfterPointing ?? latest?.finalProduction);
    return Number.isFinite(value) ? value : NaN;
  }

  function getSnapshot() {
    const context = getCurrentContext();
    const conference = currentConference();
    const op = conference?.opNumber || byId('f_op')?.value?.trim() || '';
    const item = conference?.itemNumber || byId('f_item')?.value?.trim() || '';
    const storedOpening = numberFrom(conference?.openingProduction ?? byId('f_pecas')?.value);
    const latestTotal = latestKnownTotal(op, context.machine?.id);
    const producedSoFar = Number.isFinite(latestTotal)
      ? latestTotal
      : Number.isFinite(storedOpening) ? storedOpening : 0;
    const cycleMinutes = conference?.cycleTimeSeconds
      ? Number(conference.cycleTimeSeconds) / 60
      : parseTempo(byId('f_tempo')?.value);
    const minutes = numberFrom(conference?.availableMinutes ?? byId('f_minutos')?.value);
    const target = Number.isFinite(Number(conference?.target))
      ? Number(conference.target)
      : cycleMinutes > 0 ? (Number.isFinite(minutes) && minutes > 0 ? minutes : 480) / cycleMinutes : NaN;

    return {
      context,
      conference,
      op,
      item,
      producedSoFar,
      cycleMinutes,
      cycleText: conference?.cycleTimeSeconds
        ? fmtTimeFromSeconds(Number(conference.cycleTimeSeconds))
        : fmtTimeFromMinutes(cycleMinutes),
      frequency1: numberFrom(conference?.frequency1 ?? byId('f_freq1')?.value),
      frequency2: numberFrom(conference?.frequency2 ?? byId('f_freq2')?.value),
      minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 480,
      target
    };
  }

  function renderSnapshot() {
    currentSnapshot = getSnapshot();
    const { context, op, item, cycleText, frequency1, frequency2, minutes, producedSoFar, target } = currentSnapshot;
    const machine = context.machine?.name || 'Máquina';
    const line = context.line?.name || '';

    byId('productionEntryContext').textContent = [machine, line, op ? `OP ${op}` : ''].filter(Boolean).join(' · ');
    byId('pointingOrderTitle').textContent = `${machine}${op ? ` · OP ${op}` : ''}`;
    byId('pointingItem').textContent = item || '—';
    byId('pointingCycle').textContent = cycleText || '—';
    byId('pointingFrequency1').textContent = Number.isFinite(frequency1) ? fmtNum(frequency1, 3) : '—';
    byId('pointingFrequency2').textContent = Number.isFinite(frequency2) ? fmtNum(frequency2, 3) : '—';
    byId('pointingMinutes').textContent = `${fmtNum(minutes, 0)} min`;
    byId('piecesProducedSoFar').textContent = fmtNum(producedSoFar, 0);
    byId('pointingTarget').textContent = fmtNum(target, 1);
    byId('pointingExpectedTotal').textContent = Number.isFinite(target)
      ? fmtNum(producedSoFar + target, 1)
      : '—';

    piecesInput.value = '';
    notesInput.value = '';
    byId('pointingMessage').textContent = '';
    byId('pointingMessage').className = 'form-message';
    updateResult();
  }

  function updateResult() {
    const produced = numberFrom(piecesInput.value);
    const hasValue = piecesInput.value.trim() !== '' && Number.isFinite(produced) && produced >= 0;
    const total = hasValue ? currentSnapshot.producedSoFar + produced : NaN;
    const balance = hasValue && Number.isFinite(currentSnapshot.target)
      ? produced - currentSnapshot.target
      : NaN;

    byId('totalAfterPointing').textContent = Number.isFinite(total) ? fmtNum(total, 0) : '—';
    const balanceElement = byId('pointingBalance');
    balanceElement.textContent = Number.isFinite(balance)
      ? `${balance > 0 ? '+' : ''}${fmtNum(balance, 1)}`
      : '—';
    balanceElement.className = balance > 0 ? 'positive' : balance < 0 ? 'negative' : '';

    byId('confirmPointing').disabled = !hasValue;
    byId('requestCloseOrder').disabled = !hasValue;
  }

  function fillLegacyForm(producedThisShift) {
    const totalAfter = currentSnapshot.producedSoFar + producedThisShift;
    const conference = currentSnapshot.conference;

    byId('f_op').value = currentSnapshot.op;
    byId('f_item').value = currentSnapshot.item;
    byId('f_pecas').value = String(currentSnapshot.producedSoFar);
    byId('f_final').value = String(totalAfter);
    byId('f_tempo').value = currentSnapshot.cycleText;
    byId('f_freq1').value = Number.isFinite(currentSnapshot.frequency1) ? String(currentSnapshot.frequency1) : '';
    byId('f_freq2').value = Number.isFinite(currentSnapshot.frequency2) ? String(currentSnapshot.frequency2) : '';
    byId('f_minutos').value = String(currentSnapshot.minutes);
    byId('f_obs').value = notesInput.value.trim();
    if (byId('f_seq')) byId('f_seq').value = '';

    if (conference) conference.openingProduction = currentSnapshot.producedSoFar;
    updateCalculations();
    saveDraft();
    return totalAfter;
  }

  function patchSavedRecord(producedThisShift, totalAfter, eventType) {
    const record = [...(state.records || [])]
      .reverse()
      .find(item => item.machineId === currentSnapshot.context.machine?.id && String(item.op) === String(currentSnapshot.op));
    if (!record) return;

    const balance = Number.isFinite(currentSnapshot.target)
      ? producedThisShift - currentSnapshot.target
      : null;
    record.pieces = currentSnapshot.producedSoFar;
    record.producedBefore = currentSnapshot.producedSoFar;
    record.producedThisShift = producedThisShift;
    record.totalAfterPointing = totalAfter;
    record.finalProduction = totalAfter;
    record.expectedProduction = Number.isFinite(currentSnapshot.target)
      ? currentSnapshot.producedSoFar + currentSnapshot.target
      : null;
    record.balance = Number.isFinite(balance) ? balance : null;
    record.balanceMinutes = Number.isFinite(balance) && Number.isFinite(currentSnapshot.cycleMinutes)
      ? balance * currentSnapshot.cycleMinutes
      : null;
    record.eventType = eventType;
    record.orderStatus = eventType === 'order-close' ? 'closed' : 'open';
    record.updatedAt = new Date().toISOString();
    persistState();
    try { renderLatest(); } catch {}
    if (CLOUD_API_URL && typeof syncRecord === 'function') syncRecord(record).catch(console.error);
  }

  function showMessage(message, type = 'error') {
    const box = byId('pointingMessage');
    box.textContent = message;
    box.className = `form-message show ${type}`;
  }

  function submitPointing(eventType) {
    const produced = numberFrom(piecesInput.value);
    if (!Number.isFinite(produced) || produced < 0) {
      showMessage('Informe quantas peças foram produzidas neste turno.');
      piecesInput.focus();
      return;
    }

    closingOrder = eventType === 'order-close';
    const totalAfter = fillLegacyForm(produced);
    const previousLength = state.records.length;
    saveButton.click();

    window.setTimeout(() => {
      if (state.records.length <= previousLength) {
        const legacyMessage = byId('formMessage')?.textContent || 'Não foi possível confirmar o apontamento.';
        showMessage(legacyMessage);
        return;
      }

      patchSavedRecord(produced, totalAfter, eventType);
      if (closingOrder) {
        mainPanel.classList.add('is-hidden');
        closePanel.classList.add('is-hidden');
        nextPanel.classList.remove('is-hidden');
      } else {
        closeProductionEntry();
        showToast(`Apontamento confirmado: ${fmtNum(produced, 0)} peças.`);
        window.scrollTo({ top: overviewCard.offsetTop - 12, behavior: 'smooth' });
      }
    }, 220);
  }

  function openProductionEntry() {
    renderSnapshot();
    mainPanel.classList.remove('is-hidden');
    closePanel.classList.add('is-hidden');
    nextPanel.classList.add('is-hidden');
    layer.classList.add('is-open');
    document.body.classList.add('production-entry-open');
    document.body.style.overflow = 'hidden';
    layer.scrollTop = 0;
    window.setTimeout(() => piecesInput.focus(), 180);
  }

  function closeProductionEntry() {
    layer.classList.remove('is-open');
    document.body.classList.remove('production-entry-open');
    document.body.style.overflow = '';
  }

  function conferenceReady() {
    return Boolean(
      overviewCard.querySelector('.shift-status.open') ||
      overviewCard.querySelector('.shift-status.closed')
    );
  }

  function improveOverviewLanguage() {
    overviewCard.querySelectorAll('.shift-metric span').forEach(label => {
      const text = label.textContent.trim().toLowerCase();
      if (text === 'recebido') label.textContent = 'Produzidas até agora';
      if (text === 'produzido') label.textContent = 'Neste turno';
    });

    const handoff = overviewCard.querySelector('.shift-handoff');
    if (handoff && /produção recebida/i.test(handoff.textContent)) {
      handoff.textContent = 'Confirme a OP, o item, o ciclo, as frequências e a meta do turno.';
    }
  }

  function enhanceOverview() {
    improveOverviewLanguage();
    const actions = overviewCard.querySelector('.shift-overview-actions');
    const existingButton = overviewCard.querySelector('#openProductionEntryButton');

    if (!actions || !conferenceReady()) {
      existingButton?.remove();
      return;
    }

    if (existingButton) {
      existingButton.textContent = 'Confirmar apontamento';
      return;
    }

    const button = document.createElement('button');
    button.id = 'openProductionEntryButton';
    button.type = 'button';
    button.className = 'btn btn-primary production-entry-trigger';
    button.textContent = 'Confirmar apontamento';
    button.addEventListener('click', openProductionEntry);
    actions.prepend(button);
  }

  function clearConferenceForNextOrder() {
    const key = conferenceKey();
    if (key && state.shiftConferences) delete state.shiftConferences[key];
    persistState();
  }

  function openNextConference(keepItem) {
    const previous = currentSnapshot;
    clearConferenceForNextOrder();
    closeProductionEntry();

    const editButton = overviewCard.querySelector('#editConferenceButton');
    editButton?.click();
    window.setTimeout(() => {
      const opInput = byId('confOp');
      const itemInput = byId('confItem');
      if (opInput) opInput.value = '';
      if (itemInput) itemInput.value = keepItem ? previous.item : '';
      if (byId('confOpening')) byId('confOpening').value = '0';
      if (keepItem) {
        if (byId('confCycle')) byId('confCycle').value = previous.cycleText;
        if (byId('confFrequency1')) byId('confFrequency1').value = Number.isFinite(previous.frequency1) ? String(previous.frequency1) : '';
        if (byId('confFrequency2')) byId('confFrequency2').value = Number.isFinite(previous.frequency2) ? String(previous.frequency2) : '';
      } else {
        if (byId('confCycle')) byId('confCycle').value = '';
        if (byId('confFrequency1')) byId('confFrequency1').value = '';
        if (byId('confFrequency2')) byId('confFrequency2').value = '';
      }
      opInput?.focus();
    }, 120);
  }

  piecesInput.addEventListener('input', updateResult);
  byId('confirmPointing').addEventListener('click', () => submitPointing('shift-pointing'));
  byId('requestCloseOrder').addEventListener('click', () => {
    const produced = numberFrom(piecesInput.value);
    if (!Number.isFinite(produced) || produced < 0) {
      showMessage('Informe quantas peças foram produzidas antes de encerrar a ordem.');
      piecesInput.focus();
      return;
    }
    byId('closeOrderText').textContent = `OP ${currentSnapshot.op} · Item ${currentSnapshot.item}`;
    byId('closeProducedValue').textContent = fmtNum(produced, 0);
    byId('closeTotalValue').textContent = fmtNum(currentSnapshot.producedSoFar + produced, 0);
    mainPanel.classList.add('is-hidden');
    closePanel.classList.remove('is-hidden');
  });
  byId('cancelCloseOrder').addEventListener('click', () => {
    closePanel.classList.add('is-hidden');
    mainPanel.classList.remove('is-hidden');
  });
  byId('confirmCloseOrder').addEventListener('click', () => submitPointing('order-close'));
  byId('nextSameItem').addEventListener('click', () => openNextConference(true));
  byId('nextOtherItem').addEventListener('click', () => openNextConference(false));
  byId('machineStopped').addEventListener('click', () => {
    closeProductionEntry();
    showToast('Ordem encerrada. Máquina sem nova OP.');
  });
  byId('closeProductionEntry').addEventListener('click', closeProductionEntry);
  layer.addEventListener('click', event => {
    if (event.target === layer) closeProductionEntry();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && layer.classList.contains('is-open')) closeProductionEntry();
  });

  const overviewObserver = new MutationObserver(enhanceOverview);
  overviewObserver.observe(overviewCard, { childList: true, subtree: true });
  enhanceOverview();
})();
