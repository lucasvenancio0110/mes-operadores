(() => {
  const openingInput = document.getElementById('confOpening');
  const opInput = document.getElementById('confOp');
  const conferenceForm = document.getElementById('conferenceForm');
  const conferenceLayer = document.getElementById('conferenceLayer');

  if (!openingInput || !opInput || !conferenceForm) return;

  const openingField = openingInput.closest('.field');
  if (openingField) {
    openingField.classList.add('production-opening-legacy-field');
    openingField.hidden = true;
  }

  const indicator = document.createElement('div');
  indicator.id = 'conferenceProducedSoFar';
  indicator.className = 'conference-produced-so-far';
  indicator.innerHTML = '<span>Peças produzidas até agora</span><strong>0</strong><small>Calculado automaticamente pelos apontamentos da OP</small>';

  const handoff = document.getElementById('conferenceHandoff');
  if (handoff) handoff.insertAdjacentElement('beforebegin', indicator);
  else conferenceForm.prepend(indicator);

  function toNumber(value) {
    const parsed = Number.parseFloat(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function localKnownTotal() {
    const op = opInput.value.trim();
    const machineId = currentSlot()?.machineId || '';
    if (!op || !machineId) return 0;

    const record = [...(state.records || [])]
      .filter(item => item.status !== 'cancelled')
      .filter(item => item.machineId === machineId && String(item.op) === op)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    const total = toNumber(record?.totalAfterPointing ?? record?.finalProduction);
    return Number.isFinite(total) ? total : 0;
  }

  function refreshProducedSoFar() {
    const cloudOrSavedValue = toNumber(openingInput.value);
    const localValue = localKnownTotal();
    const total = Math.max(
      Number.isFinite(cloudOrSavedValue) ? cloudOrSavedValue : 0,
      localValue
    );

    openingInput.value = String(total);
    indicator.querySelector('strong').textContent = fmtNum(total, 0);

    const handoffText = document.getElementById('conferenceHandoff');
    if (handoffText && /nenhum apontamento anterior/i.test(handoffText.textContent) && total > 0) {
      handoffText.textContent = `Peças produzidas até agora nesta OP: ${fmtNum(total, 0)}.`;
    }
  }

  function scheduleRefresh() {
    [0, 120, 500, 1200, 2200].forEach(delay => window.setTimeout(refreshProducedSoFar, delay));
  }

  opInput.addEventListener('input', () => {
    openingInput.value = '';
    scheduleRefresh();
  });
  opInput.addEventListener('blur', scheduleRefresh);
  conferenceForm.addEventListener('submit', refreshProducedSoFar, true);

  if (conferenceLayer) {
    const observer = new MutationObserver(() => {
      if (conferenceLayer.classList.contains('is-open')) scheduleRefresh();
    });
    observer.observe(conferenceLayer, { attributes: true, attributeFilter: ['class'] });
  }

  const overview = document.getElementById('shiftOverviewCard');
  if (overview) {
    const improveLabels = () => {
      overview.querySelectorAll('.shift-metric span').forEach(label => {
        if (label.textContent.trim().toLowerCase() === 'recebido') {
          label.textContent = 'Produzidas até agora';
        }
      });
    };
    new MutationObserver(improveLabels).observe(overview, { childList: true, subtree: true });
    improveLabels();
  }

  refreshProducedSoFar();
})();
