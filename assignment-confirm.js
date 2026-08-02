(() => {
  const body = document.getElementById('assignmentBody');
  if (!body) return;

  let selectedCard = null;
  let bypassConfirmation = false;
  let refreshScheduled = false;

  const observer = new MutationObserver(() => scheduleRefresh());

  function observe() {
    // Observa somente a troca da tela do assistente. Alterações internas como
    // "Linha 5 selecionada" não devem reiniciar a seleção.
    observer.observe(body, { childList: true });
  }

  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      refreshConfirmation();
    });
  }

  function clearSelection() {
    selectedCard = null;
    body.querySelectorAll('.selector-card.is-selected').forEach(card => {
      card.classList.remove('is-selected');
      card.setAttribute('aria-pressed', 'false');
    });
  }

  function updateConfirmButton() {
    const button = body.querySelector('[data-confirm-selection]');
    if (!button) return;
    const hasSelection = Boolean(selectedCard);
    button.disabled = !hasSelection;
    button.classList.toggle('is-ready', hasSelection);
  }

  function selectionType() {
    if (body.querySelector('[data-line]')) return 'line';
    if (body.querySelector('[data-machine]')) return 'machine';
    return '';
  }

  function refreshConfirmation() {
    observer.disconnect();
    selectedCard = null;

    body.querySelector('.assignment-confirm-bar')?.remove();
    body.querySelectorAll('.selector-card').forEach(card => {
      card.classList.remove('is-selected');
      card.setAttribute('aria-pressed', 'false');
    });

    const type = selectionType();
    if (type) {
      const bar = document.createElement('div');
      bar.className = 'assignment-confirm-bar';
      bar.innerHTML = `
        <div class="assignment-confirm-status">
          <span class="assignment-confirm-dot"></span>
          <span>${type === 'line' ? 'Selecione uma linha' : 'Selecione uma máquina'}</span>
        </div>
        <button class="btn btn-primary assignment-confirm-button" type="button" data-confirm-selection disabled>
          ${type === 'line' ? 'Continuar' : 'Confirmar máquina'}
        </button>`;

      const grid = body.querySelector('.selector-grid');
      (grid?.parentNode || body).appendChild(bar);

      bar.querySelector('[data-confirm-selection]').addEventListener('click', () => {
        if (!selectedCard) return;
        const cardToConfirm = selectedCard;
        bypassConfirmation = true;
        cardToConfirm.click();
        bypassConfirmation = false;
      });
    } else {
      const finishButton = body.querySelector('[data-finish]');
      if (finishButton) finishButton.textContent = 'Salvar máquinas';
      body.querySelector('.modal-actions')?.classList.add('assignment-final-actions');
    }

    observe();
  }

  body.addEventListener('click', event => {
    const card = event.target.closest('[data-line], [data-machine]');
    if (!card || bypassConfirmation || card.disabled) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    clearSelection();
    selectedCard = card;
    card.classList.add('is-selected');
    card.setAttribute('aria-pressed', 'true');

    const status = body.querySelector('.assignment-confirm-status span:last-child');
    const title = card.querySelector('strong')?.textContent?.trim() || 'Opção';
    if (status) status.textContent = `${title} selecionada`;
    updateConfirmButton();
  }, true);

  refreshConfirmation();
})();
