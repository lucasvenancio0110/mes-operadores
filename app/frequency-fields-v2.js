const EMPTY_VALUES = new Set(['', 'null', 'undefined', 'nan']);
let scheduled = false;

function clean(value) {
  const text = String(value ?? '').trim();
  return EMPTY_VALUES.has(text.toLowerCase()) ? '' : text;
}

function hasPositiveValue(input) {
  const text = clean(input?.value).replace(',', '.');
  const value = Number(text);
  return Number.isFinite(value) && value > 0;
}

function sanitizeInput(input) {
  if (!input) return;
  const value = clean(input.value);
  if (input.value !== value) input.value = value;
  input.setAttribute('value', value);
}

function ensureButton(form, firstField) {
  const duplicates = [...form.querySelectorAll('#addFrequency2')];
  let button = duplicates.shift();
  duplicates.forEach(item => item.remove());

  if (!button) {
    button = document.createElement('button');
    button.id = 'addFrequency2';
    button.type = 'button';
    button.className = 'planning-add-frequency';
  }

  button.textContent = '＋ Adicionar segunda frequência';
  button.setAttribute('aria-controls', 'confFrequency2');
  button.disabled = false;

  if (button.previousElementSibling !== firstField) {
    firstField.insertAdjacentElement('afterend', button);
  }

  return button;
}

function enhanceConference() {
  const form = document.getElementById('conferenceForm');
  const frequency1 = document.getElementById('confFrequency1');
  const frequency2 = document.getElementById('confFrequency2');
  if (!form || !frequency1 || !frequency2) return;

  sanitizeInput(frequency1);
  sanitizeInput(frequency2);

  const firstField = frequency1.closest('.field');
  const secondField = frequency2.closest('.field');
  if (!firstField || !secondField) return;

  const button = ensureButton(form, firstField);
  const requested = form.dataset.secondFrequencyRequested === 'true';
  const showSecond = requested || hasPositiveValue(frequency2);

  secondField.classList.add('planning-frequency-2');
  secondField.hidden = !showSecond;
  secondField.toggleAttribute('hidden', !showSecond);
  button.hidden = showSecond;
  button.toggleAttribute('hidden', showSecond);
  button.setAttribute('aria-expanded', String(showSecond));

  const firstLabel = firstField.querySelector('label');
  const secondLabel = secondField.querySelector('label');
  if (firstLabel) firstLabel.textContent = showSecond ? 'Frequência I' : 'Frequência de medição';
  if (secondLabel) secondLabel.innerHTML = 'Frequência II <span>(opcional)</span>';

  frequency1.placeholder = 'Ex.: 84,308';
  frequency2.placeholder = 'Ex.: 54,8';

  if (!firstField.querySelector('[data-frequency-v2-hint]')) {
    const hint = document.createElement('small');
    hint.className = 'field-hint';
    hint.dataset.frequencyV2Hint = 'true';
    hint.textContent = 'Caso exista outra frequência, toque no botão abaixo.';
    firstField.appendChild(hint);
  }
}

function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceConference();
  });
}

document.addEventListener('click', event => {
  const button = event.target.closest?.('#addFrequency2');
  if (!button) return;
  const form = button.closest('form');
  if (form) form.dataset.secondFrequencyRequested = 'true';
  scheduleEnhance();
  requestAnimationFrame(() => document.getElementById('confFrequency2')?.focus());
}, true);

document.addEventListener('input', event => {
  if (event.target.id === 'confFrequency1' || event.target.id === 'confFrequency2') scheduleEnhance();
}, true);

new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true });
scheduleEnhance();
