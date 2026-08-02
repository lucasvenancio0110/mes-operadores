import { store, api, loadAssignments, localDateKey, currentMachineSession } from './core.js';

const layers = document.getElementById('layers');
const toastRegion = document.getElementById('toastRegion');
let normalizing = false;

function showToast(message) {
  toastRegion.innerHTML = `<div class="toast is-visible" role="status">${String(message).replace(/[&<>]/g, value => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[value]))}</div>`;
  setTimeout(() => { toastRegion.innerHTML = ''; }, 3000);
}

function close() {
  layers.innerHTML = '';
  document.body.style.overflow = '';
}

function open(content) {
  layers.innerHTML = `<div class="layer is-open"><section class="sheet" role="dialog" aria-modal="true"><header class="sheet-head"><div><p class="eyebrow">NEODENT MES</p><h2>Menu</h2></div><button class="close-button" type="button" data-runtime-close aria-label="Fechar">×</button></header>${content}</section></div>`;
  document.body.style.overflow = 'hidden';
}

function openMenu() {
  const session = store.state.session;
  open(`<div class="read-only" style="margin-bottom:14px"><span>Operador conectado</span><strong>${session?.name || 'Nenhum'}</strong><small class="subtle">${session ? `Matrícula ${session.registration} · ${session.shift}º turno` : ''}</small></div><div class="action-list"><button class="action-row" type="button" data-runtime-machines><div><strong>Máquinas do turno</strong><span>Consultar ou alterar as máquinas selecionadas</span></div><span>›</span></button><button class="action-row" type="button" data-runtime-shift><div><strong>Alterar turno</strong><span>Trocar o turno ativo desta sessão</span></div><span>›</span></button><button class="action-row" type="button" data-runtime-sync><div><strong>Sincronizar agora</strong><span>${store.state.syncQueue.length ? `${store.state.syncQueue.length} pendências` : 'Sem pendências locais'}</span></div><span>↻</span></button><button class="action-row" type="button" data-runtime-logout><div><strong style="color:var(--color-danger)">Sair</strong><span>Trocar operador neste aparelho</span></div><span>›</span></button></div>`);
}

function openShift() {
  const current = String(store.state.session?.shift || '1');
  open(`<div class="wizard-step-title"><h3>Alterar turno</h3><p>O turno escolhido será usado nas máquinas, conferências e apontamentos.</p></div><div class="option-grid">${['1','2','3'].map(value => `<button class="option-card" type="button" data-runtime-shift-choice="${value}" aria-pressed="${value === current}"><strong>${value}º turno</strong><span>${value === '1' ? '06:30–14:30' : value === '2' ? '14:30–22:30' : '22:30–06:30'}</span></button>`).join('')}</div><footer class="sheet-actions"><button class="btn btn-ghost" type="button" data-runtime-close>Cancelar</button><button class="btn btn-primary" type="button" data-runtime-shift-save="${current}">Confirmar turno</button></footer>`);
}

async function saveShift(value) {
  if (!store.state.session || !['1','2','3'].includes(value)) return;
  store.update(state => {
    state.session.shift = value;
    state.session.productionDate = localDateKey();
    state.session.startedAt = new Date().toISOString();
    state.assignments = [];
    state.activeMachineId = '';
  }, 'shift-change');
  close();
  await loadAssignments();
  if (!store.state.assignments.length) document.querySelector('[data-action="assign-machines"]')?.click();
  showToast(`Sessão alterada para o ${value}º turno.`);
}

function normalizePointedSession(reason) {
  if (normalizing || reason !== 'pointing') return;
  const session = currentMachineSession();
  if (!session || !['pointed','closed'].includes(session.status) || session.normalizedTotal) return;
  const produced = Number(session.producedThisShift || 0);
  const total = Number(session.producedSoFar || 0);
  if (!produced || total < produced) return;
  normalizing = true;
  store.update(state => {
    const target = state.machineSessions[state.activeMachineId];
    target.producedSoFar = total - produced;
    target.totalAfterPointing = total;
    target.normalizedTotal = true;
  }, 'pointing-normalized');
  normalizing = false;
}

function repairDynamicControls() {
  const statusButton = document.getElementById('saveStatus');
  if (statusButton && String(statusButton.dataset.value).includes('+session.status+')) statusButton.dataset.value = currentMachineSession()?.status || 'producing';
  const shiftButton = document.getElementById('confirmShift');
  if (shiftButton && String(shiftButton.dataset.value).includes('+current+')) shiftButton.dataset.value = store.state.session?.shift || '1';
}

store.subscribe((state, reason) => normalizePointedSession(reason));
new MutationObserver(repairDynamicControls).observe(layers, { childList:true, subtree:true });

document.addEventListener('click', event => {
  if (event.target.closest('#headerMenu')) { event.preventDefault(); return openMenu(); }
  if (event.target.closest('#headerShift')) { event.preventDefault(); return openShift(); }
  if (event.target.closest('#headerSync')) { event.preventDefault(); return document.querySelector('.connection-banner [data-action="sync"]')?.click(); }
  if (event.target.closest('[data-runtime-close]')) return close();
  if (event.target.closest('[data-runtime-machines]')) { close(); return document.querySelector('[data-action="assign-machines"]')?.click(); }
  if (event.target.closest('[data-runtime-shift]')) return openShift();
  if (event.target.closest('[data-runtime-sync]')) { close(); return document.querySelector('.connection-banner [data-action="sync"]')?.click(); }
  if (event.target.closest('[data-runtime-logout]')) { close(); return document.querySelector('[data-action="logout"]')?.click(); }
  const choice = event.target.closest('[data-runtime-shift-choice]');
  if (choice) {
    layers.querySelectorAll('[data-runtime-shift-choice]').forEach(button => button.setAttribute('aria-pressed',String(button === choice)));
    layers.querySelector('[data-runtime-shift-save]').dataset.runtimeShiftSave = choice.dataset.runtimeShiftChoice;
    return;
  }
  const save = event.target.closest('[data-runtime-shift-save]');
  if (save) return saveShift(save.dataset.runtimeShiftSave);
}, true);

navigator.serviceWorker?.addEventListener('message', event => {
  if (event.data?.type === 'APP_UPDATED') showToast('Nova versão instalada. Atualize a página quando puder.');
});

const initialRoute = new URLSearchParams(location.search).get('route');
if (['overview','machines','andon','alerts','more'].includes(initialRoute)) {
  store.update(state => { state.ui.route = initialRoute; }, 'initial-route');
}

api.flushQueue();
