import { FALLBACK_CATALOG } from './catalog.js';
import { detectOperationalContext as detectFactoryOperationalContext } from './turn-assistant-engine.js';

export const APP_VERSION = '3.0.0';
export const STORAGE_KEY = 'neodent-mes:v3';
export const LEGACY_STORAGE_KEY = 'mes-operadores:v2';
export const API_BASE = window.location.hostname.endsWith('github.io') ? '' : window.location.origin;

const listeners = new Set();
const clone = value => JSON.parse(JSON.stringify(value));

export function uid(prefix = 'id') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(dateKey = localDateKey()) {
  const [year, month, day] = String(dateKey).split('-');
  return `${day}/${month}/${year}`;
}

export function formatClock(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}

export function formatNumber(value, decimals = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('pt-BR', { maximumFractionDigits:decimals, minimumFractionDigits:0 });
}

export function parseNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  const number = Number.parseFloat(String(value).trim().replace(',', '.'));
  return Number.isFinite(number) ? number : NaN;
}

export function parseCycle(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return NaN;
  if (/^\d+(?:[.,]\d+)?$/.test(raw)) {
    const normalized = raw.replace(',', '.');
    if (raw.includes(',') && /^\d+,\d{2}$/.test(raw)) {
      const [minutes, seconds] = raw.split(',').map(Number);
      return seconds < 60 ? minutes * 60 + seconds : NaN;
    }
    const number = Number(normalized);
    return Number.isFinite(number) ? Math.round(number) : NaN;
  }
  let match = raw.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  match = raw.match(/^(\d+)\s*[:m]\s*(\d{1,2})\s*s?$/);
  if (match) return Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  match = raw.match(/^(?:(\d+)m)?\s*(?:(\d+)s)?$/);
  if (match && (match[1] || match[2])) return Number(match[1] || 0) * 60 + Number(match[2] || 0);
  return NaN;
}

export function formatCycle(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.round(value % 60);
  return hours ? `${hours}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}` : `${minutes}:${String(secs).padStart(2,'0')}`;
}

export function detectShift(date = new Date()) {
  return detectFactoryOperationalContext(date).shift;
}

export function detectOperationalContext(date = new Date()) {
  return detectFactoryOperationalContext(date);
}

export function shiftWindow(shift, now = new Date()) {
  const date = new Date(now);
  let startMinutes = 390;
  let endMinutes = 870;
  if (String(shift) === '2') { startMinutes = 870; endMinutes = 1350; }
  if (String(shift) === '3') { startMinutes = 1350; endMinutes = 1830; }
  const start = new Date(date);
  start.setHours(0, startMinutes, 0, 0);
  const end = new Date(date);
  end.setHours(0, endMinutes, 0, 0);
  if (String(shift) === '3' && date.getHours() < 6) {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate());
  }
  return { start, end };
}

export function minutesRemaining(shift, now = new Date()) {
  const { start, end } = shiftWindow(shift, now);
  if (now < start) return 480;
  return Math.max(0, Math.min(480, Math.ceil((end - now) / 60000)));
}

export function normalizeCatalog(lines) {
  const source = Array.isArray(lines) && lines.length ? lines : FALLBACK_CATALOG;
  return source.map((line, lineIndex) => ({
    id: line.id || `linha-${lineIndex + 1}`,
    name: line.name || `Linha ${lineIndex + 1}`,
    sortOrder: Number(line.sortOrder || lineIndex + 1),
    machines: (line.machines || []).map((machine, machineIndex) => ({
      id: machine.id,
      name: machine.name,
      equipmentType: machine.equipmentType || 'TNL',
      sortOrder: Number(machine.sortOrder || machineIndex + 1)
    }))
  }));
}

function baseState() {
  return {
    version: APP_VERSION,
    session: null,
    catalog: normalizeCatalog(FALLBACK_CATALOG),
    assignments: [],
    activeMachineId: '',
    machineSessions: {},
    conferenceDrafts: {},
    records: [],
    acknowledgements: {},
    syncQueue: [],
    sync: { online:navigator.onLine, status:API_BASE ? 'idle' : 'local', lastSyncAt:null, error:'' },
    ui: { route:'overview', machineFilter:'all', machineSearch:'', alertFilter:'all' }
  };
}

