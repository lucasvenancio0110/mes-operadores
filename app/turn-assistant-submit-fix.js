const ASSISTANT_FORM_IDS = new Set([
  'taHandoffForm',
  'taFirstOrderForm',
  'taShiftCloseForm',
  'taOrderCloseForm',
  'taNewOrderForm',
  'taStoppedForm'
]);

function activeAssistantForm() {
  return [...ASSISTANT_FORM_IDS]
    .map(id => document.getElementById(id))
    .find(Boolean) || null;
}

function submitButton(form) {
  return document.querySelector(`button[type="submit"][form="${CSS.escape(form.id)}"]`)
    || form.querySelector('button[type="submit"]');
}

function feedbackElement(form) {
  const sheet = form.closest('.ta-sheet');
  const footer = sheet?.querySelector('.ta-sheet__actions');
  if (!footer) return null;
  let output = footer.querySelector('.ta-submit-feedback');
  if (!output) {
    output = document.createElement('div');
    output.className = 'ta-submit-feedback';
    output.setAttribute('role','status');
    output.setAttribute('aria-live','polite');
    footer.prepend(output);
  }
  return output;
}

function setFeedback(form, message = '', state = '') {
  const output = feedbackElement(form);
  if (!output) return;
  output.textContent = message;
  output.dataset.state = state;
}

function formError(form) {
  return form.querySelector('[data-ta-error]')?.textContent?.trim() || '';
}

function exposeError(form, message) {
  const text = String(message || 'Não foi possível salvar. Tente novamente.');
  const inline = form.querySelector('[data-ta-error]');
  if (inline) inline.textContent = text;
  setFeedback(form,text,'error');
  const button = submitButton(form);
  if (button) {
    button.disabled = false;
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
  }
}

function dispatchReliableSubmit(button, form) {
  if (button.disabled || form.dataset.taSubmitFixBusy === 'true') return;
  form.dataset.taSubmitFixBusy = 'true';
  const inline = form.querySelector('[data-ta-error]');
  if (inline) inline.textContent = '';
  setFeedback(form,'Validando informações…','working');

  let submitEvent;
  try {
    submitEvent = new SubmitEvent('submit', {
      bubbles:true,
      cancelable:true,
      submitter:button
    });
  } catch {
    submitEvent = new Event('submit',{ bubbles:true,cancelable:true });
  }
  form.dispatchEvent(submitEvent);

  window.setTimeout(() => {
    delete form.dataset.taSubmitFixBusy;
    if (!form.isConnected) return;
    const error = formError(form);
    if (error) {
      setFeedback(form,error,'error');
      return;
    }
    if (button.disabled) {
      setFeedback(form,'Salvando dados do turno…','working');
      return;
    }
    setFeedback(form,'O envio não iniciou. Toque novamente.','error');
  },350);
}

document.addEventListener('click',event => {
  const button = event.target.closest('button[type="submit"][form]');
  const formId = button?.getAttribute('form') || '';
  if (!button || !ASSISTANT_FORM_IDS.has(formId)) return;
  const form = document.getElementById(formId);
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  dispatchReliableSubmit(button,form);
},true);

new MutationObserver(() => {
  const form = activeAssistantForm();
  if (!form) return;
  feedbackElement(form);
  const error = formError(form);
  if (error) setFeedback(form,error,'error');
}).observe(document.body,{ childList:true,subtree:true,characterData:true });

window.addEventListener('unhandledrejection',event => {
  const form = activeAssistantForm();
  if (!form) return;
  console.error('Falha não tratada no assistente de turno:',event.reason);
  exposeError(form,event.reason?.message || event.reason);
});

window.addEventListener('error',event => {
  const form = activeAssistantForm();
  if (!form) return;
  console.error('Falha no assistente de turno:',event.error || event.message);
  exposeError(form,event.error?.message || event.message);
});
