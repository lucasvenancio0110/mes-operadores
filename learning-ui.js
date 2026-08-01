(() => {
  const operatorField = el('f_operator')?.closest('.field');
  const itemHint = el('hintItem');
  if (!operatorField || !itemHint) return;

  if (!el('f_registration')) {
    const registrationField = document.createElement('div');
    registrationField.className = 'field';
    registrationField.innerHTML = `
      <label for="f_registration">Matrícula</label>
      <input type="text" inputmode="numeric" id="f_registration" placeholder="Digite a matrícula">
      <div class="hint">O nome e a matrícula serão lembrados no banco após salvar o registro.</div>`;
    operatorField.insertAdjacentElement('afterend', registrationField);
  }

  if (!el('f_item_description')) {
    const descriptionField = document.createElement('div');
    descriptionField.className = 'field';
    descriptionField.innerHTML = `
      <label for="f_item_description">Descrição do item <span style="font-weight:400">(opcional)</span></label>
      <input type="text" id="f_item_description" placeholder="Ex.: Corpo implante GTPlus">
      <div class="hint">Tempo e frequências serão salvos para este item e para a máquina selecionada.</div>`;
    itemHint.insertAdjacentElement('afterend', descriptionField);
  }

  state.operatorRegistration = state.operatorRegistration || '';
  state.extraDrafts = state.extraDrafts || {};
  el('f_registration').value = state.operatorRegistration;

  const originalGetFormFields = getFormFields;
  getFormFields = function getFormFieldsWithLearning() {
    return {
      ...originalGetFormFields(),
      operatorRegistration: el('f_registration')?.value.trim() || '',
      itemDescription: el('f_item_description')?.value.trim() || ''
    };
  };

  const originalBuildRecord = buildRecord;
  buildRecord = function buildRecordWithLearning(fields) {
    return {
      ...originalBuildRecord(fields),
      operatorRegistration: fields.operatorRegistration || '',
      itemDescription: fields.itemDescription || ''
    };
  };

  const originalSaveDraft = saveDraft;
  saveDraft = function saveDraftWithLearning() {
    originalSaveDraft();
    state.extraDrafts[state.activeSlot] = {
      ...(state.extraDrafts[state.activeSlot] || {}),
      itemDescription: el('f_item_description')?.value || ''
    };
    persistState();
  };

  const originalLoadDraft = loadDraft;
  loadDraft = function loadDraftWithLearning() {
    originalLoadDraft();
    const extra = state.extraDrafts[state.activeSlot] || {};
    if (el('f_item_description')) {
      el('f_item_description').value = extra.itemDescription || '';
    }
  };

  el('f_registration').addEventListener('input', event => {
    state.operatorRegistration = event.target.value.trim();
    persistState();
  });

  el('f_item_description').addEventListener('input', saveDraft);

  el('btnSave').addEventListener('click', () => {
    setTimeout(() => {
      if (!el('f_op').value && !el('f_item').value) {
        el('f_item_description').value = '';
        state.extraDrafts[state.activeSlot] = {};
        persistState();
      }
    }, 50);
  });
})();
