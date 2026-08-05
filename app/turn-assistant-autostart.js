import { store, currentMachineSession } from './core.js';

const PREFIX = 'neomes-turn-assistant-autostart:';
let frame = 0;

function shiftKey() {
  const session = store.state.session;
  return session
    ? `${session.productionDate || ''}|${session.shift || ''}|${session.registration || ''}`
    : '';
}

function storageKey() {
  return `${PREFIX}${shiftKey()}`;
}

function markPrompted() {
  const key = storageKey();
  if (key !== PREFIX) sessionStorage.setItem(key,'1');
}

function alreadyPrompted() {
  const key = storageKey();
  return key === PREFIX || sessionStorage.getItem(key) === '1';
}

function assistantIsOpen() {
  return Boolean(document.querySelector(
    '#assistantHandoffLayer,#assistantFirstOrderLayer,#assistantLoadingLayer,#conferenceLayer'
  ));
}

function attempt() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    if (!window.NEOMES_AUTH?.user || !store.state.session) return;

    if (assistantIsOpen()) {
      markPrompted();
      return;
    }
    if (alreadyPrompted() || document.getElementById('layers')?.firstElementChild) return;
    if (!store.state.assignments.length) return;

    const index = store.state.assignments.findIndex(assignment => {
      const session = currentMachineSession(assignment.machineId);
      return !session || session.turnAssistantShiftKey !== `${store.state.session.productionDate}|${store.state.session.shift}`;
    });
    if (index < 0) {
      markPrompted();
      return;
    }

    const card = document.querySelectorAll('.ops-machine-card')[index];
    const trigger = card?.querySelector('[data-action="open-conference"],[data-action="edit-conference"]');
    if (!trigger) return;
    markPrompted();
    trigger.click();
  });
}

new MutationObserver(attempt).observe(document.body,{ childList:true,subtree:true });
store.subscribe(attempt);
attempt();
