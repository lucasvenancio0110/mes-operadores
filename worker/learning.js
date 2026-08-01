function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `id-${Date.now()}`;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function ensureLearningSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      op_number TEXT NOT NULL UNIQUE,
      item_id TEXT,
      item_number TEXT,
      line_id TEXT,
      machine_id TEXT,
      sequence TEXT,
      last_operator_id TEXT,
      last_operator_name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_work_orders_number ON work_orders (op_number)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_work_orders_item ON work_orders (item_number)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_work_orders_machine ON work_orders (machine_id, updated_at DESC)')
  ]);
}

async function resolveOperator(env, record) {
  const name = String(record.operatorName || '').trim();
  const registration = String(record.operatorRegistration || '').trim();
  if (!name) return null;

  const existing = await env.DB.prepare(`SELECT id
    FROM operators
    WHERE (? <> '' AND registration = ?) OR lower(name) = lower(?)
    ORDER BY CASE WHEN registration = ? THEN 0 ELSE 1 END
    LIMIT 1`)
    .bind(registration, registration, name, registration)
    .first();

  const id = existing?.id || `operator-${slugify(registration || name)}`;

  await env.DB.prepare(`INSERT INTO operators (
      id, name, registration, default_shift, active, updated_at
    ) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      registration = CASE
        WHEN excluded.registration <> '' THEN excluded.registration
        ELSE operators.registration
      END,
      default_shift = CASE
        WHEN excluded.default_shift <> '' THEN excluded.default_shift
        ELSE operators.default_shift
      END,
      active = 1,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(id, name, registration, String(record.shift || ''))
    .run();

  return { id, name, registration };
}

async function resolveItem(env, record) {
  const itemNumber = String(record.item || '').trim();
  if (!itemNumber) return null;

  const id = `item-${slugify(itemNumber)}`;
  const description = String(record.itemDescription || '').trim();
  const cycleTimeSeconds = finiteOrNull(record.cycleTimeSeconds);
  const frequency1 = finiteOrNull(record.frequency1);
  const frequency2 = finiteOrNull(record.frequency2);

  await env.DB.prepare(`INSERT INTO items (
      id, item_number, description, default_cycle_time_seconds,
      frequency_1, frequency_2, active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(item_number) DO UPDATE SET
      description = CASE
        WHEN excluded.description <> '' THEN excluded.description
        ELSE items.description
      END,
      default_cycle_time_seconds = COALESCE(excluded.default_cycle_time_seconds, items.default_cycle_time_seconds),
      frequency_1 = COALESCE(excluded.frequency_1, items.frequency_1),
      frequency_2 = COALESCE(excluded.frequency_2, items.frequency_2),
      active = 1,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(id, itemNumber, description, cycleTimeSeconds, frequency1, frequency2)
    .run();

  const stored = await env.DB.prepare('SELECT id FROM items WHERE item_number = ? LIMIT 1')
    .bind(itemNumber)
    .first();

  return {
    id: stored?.id || id,
    itemNumber,
    description,
    cycleTimeSeconds,
    frequency1,
    frequency2
  };
}

async function saveItemMachineParameters(env, item, record) {
  const machineId = String(record.machineId || '').trim();
  if (!item || !machineId) return;

  const cycleTimeSeconds = finiteOrNull(record.cycleTimeSeconds);
  const frequency1 = finiteOrNull(record.frequency1);
  const frequency2 = finiteOrNull(record.frequency2);
  if (cycleTimeSeconds === null && frequency1 === null && frequency2 === null) return;

  const id = `${item.id}:${machineId}`;
  await env.DB.prepare(`INSERT INTO item_machine_parameters (
      id, item_id, machine_id, cycle_time_seconds,
      frequency_1, frequency_2, active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(item_id, machine_id) DO UPDATE SET
      cycle_time_seconds = COALESCE(excluded.cycle_time_seconds, item_machine_parameters.cycle_time_seconds),
      frequency_1 = COALESCE(excluded.frequency_1, item_machine_parameters.frequency_1),
      frequency_2 = COALESCE(excluded.frequency_2, item_machine_parameters.frequency_2),
      active = 1,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(id, item.id, machineId, cycleTimeSeconds, frequency1, frequency2)
    .run();
}

async function saveWorkOrder(env, item, operator, record) {
  const opNumber = String(record.op || '').trim();
  if (!opNumber) return;

  const id = `op-${slugify(opNumber)}`;
  await env.DB.prepare(`INSERT INTO work_orders (
      id, op_number, item_id, item_number, line_id, machine_id,
      sequence, last_operator_id, last_operator_name, active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(op_number) DO UPDATE SET
      item_id = COALESCE(excluded.item_id, work_orders.item_id),
      item_number = CASE WHEN excluded.item_number <> '' THEN excluded.item_number ELSE work_orders.item_number END,
      line_id = CASE WHEN excluded.line_id <> '' THEN excluded.line_id ELSE work_orders.line_id END,
      machine_id = CASE WHEN excluded.machine_id <> '' THEN excluded.machine_id ELSE work_orders.machine_id END,
      sequence = CASE WHEN excluded.sequence <> '' THEN excluded.sequence ELSE work_orders.sequence END,
      last_operator_id = COALESCE(excluded.last_operator_id, work_orders.last_operator_id),
      last_operator_name = CASE WHEN excluded.last_operator_name <> '' THEN excluded.last_operator_name ELSE work_orders.last_operator_name END,
      active = 1,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(
      id,
      opNumber,
      item?.id || null,
      item?.itemNumber || String(record.item || '').trim(),
      String(record.lineId || '').trim(),
      String(record.machineId || '').trim(),
      String(record.sequence || '').trim(),
      operator?.id || null,
      operator?.name || String(record.operatorName || '').trim()
    )
    .run();
}

export async function captureMasterData(env, record) {
  if (!env.DB || !record) return;
  await ensureLearningSchema(env);

  const operator = await resolveOperator(env, record);
  const item = await resolveItem(env, record);
  await saveItemMachineParameters(env, item, record);
  await saveWorkOrder(env, item, operator, record);
}

export async function getItemForMachine(env, itemNumber, machineId = '') {
  if (!itemNumber) return null;

  const item = await env.DB.prepare(`SELECT
      id,
      item_number AS itemNumber,
      description,
      default_cycle_time_seconds AS defaultCycleTimeSeconds,
      frequency_1 AS defaultFrequency1,
      frequency_2 AS defaultFrequency2
    FROM items
    WHERE active = 1 AND item_number = ?
    LIMIT 1`)
    .bind(itemNumber)
    .first();

  if (!item) return null;

  let parameters = null;
  if (machineId) {
    parameters = await env.DB.prepare(`SELECT
        cycle_time_seconds AS cycleTimeSeconds,
        frequency_1 AS frequency1,
        frequency_2 AS frequency2
      FROM item_machine_parameters
      WHERE active = 1 AND item_id = ? AND machine_id = ?
      LIMIT 1`)
      .bind(item.id, machineId)
      .first();
  }

  return {
    id: item.id,
    itemNumber: item.itemNumber,
    description: item.description || '',
    cycleTimeSeconds: parameters?.cycleTimeSeconds ?? item.defaultCycleTimeSeconds,
    frequency1: parameters?.frequency1 ?? item.defaultFrequency1,
    frequency2: parameters?.frequency2 ?? item.defaultFrequency2,
    parameterSource: parameters ? 'machine' : 'item'
  };
}

export async function getWorkOrder(env, opNumber) {
  if (!opNumber) return null;
  await ensureLearningSchema(env);

  return env.DB.prepare(`SELECT
      op_number AS op,
      item_number AS item,
      line_id AS lineId,
      machine_id AS machineId,
      sequence,
      last_operator_name AS lastOperatorName,
      updated_at AS updatedAt
    FROM work_orders
    WHERE active = 1 AND op_number = ?
    LIMIT 1`)
    .bind(opNumber)
    .first();
}
