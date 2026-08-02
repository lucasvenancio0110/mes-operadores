import {
  store,
  api,
  API_BASE,
  getMachine,
  currentMachineSession,
  localDateKey,
  uid
} from './core.js';

const timers = new Map();
const SYNC_REASONS = new Set([
  'conference-save',
  'status',
  'pointing-normalized',
  'order-stopped'
]);

function eventTypeFor(reason, session) {
  if (reason === 'conference-save') return 'conference-completed';
  if (reason === 'status') return 'status-changed';
  if (reason === 'pointing-normalized') return session?.status === 'closed' ? 'order-closed' : 'production-pointed';
  if (reason === 'order-stopped') return 'machine-stopped';
  return 'machine-updated';
}

function eventDescription(reason, session, machine) {
  if (reason === 'conference-save') return `Conferência inicial concluída para a OP ${session?.op || 'não informada'}.`;
  if (reason === 'status') return `Status alterado para ${session?.status || 'não informado'}.`;
  if (reason === 'pointing-normalized') {
    const produced = Number(session?.producedThisShift || 0);
    return session?.status === 'closed'
      ? `Ordem encerrada após apontamento de ${produced} peças.`
      : `Apontamento confirmado: ${produced} peças no turno.`;
  }
  if (reason === 'order-stopped') return 'Máquina informada como parada após o encerramento da ordem.';
  return `${machine?.name || 'Máquina'} atualizada.`;
}

function statePayload(machineId) {
  const session = currentMachineSession(machineId);
  const machine = getMachine(machineId);
  const operator = store.state.session;
  if (!session || !machine || !operator) return null;

  return {
    ...session,
    machineId:machine.id,
    machineName:machine.name,
    lineId:machine.lineId,
    lineName:machine.lineName,
    operatorName:operator.name,
    registration:operator.registration,
    shift:String(operator.shift),
    productionDate:localDateKey(),
    updatedAt:session.updatedAt || new Date().toISOString()
  };
}

async function publish(machineId, reason) {
  if (!API_BASE) return;
  const payload = statePayload(machineId);
  if (!payload) return;

  try {
    await api.post('/api/v1/machine-states', payload);
    await api.post('/api/v1/events', {
      id:uid('event'),
      machineId:payload.machineId,
      lineId:payload.lineId,
      eventType:eventTypeFor(reason,payload),
      status:payload.status,
      operatorName:payload.operatorName,
      registration:payload.registration,
      description:eventDescription(reason,payload,getMachine(machineId)),
      op:payload.op,
      item:payload.item,
      producedThisShift:payload.producedThisShift,
      createdAt:new Date().toISOString()
    });
  } catch (error) {
    console.warn('Estado operacional pendente de sincronização:',error);
  }
}

function schedulePublish(machineId, reason) {
  if (!machineId || !SYNC_REASONS.has(reason)) return;
  clearTimeout(timers.get(machineId));
  timers.set(machineId,setTimeout(() => publish(machineId,reason),180));
}

export async function loadSharedMachineStates() {
  if (!API_BASE) return [];
  try {
    const payload = await api.get('/api/v1/machine-states');
    const states = Array.isArray(payload.states) ? payload.states : [];
    store.update(state => {
      for (const remote of states) {
        if (!remote?.machineId) continue;
        const local = state.machineSessions[remote.machineId];
        const remoteTime = new Date(remote.updatedAt || 0).getTime();
        const localTime = new Date(local?.updatedAt || local?.checkedAt || 0).getTime();
        if (!local || remoteTime > localTime) state.machineSessions[remote.machineId] = remote;
      }
    },'cloud-machine-states');
    return states;
  } catch (error) {
    console.warn('Estados compartilhados indisponíveis:',error);
    return [];
  }
}

export async function loadSharedEvents(machineId = '') {
  if (!API_BASE) return [];
  try {
    const params = new URLSearchParams();
    if (machineId) params.set('machineId',machineId);
    const payload = await api.get(`/api/v1/events${params.toString() ? `?${params}` : ''}`);
    const events = Array.isArray(payload.events) ? payload.events : [];
    store.update(state => { state.events = events; },'cloud-events');
    return events;
  } catch (error) {
    console.warn('Eventos compartilhados indisponíveis:',error);
    return [];
  }
}

store.subscribe((state,reason) => {
  if (!SYNC_REASONS.has(reason)) return;
  schedulePublish(state.activeMachineId,reason);
});

window.addEventListener('online',() => {
  loadSharedMachineStates();
  loadSharedEvents();
});

document.addEventListener('visibilitychange',() => {
  if (!document.hidden) {
    loadSharedMachineStates();
    loadSharedEvents();
  }
});

if (API_BASE) {
  Promise.allSettled([loadSharedMachineStates(),loadSharedEvents()]);
  window.setInterval(() => {
    if (!document.hidden && navigator.onLine) loadSharedMachineStates();
  },30000);
}
