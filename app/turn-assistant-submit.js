const ASSISTANT_FORM_IDS = new Set([
  'taHandoffForm',
  'taFirstOrderForm',
  'taShiftCloseForm',
  'taOrderCloseForm',
  'taNewOrderForm',
  'taStoppedForm'
]);

export function isAssistantForm(form) {
  return Boolean(form && ASSISTANT_FORM_IDS.has(form.id));
}

export function bindAssistantSubmit(root, onSubmit) {
  if (!root?.addEventListener || typeof onSubmit !== 'function') {
    throw new TypeError('Raiz e rotina de envio são obrigatórias.');
  }

  const handleClick = event => {
    const button = event.target?.closest?.('[data-ta-submit-form]');
    if (!button || button.disabled) return;
    const formId = button.dataset.taSubmitForm || '';
    if (!ASSISTANT_FORM_IDS.has(formId)) return;
    const form = root.getElementById?.(formId);
    if (!form) return;

    event.preventDefault();
    event.stopImmediatePropagation?.();
    onSubmit(form,button);
  };

  root.addEventListener('click',handleClick,true);
  return () => root.removeEventListener?.('click',handleClick,true);
}