function migrateLegacy() {
  const next = baseState();
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return next;
    const legacy = JSON.parse(raw);
    const legacyUser = legacy.sessionUser;
    const operationalContext = detectOperationalContext();
    if (legacyUser?.name && legacyUser?.registration) {
      next.session = {
        id: legacyUser.id || `operator-${legacyUser.registration}`,
        name: legacyUser.name,
        registration: String(legacyUser.registration),
        shift: String(operationalContext.shift),
        productionDate: operationalContext.productionDate,
        operationalContext,
        startedAt: new Date().toISOString()
      };
    } else if (legacy.operatorName) {
      next.session = {
        id: `operator-${legacy.operatorRegistration || 'local'}`,
        name: legacy.operatorName,
        registration: String(legacy.operatorRegistration || ''),
        shift: String(operationalContext.shift),
        productionDate: operationalContext.productionDate,
        operationalContext,
        startedAt: new Date().toISOString()
      };
    }
    next.catalog = normalizeCatalog(legacy.catalog);
    next.records = Array.isArray(legacy.records) ? legacy.records : [];
    if (next.session) {
      const assignmentKey = `${next.session.productionDate}|${next.session.shift}|${next.session.registration}`;
      const daily = legacy.dailyMachineAssignments?.[assignmentKey] || [];
      next.assignments = daily.map((item, index) => ({ id:item.id || `assignment-${index}`, slotOrder:index + 1, lineId:item.lineId, machineId:item.machineId }));
      if (!next.assignments.length && legacy.slots) {
        next.assignments = Object.values(legacy.slots).filter(item => item?.machineId).map((item, index) => ({ id:`assignment-${index}`, slotOrder:index + 1, lineId:item.lineId, machineId:item.machineId }));
      }
      next.activeMachineId = next.assignments[0]?.machineId || '';
      Object.values(legacy.shiftConferences || {}).forEach(item => {
        if (!item?.machineId) return;
        next.machineSessions[item.machineId] = {
          machineId:item.machineId,
          lineId:item.lineId,
          machineName:item.machineName,
          lineName:item.lineName,
          op:item.opNumber || item.op || '',
          item:item.itemNumber || item.item || '',
          description:item.description || '',
          cycleSeconds:Number(item.cycleTimeSeconds) || null,
          frequency1:item.frequency1 ?? null,
          frequency2:item.frequency2 ?? null,
          producedSoFar:Number(item.openingProduction) || 0,
          producedThisShift:Number(item.producedInShift) || 0,
          target:Number(item.target) || null,
          availableMinutes:Number(item.availableMinutes) || 480,
          status:item.status === 'closed' ? 'pointed' : 'producing',
          checkedAt:item.updatedAt || item.openedAt || new Date().toISOString(),
          updatedAt:item.updatedAt || new Date().toISOString(),
          notes:item.notes || ''
        };
      });
    }
  } catch (error) {
    console.error('Falha ao migrar dados anteriores:', error);
  }
  return next;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return migrateLegacy();
    return {
      ...baseState(),
      ...saved,
      catalog:normalizeCatalog(saved.catalog),
      assignments:Array.isArray(saved.assignments) ? saved.assignments : [],
      machineSessions:saved.machineSessions || {},
      conferenceDrafts:saved.conferenceDrafts || {},
      records:Array.isArray(saved.records) ? saved.records : [],
      acknowledgements:saved.acknowledgements || {},
      syncQueue:Array.isArray(saved.syncQueue) ? saved.syncQueue : []
    };
  } catch (error) {
    console.error('Falha ao carregar estado:', error);
    return migrateLegacy();
  }
}

export const store = {
  state:loadState(),
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  update(mutator, reason = 'update') {
    mutator(this.state);
    this.state.version = APP_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    listeners.forEach(listener => listener(this.state, reason));
  },
  snapshot() { return clone(this.state); }
};

export function getLine(lineId) {
  return store.state.catalog.find(line => line.id === lineId) || null;
}

export function getMachine(machineId) {
  for (const line of store.state.catalog) {
    const machine = line.machines.find(item => item.id === machineId);
    if (machine) return { ...machine, lineId:line.id, lineName:line.name };
  }
  return null;
}

export function activeMachine() {
  return getMachine(store.state.activeMachineId);
}

export function currentMachineSession(machineId = store.state.activeMachineId) {
  return store.state.machineSessions[machineId] || null;
}

