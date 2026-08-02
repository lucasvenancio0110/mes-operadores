(() => {
  const saveButton = document.getElementById('btnSave');
  const productionCard = saveButton?.closest('.card');
  const digitalPanel = document.querySelector('.digital-panel');
  const overviewCard = document.getElementById('shiftOverviewCard');

  if (!saveButton || !productionCard || !digitalPanel || !overviewCard) return;

  const layer = document.createElement('div');
  layer.id = 'productionEntryLayer';
  layer.className = 'app-layer production-entry-layer';
  layer.innerHTML = `
    <section class="app-modal wide production-entry-modal" role="dialog" aria-modal="true" aria-labelledby="productionEntryTitle">
      <header class="production-entry-header">
        <div>
          <p class="section-kicker">Apontamento do turno</p>
          <h2 id="productionEntryTitle">Apontar produção</h2>
          <p id="productionEntryContext" class="production-entry-context"></p>
        </div>
        <button class="modal-close" id="closeProductionEntry" type="button" aria-label="Fechar apontamento">×</button>
      </header>
      <div id="productionEntryContent" class="production-entry-content"></div>
    </section>`;
  document.body.appendChild(layer);

  const content = document.getElementById('productionEntryContent');
  content.appendChild(digitalPanel);
  content.appendChild(productionCard);

  function currentMachineLabel() {
    try {
      const context = getCurrentContext();
      const machine = context?.machine?.name || 'Máquina selecionada';
      const line = context?.line?.name || '';
      const op = document.getElementById('f_op')?.value?.trim();
      return [machine, line, op ? `OP ${op}` : ''].filter(Boolean).join(' · ');
    } catch {
      return 'Máquina selecionada';
    }
  }

  function openProductionEntry() {
    document.getElementById('productionEntryContext').textContent = currentMachineLabel();
    layer.classList.add('is-open');
    document.body.classList.add('production-entry-open');
    document.body.style.overflow = 'hidden';
    layer.scrollTop = 0;
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

  function enhanceOverview() {
    overviewCard.querySelector('#openProductionEntryButton')?.remove();
    const actions = overviewCard.querySelector('.shift-overview-actions');
    if (!actions || !conferenceReady()) return;

    const button = document.createElement('button');
    button.id = 'openProductionEntryButton';
    button.type = 'button';
    button.className = 'btn btn-primary production-entry-trigger';
    button.textContent = overviewCard.querySelector('.shift-status.closed')
      ? 'Novo apontamento'
      : 'Apontar produção';
    button.addEventListener('click', openProductionEntry);
    actions.prepend(button);
  }

  document.getElementById('closeProductionEntry').addEventListener('click', closeProductionEntry);
  layer.addEventListener('click', event => {
    if (event.target === layer) closeProductionEntry();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && layer.classList.contains('is-open')) closeProductionEntry();
  });

  saveButton.addEventListener('click', () => {
    window.setTimeout(() => {
      const message = document.getElementById('formMessage');
      if (message?.classList.contains('success')) {
        closeProductionEntry();
        window.scrollTo({ top: overviewCard.offsetTop - 12, behavior: 'smooth' });
      }
    }, 180);
  });

  const observer = new MutationObserver(enhanceOverview);
  observer.observe(overviewCard, { childList: true, subtree: true });
  enhanceOverview();
})();
