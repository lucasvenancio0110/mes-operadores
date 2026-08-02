let operationalReadyPromise = null;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function slug(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `id-${Date.now()}`;
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function initializeOperationalTables(env) {
  if (!env.DB) return;

  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS operator_machine_assignments (
      id TEXT PRIMARY KEY,
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      operator_registration TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      slot_order INTEGER NOT NULL,
      line_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (production_date, shift, operator_registration, slot_order)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS shift_machine_sessions (
      id TEXT PRIMARY KEY,
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      operator_registration TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      line_id TEXT NOT NULL,
      line_name TEXT NOT NULL DEFAULT '',
      machine_id TEXT NOT NULL,
      machine_name TEXT NOT NULL DEFAULT '',
      op_number TEXT NOT NULL,
      item_number TEXT NOT NULL DEFAULT '',
      sequence TEXT NOT NULL DEFAULT '',
      cycle_time_seconds INTEGER,
      frequency_1 REAL,
      frequency_2 REAL,
      opening_production REAL,
      available_minutes REAL,
      target REAL,
      final_production REAL,
      produced_in_shift REAL,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (production_date, shift, operator_registration, machine_id, op_number)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_assignments_operator_day ON operator_machine_assignments (operator_registration, production_date, shift, slot_order)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_shift_sessions_machine_op ON shift_machine_sessions (machine_id, op_number, production_date, shift)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_shift_sessions_day ON shift_machine_sessions (production_date, shift, status)')
  ]);
}

export async function ensureOperationalTables(env) {
  if (!env.DB) return;
  if (!operationalReadyPromise) {
    operationalReadyPromise = initializeOperationalTables(env).catch(error => {
      operationalReadyPromise = null;
      throw error;
    });
  }
  await operationalReadyPromise;
}

export async function loginOperator(env, payload = {}) {
  await ensureOperationalTables(env);

  const registration = normalizeText(payload.registration);
  const name = normalizeText(payload.name);
  const defaultShift = normalizeText(payload.shift);

  if (!registration || !name) {
    throw new Error('Nome e matrícula são obrigatórios.');
  }

  const existing = await env.DB.prepare(`SELECT id
    FROM operators
    WHERE registration = ?
    ORDER BY updated_at DESC
    LIMIT 1`).bind(registration).first();

  const id = existing?.id || `operator-${slug(registration)}`;

  await env.DB.prepare(`INSERT INTO operators (
      id, name, registration, default_shift, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      registration = excluded.registration,
      default_shift = excluded.default_shift,
      active = 1,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(id, name, registration, defaultShift)
    .run();

  return { id, name, registration, defaultShift };
}

export async function getAssignments(env, query = {}) {
  await ensureOperationalTables(env);

  const productionDate = normalizeText(query.productionDate);
  const shift = normalizeText(query.shift);
  const registration = normalizeText(query.registration);

  if (!productionDate || !shift || !registration) return [];

  const result = await env.DB.prepare(`SELECT
      id,
      slot_order AS slotOrder,
      line_id AS lineId,
      machine_id AS machineId
    FROM operator_machine_assignments
    WHERE production_date = ? AND shift = ? AND operator_registration = ?
    ORDER BY slot_order`)
    .bind(productionDate, shift, registration)
    .all();

  return result.results || [];
}

export async function saveAssignments(env, payload = {}) {
  await ensureOperationalTables(env);

  const productionDate = normalizeText(payload.productionDate);
  const shift = normalizeText(payload.shift);
  const registration = normalizeText(payload.registration);
  const operatorName = normalizeText(payload.operatorName);
  const assignments = Array.isArray(payload.assignments) ? payload.assignments : [];

  if (!productionDate || !shift || !registration || !operatorName) {
    throw new Error('Dados do operador e do turno são obrigatórios.');
  }
  if (!assignments.length) throw new Error('Selecione pelo menos uma máquina.');

  await env.DB.prepare(`DELETE FROM operator_machine_assignments
    WHERE production_date = ? AND shift = ? AND operator_registration = ?`)
    .bind(productionDate, shift, registration)
    .run();

  const statements = assignments.map((assignment, index) => {
    const slotOrder = index + 1;
    const lineId = normalizeText(assignment.lineId);
    const machineId = normalizeText(assignment.machineId);
    const id = `${productionDate}-${shift}-${slug(registration)}-${slotOrder}`;

    return env.DB.prepare(`INSERT INTO operator_machine_assignments (
        id, production_date, shift, operator_registration, operator_name,
        slot_order, line_id, machine_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(id, productionDate, shift, registration, operatorName, slotOrder, lineId, machineId);
  });

  if (statements.length) await env.DB.batch(statements);
  return getAssignments(env, { productionDate, shift, registration });
}

export async function getShiftContext(env, query = {}) {
  await ensureOperationalTables(env);

  const machineId = normalizeText(query.machineId);
  const opNumber = normalizeText(query.opNumber);
  if (!machineId) return { lastSession: null, producedTotal: 0, shifts: [] };

  const conditions = ['machine_id = ?', "status = 'closed'"];
  const bindings = [machineId];
  if (opNumber) {
    conditions.push('op_number = ?');
    bindings.push(opNumber);
  }

  const where = conditions.join(' AND ');
  const result = await env.DB.prepare(`SELECT
      id,
      production_date AS productionDate,
      shift,
      operator_name AS operatorName,
      machine_id AS machineId,
      machine_name AS machineName,
      op_number AS opNumber,
      item_number AS itemNumber,
      opening_production AS openingProduction,
      final_production AS finalProduction,
      produced_in_shift AS producedInShift,
      target,
      closed_at AS closedAt
    FROM shift_machine_sessions
    WHERE ${where}
    ORDER BY closed_at DESC
    LIMIT 20`)
    .bind(...bindings)
    .all();

  const shifts = result.results || [];
  const producedTotal = shifts.reduce((sum, row) => sum + (Number(row.producedInShift) || 0), 0);
  return { lastSession: shifts[0] || null, producedTotal, shifts };
}

export async function saveShiftSession(env, payload = {}) {
  await ensureOperationalTables(env);

  const productionDate = normalizeText(payload.productionDate);
  const shift = normalizeText(payload.shift);
  const registration = normalizeText(payload.registration);
  const operatorName = normalizeText(payload.operatorName);
  const machineId = normalizeText(payload.machineId);
  const opNumber = normalizeText(payload.opNumber);

  if (!productionDate || !shift || !registration || !operatorName || !machineId || !opNumber) {
    throw new Error('Operador, máquina, turno e OP são obrigatórios.');
  }

  const openingProduction = numberOrNull(payload.openingProduction);
  const finalProduction = numberOrNull(payload.finalProduction);
  const status = payload.status === 'closed' ? 'closed' : 'open';
  const producedInShift = status === 'closed' && finalProduction !== null
    ? Math.max(finalProduction - (openingProduction || 0), 0)
    : null;
  const now = new Date().toISOString();
  const id = normalizeText(payload.id) || `shift-${productionDate}-${shift}-${slug(registration)}-${slug(machineId)}-${slug(opNumber)}`;
  const openedAt = normalizeText(payload.openedAt) || now;
  const closedAt = status === 'closed' ? (normalizeText(payload.closedAt) || now) : null;

  await env.DB.prepare(`INSERT INTO shift_machine_sessions (
      id, production_date, shift, operator_registration, operator_name,
      line_id, line_name, machine_id, machine_name, op_number, item_number,
      sequence, cycle_time_seconds, frequency_1, frequency_2,
      opening_production, available_minutes, target, final_production,
      produced_in_shift, status, opened_at, closed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      production_date = excluded.production_date,
      shift = excluded.shift,
      operator_registration = excluded.operator_registration,
      operator_name = excluded.operator_name,
      line_id = excluded.line_id,
      line_name = excluded.line_name,
      machine_id = excluded.machine_id,
      machine_name = excluded.machine_name,
      op_number = excluded.op_number,
      item_number = excluded.item_number,
      sequence = excluded.sequence,
      cycle_time_seconds = excluded.cycle_time_seconds,
      frequency_1 = excluded.frequency_1,
      frequency_2 = excluded.frequency_2,
      opening_production = excluded.opening_production,
      available_minutes = excluded.available_minutes,
      target = excluded.target,
      final_production = excluded.final_production,
      produced_in_shift = excluded.produced_in_shift,
      status = excluded.status,
      opened_at = excluded.opened_at,
      closed_at = excluded.closed_at,
      updated_at = excluded.updated_at`)
    .bind(
      id,
      productionDate,
      shift,
      registration,
      operatorName,
      normalizeText(payload.lineId),
      normalizeText(payload.lineName),
      machineId,
      normalizeText(payload.machineName),
      opNumber,
      normalizeText(payload.itemNumber),
      normalizeText(payload.sequence),
      numberOrNull(payload.cycleTimeSeconds),
      numberOrNull(payload.frequency1),
      numberOrNull(payload.frequency2),
      openingProduction,
      numberOrNull(payload.availableMinutes),
      numberOrNull(payload.target),
      finalProduction,
      producedInShift,
      status,
      openedAt,
      closedAt,
      now
    )
    .run();

  return {
    id,
    productionDate,
    shift,
    registration,
    operatorName,
    machineId,
    opNumber,
    openingProduction,
    finalProduction,
    producedInShift,
    status,
    openedAt,
    closedAt,
    updatedAt: now
  };
}