async function request(path, options = {}) {
  if (!API_BASE) throw new Error('Nuvem indisponível nesta origem.');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers:{ Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Erro ${response.status}`);
  return payload;
}

export const api = {
  request,
  async get(path) { return request(path); },
  async post(path, body, queueOnFailure = true) {
    try {
      const payload = await request(path, { method:'POST', body:JSON.stringify(body) });
      store.update(state => { state.sync.status = 'synced'; state.sync.error = ''; state.sync.lastSyncAt = new Date().toISOString(); }, 'sync');
      return payload;
    } catch (error) {
      if (queueOnFailure) {
        store.update(state => {
          state.syncQueue.push({ id:uid('queue'), path, body, createdAt:new Date().toISOString() });
          state.sync.status = 'pending';
          state.sync.error = error.message;
        }, 'queue');
      }
      throw error;
    }
  },
  async flushQueue() {
    if (!API_BASE || !navigator.onLine || !store.state.syncQueue.length) return;
    const queue = [...store.state.syncQueue];
    for (const task of queue) {
      try {
        await request(task.path, { method:'POST', body:JSON.stringify(task.body) });
        store.update(state => { state.syncQueue = state.syncQueue.filter(item => item.id !== task.id); }, 'queue-flush');
      } catch (error) {
        store.update(state => { state.sync.status = 'error'; state.sync.error = error.message; }, 'sync-error');
        break;
      }
    }
    if (!store.state.syncQueue.length) store.update(state => { state.sync.status = 'synced'; state.sync.error = ''; state.sync.lastSyncAt = new Date().toISOString(); }, 'sync');
  }
};

export async function loadCloudCatalog() {
  if (!API_BASE) return;
  const payload = await api.get('/api/v1/catalog');
  store.update(state => { state.catalog = normalizeCatalog(payload.lines); }, 'catalog');
}

export async function loadCloudRecords() {
  if (!API_BASE) return;
  const payload = await api.get('/api/v1/records');
  const map = new Map(store.state.records.map(record => [record.id, record]));
  for (const record of payload.records || []) {
    const current = map.get(record.id);
    if (!current || new Date(record.updatedAt || record.createdAt) >= new Date(current.updatedAt || current.createdAt)) map.set(record.id, record);
  }
  store.update(state => { state.records = [...map.values()].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)); }, 'records');
}

export async function loginOperator({ name, registration }) {
  const operationalContext=detectOperationalContext();
  let operator = { id:`operator-${registration}`, name, registration, defaultShift:operationalContext.shift };
  if (API_BASE) {
    try { operator = (await api.post('/api/v1/session/login', { name, registration, shift:operationalContext.shift }, false)).operator || operator; }
    catch (error) { console.warn('Login salvo apenas localmente:', error); }
  }
  store.update(state => {
    state.session = {
      ...operator,shift:operationalContext.shift,productionDate:operationalContext.productionDate,
      operationalContext,startedAt:new Date().toISOString()
    };
    state.assignments = [];
    state.activeMachineId = '';
  }, 'login');
  await loadAssignments();
  return operator;
}

export async function loadAssignments() {
  const session = store.state.session;
  if (!session) return [];
  if (API_BASE) {
    try {
      const params = new URLSearchParams({ productionDate:String(session.productionDate), shift:String(session.shift), registration:String(session.registration) });
      const payload = await api.get(`/api/v1/assignments?${params}`);
      if (payload.assignments?.length) store.update(state => { state.assignments = payload.assignments; state.activeMachineId ||= payload.assignments[0].machineId; }, 'assignments');
    } catch (error) { console.warn('Máquinas carregadas localmente:', error); }
  }
  return store.state.assignments;
}

export async function saveAssignments(assignments) {
  const session = store.state.session;
  store.update(state => { state.assignments = assignments; state.activeMachineId = assignments[0]?.machineId || ''; }, 'assignments');
  if (!session || !API_BASE) return assignments;
  try {
    await api.post('/api/v1/assignments', {
      productionDate:String(session.productionDate), shift:String(session.shift), registration:String(session.registration), operatorName:session.name,
      assignments:assignments.map(({lineId,machineId}) => ({lineId,machineId}))
    });
  } catch (error) { console.warn('Seleção pendente de sincronização:', error); }
  return assignments;
}

export async function getShiftContext(machineId, op) {
  if (!API_BASE || !machineId || !op) return null;
  const params = new URLSearchParams({ machineId, opNumber:op });
  try { return await api.get(`/api/v1/shift-context?${params}`); }
  catch (error) { console.warn('Passagem de turno indisponível:', error); return null; }
}

export function productionTotalFromRecords(machineId, op) {
  const records = store.state.records
    .filter(record => record.status !== 'cancelled' && record.machineId === machineId && String(record.op) === String(op))
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  const latest = records[0];
  const value = parseNumber(latest?.totalAfterPointing ?? latest?.finalProduction);
  return Number.isFinite(value) ? value : 0;
}

export function calculateSession(session) {
  if (!session) return { target:NaN, expectedTotal:NaN, progress:0, remaining:NaN, measurement1:NaN, measurement2:NaN };
  const cycleMinutes = Number(session.cycleSeconds) / 60;
  const target = cycleMinutes > 0 ? Number(session.availableMinutes || 480) / cycleMinutes : NaN;
  const produced = Number(session.producedThisShift || 0);
  const progress = Number.isFinite(target) && target > 0 ? Math.max(0, Math.min(100, produced / target * 100)) : 0;
  return {
    target,
    expectedTotal:Number(session.producedSoFar || 0) + (Number.isFinite(target) ? target : 0),
    progress,
    remaining:Number.isFinite(target) ? Math.max(target - produced, 0) : NaN,
    measurement1:Number(session.frequency1) > 0 && Number.isFinite(target) ? Math.ceil(target / Number(session.frequency1)) : NaN,
    measurement2:Number(session.frequency2) > 0 && Number.isFinite(target) ? Math.ceil(target / Number(session.frequency2)) : NaN
  };
}

export function deriveAlerts() {
  const now = Date.now();
  const alerts = [];
  for (const assignment of store.state.assignments) {
    const machine = getMachine(assignment.machineId);
    const session = currentMachineSession(assignment.machineId);
    if (!session) {
      alerts.push({ id:`conference-${assignment.machineId}`, level:'attention', machineId:assignment.machineId, title:'Conferência inicial pendente', detail:'Confirme a OP e os parâmetros para iniciar o acompanhamento.', action:'Fazer conferência' });
      continue;
    }
    const staleMinutes = Math.floor((now - new Date(session.updatedAt || session.checkedAt || now).getTime()) / 60000);
    if (['stopped','maintenance'].includes(session.status)) alerts.push({ id:`status-${assignment.machineId}`, level:'critical', machineId:assignment.machineId, title:session.status === 'maintenance' ? 'Máquina em manutenção' : 'Máquina parada', detail:`Status informado há ${Math.max(staleMinutes,0)} min.`, action:'Ver máquina' });
    else if (['setup','adjustment'].includes(session.status)) alerts.push({ id:`status-${assignment.machineId}`, level:'important', machineId:assignment.machineId, title:session.status === 'setup' ? 'Setup em andamento' : 'Ajuste em andamento', detail:`Status informado há ${Math.max(staleMinutes,0)} min.`, action:'Ver máquina' });
    if (staleMinutes >= 45) alerts.push({ id:`stale-${assignment.machineId}`, level:staleMinutes >= 90 ? 'critical' : 'attention', machineId:assignment.machineId, title:'Informação desatualizada', detail:`Sem atualização há ${staleMinutes} min.`, action:'Atualizar dados' });
    const calculation = calculateSession(session);
    const potential = Number(session.bars || 0) * Number(session.piecesPerBar || 0);
    if (potential > 0 && Number.isFinite(calculation.remaining) && potential < calculation.remaining) alerts.push({ id:`material-${assignment.machineId}`, level:'important', machineId:assignment.machineId, title:'Risco de matéria-prima insuficiente', detail:`Potencial informado: ${formatNumber(potential)} peças; necessidade estimada: ${formatNumber(calculation.remaining)}.`, action:'Revisar material' });
  }
  return alerts;
}

window.addEventListener('online', () => { store.update(state => { state.sync.online = true; }, 'online'); api.flushQueue(); });
window.addEventListener('offline', () => store.update(state => { state.sync.online = false; state.sync.status = 'offline'; }, 'offline'));
