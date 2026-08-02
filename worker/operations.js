let operationsReadyPromise = null;

function text(value) {
  return String(value ?? '').trim();
}

function safeJson(value, fallback = {}) {
  try { return JSON.stringify(value ?? fallback); }
  catch { return JSON.stringify(fallback); }
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); }
  catch { return fallback; }
}

async function initializeOperations(env) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_states (
      machine_id TEXT PRIMARY KEY,
      line_id TEXT NOT NULL DEFAULT '',
      machine_name TEXT NOT NULL DEFAULT '',
      line_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      op_number TEXT NOT NULL DEFAULT '',
      item_number TEXT NOT NULL DEFAULT '',
      operator_name TEXT NOT NULL DEFAULT '',
      operator_registration TEXT NOT NULL DEFAULT '',
      production_date TEXT NOT NULL DEFAULT '',
      shift TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_events (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      line_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      operator_name TEXT NOT NULL DEFAULT '',
      operator_registration TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_machine_states_line_status ON machine_states (line_id, status, updated_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_machine_states_updated ON machine_states (updated_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_machine_events_machine ON machine_events (machine_id, created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_machine_events_type ON machine_events (event_type, created_at DESC)')
  ]);
}

export async function ensureOperations(env) {
  if (!env.DB) return;
  if (!operationsReadyPromise) {
    operationsReadyPromise = initializeOperations(env).catch(error => {
      operationsReadyPromise = null;
      throw error;
    });
  }
  await operationsReadyPromise;
}

export async function listMachineStates(env, query = {}) {
  await ensureOperations(env);
  const conditions = [];
  const bindings = [];
  const lineId = text(query.lineId);
  const status = text(query.status);
  const machineId = text(query.machineId);

  if (lineId) { conditions.push('line_id = ?'); bindings.push(lineId); }
  if (status) { conditions.push('status = ?'); bindings.push(status); }
  if (machineId) { conditions.push('machine_id = ?'); bindings.push(machineId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await env.DB.prepare(`SELECT payload FROM machine_states ${where} ORDER BY updated_at DESC LIMIT 5000`)
    .bind(...bindings)
    .all();

  return (result.results || []).map(row => parseJson(row.payload, null)).filter(Boolean);
}

export async function saveMachineState(env, payload = {}) {
  await ensureOperations(env);
  const machineId = text(payload.machineId);
  if (!machineId) throw new Error('Máquina obrigatória.');

  const now = new Date().toISOString();
  const state = {
    ...payload,
    machineId,
    lineId:text(payload.lineId),
    machineName:text(payload.machineName),
    lineName:text(payload.lineName),
    status:text(payload.status) || 'pending',
    op:text(payload.op || payload.opNumber),
    item:text(payload.item || payload.itemNumber),
    operatorName:text(payload.operatorName),
    registration:text(payload.registration || payload.operatorRegistration),
    productionDate:text(payload.productionDate),
    shift:text(payload.shift),
    updatedAt:text(payload.updatedAt) || now
  };

  await env.DB.prepare(`INSERT INTO machine_states (
      machine_id, line_id, machine_name, line_name, status, op_number, item_number,
      operator_name, operator_registration, production_date, shift, payload, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(machine_id) DO UPDATE SET
      line_id = excluded.line_id,
      machine_name = excluded.machine_name,
      line_name = excluded.line_name,
      status = excluded.status,
      op_number = excluded.op_number,
      item_number = excluded.item_number,
      operator_name = excluded.operator_name,
      operator_registration = excluded.operator_registration,
      production_date = excluded.production_date,
      shift = excluded.shift,
      payload = excluded.payload,
      updated_at = excluded.updated_at`)
    .bind(
      machineId,
      state.lineId,
      state.machineName,
      state.lineName,
      state.status,
      state.op,
      state.item,
      state.operatorName,
      state.registration,
      state.productionDate,
      state.shift,
      safeJson(state),
      state.updatedAt
    )
    .run();

  return state;
}

export async function listMachineEvents(env, query = {}) {
  await ensureOperations(env);
  const conditions = [];
  const bindings = [];
  const machineId = text(query.machineId);
  const eventType = text(query.eventType);
  const from = text(query.from);

  if (machineId) { conditions.push('machine_id = ?'); bindings.push(machineId); }
  if (eventType) { conditions.push('event_type = ?'); bindings.push(eventType); }
  if (from) { conditions.push('created_at >= ?'); bindings.push(from); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await env.DB.prepare(`SELECT payload FROM machine_events ${where} ORDER BY created_at DESC LIMIT 1000`)
    .bind(...bindings)
    .all();

  return (result.results || []).map(row => parseJson(row.payload, null)).filter(Boolean);
}

export async function saveMachineEvent(env, payload = {}) {
  await ensureOperations(env);
  const machineId = text(payload.machineId);
  const eventType = text(payload.eventType);
  if (!machineId || !eventType) throw new Error('Máquina e tipo de evento são obrigatórios.');

  const now = new Date().toISOString();
  const event = {
    ...payload,
    id:text(payload.id) || `event-${crypto.randomUUID()}`,
    machineId,
    lineId:text(payload.lineId),
    eventType,
    status:text(payload.status),
    operatorName:text(payload.operatorName),
    registration:text(payload.registration || payload.operatorRegistration),
    description:text(payload.description),
    createdAt:text(payload.createdAt) || now
  };

  await env.DB.prepare(`INSERT INTO machine_events (
      id, machine_id, line_id, event_type, status, operator_name,
      operator_registration, description, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, description = excluded.description`)
    .bind(
      event.id,
      event.machineId,
      event.lineId,
      event.eventType,
      event.status,
      event.operatorName,
      event.registration,
      event.description,
      safeJson(event),
      event.createdAt
    )
    .run();

  return event;
}
