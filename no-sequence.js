(() => {
  function hideField(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.value = '';
    input.setAttribute('value', '');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    const field = input.closest('.field');
    if (field) {
      field.classList.add('sequence-legacy-field');
      field.hidden = true;

      const row = field.parentElement;
      if (row?.classList.contains('row2')) {
        row.classList.add('sequence-free-row');
      }
    }
  }

  function clearSequenceValues() {
    const formSequence = document.getElementById('f_seq');
    const conferenceSequence = document.getElementById('confSequence');
    if (formSequence) formSequence.value = '';
    if (conferenceSequence) conferenceSequence.value = '';
  }

  function applySequenceRemoval() {
    hideField('f_seq');
    hideField('confSequence');
    clearSequenceValues();
  }

  // Limpa antes de qualquer salvamento, mesmo quando uma OP antiga possuir sequência.
  document.addEventListener('click', event => {
    if (event.target.closest('#btnSave, #btnTrocarOp, [type="submit"]')) {
      clearSequenceValues();
    }
  }, true);

  document.addEventListener('submit', clearSequenceValues, true);

  const observer = new MutationObserver(applySequenceRemoval);
  observer.observe(document.body, { childList: true, subtree: true });

  applySequenceRemoval();
})();
