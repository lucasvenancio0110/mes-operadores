const CATALOG_VERSION = '1';

const OFFICIAL_CATALOG = [
  { id: 'linha-01', name: 'Linha 1', machines: ['002','005','015','019','023','024','025','026','027','029','030','035','046','047','048'] },
  { id: 'linha-02', name: 'Linha 2', machines: ['003','004','007','008','013','016','017','018','028','031','032','049','050','051','143'] },
  { id: 'linha-03', name: 'Linha 3', machines: ['009','010','033','034','036','037','039','040','041','043','044'] },
  { id: 'linha-04', name: 'Linha 4', machines: ['042','052','053','057','058','059','060','061','064','065','066'] },
  { id: 'linha-05', name: 'Linha 5', machines: ['069','072','083','085','087','088','089','090','091','092','093','094','095'] },
  { id: 'linha-06', name: 'Linha 6', machines: ['067','068','073','074','075','076','077','079','081','082','084','086'] },
  { id: 'linha-07', name: 'Linha 7', machines: ['045','054','055','056','062','063','070','071','078','080','102','103','110','111'] },
  { id: 'linha-08', name: 'Linha 8', machines: ['096','098','104','107','112','113','115','116','118','119','121','122'] },
  { id: 'linha-09', name: 'Linha 9', machines: ['097','099','100','101','105','106','108','109','114','117','120','123'] },
  {
    id: 'linha-10',
    name: 'Linha 10',
    machines: ['006','124','125','126','127','128','129','130','134','135','136','137','138','139','140','141','142','144','145']
  }
];

const SPECIAL_EQUIPMENT = [
  { id: 'milltap', name: 'MILLTAP', lineId: 'linha-10', type: 'MILLTAP', sortOrder: 20 },
  { id: 'discovery', name: 'DISCOVERY', lineId: 'linha-10', type: 'DISCOVERY', sortOrder: 21 }
];

let readyPromise = null;

function schemaStatements(db) {
  return [
    db.prepare(`CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS production_lines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      line_id TEXT NOT NULL,
      equipment_type TEXT NOT NULL DEFAULT 'TNL',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (line_id) REFERENCES production_lines(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS operators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      registration TEXT,
      default_shift TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      item_number TEXT NOT NULL UNIQUE,
      description TEXT,
      default_cycle_time_seconds INTEGER,
      frequency_1 REAL,
      frequency_2 REAL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS item_machine_parameters (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      cycle_time_seconds INTEGER,
      frequency_1 REAL,
      frequency_2 REAL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (item_id, machine_id),
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS production_records (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      production_date TEXT NOT NULL,
      line_id TEXT NOT NULL DEFAULT '',
      line_name TEXT NOT NULL DEFAULT '',
      machine_id TEXT NOT NULL DEFAULT '',
      machine_name TEXT NOT NULL DEFAULT '',
      operator_name TEXT NOT NULL DEFAULT '',
      shift TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'mes-operadores',
      payload TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_machines_line ON machines (line_id, sort_order)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_operators_name ON operators (name)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_items_number ON items (item_number)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_item_machine ON item_machine_parameters (item_id, machine_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_records_date ON production_records (production_date DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_records_line_machine ON production_records (line_id, machine_id, production_date DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_records_operator ON production_records (operator_name, production_date DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_records_updated ON production_records (updated_at DESC)')
  ];
}

function catalogSeedStatements(db) {
  const statements = [];

  OFFICIAL_CATALOG.forEach((line, lineIndex) => {
    statements.push(
      db.prepare(`INSERT INTO production_lines (id, name, sort_order, active, updated_at)
        VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          sort_order = excluded.sort_order,
          active = 1,
          updated_at = CURRENT_TIMESTAMP`)
        .bind(line.id, line.name, lineIndex + 1)
    );

    line.machines.forEach((number, machineIndex) => {
      statements.push(
        db.prepare(`INSERT INTO machines (id, name, line_id, equipment_type, sort_order, active, updated_at)
          VALUES (?, ?, ?, 'TNL', ?, 1, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            line_id = excluded.line_id,
            equipment_type = excluded.equipment_type,
            sort_order = excluded.sort_order,
            active = 1,
            updated_at = CURRENT_TIMESTAMP`)
          .bind(`tnl-${number}`, `TNL ${number}`, line.id, machineIndex + 1)
      );
    });
  });

  SPECIAL_EQUIPMENT.forEach(equipment => {
    statements.push(
      db.prepare(`INSERT INTO machines (id, name, line_id, equipment_type, sort_order, active, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          line_id = excluded.line_id,
          equipment_type = excluded.equipment_type,
          sort_order = excluded.sort_order,
          active = 1,
          updated_at = CURRENT_TIMESTAMP`)
        .bind(equipment.id, equipment.name, equipment.lineId, equipment.type, equipment.sortOrder)
    );
  });

  statements.push(
    db.prepare(`INSERT INTO app_metadata (key, value, updated_at)
      VALUES ('catalog_version', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
      .bind(CATALOG_VERSION)
  );

  return statements;
}

async function initializeDatabase(env) {
  if (!env.DB) return;

  await env.DB.batch(schemaStatements(env.DB));

  const versionRow = await env.DB.prepare(
    "SELECT value FROM app_metadata WHERE key = 'catalog_version'"
  ).first();

  if (versionRow?.value !== CATALOG_VERSION) {
    await env.DB.batch(catalogSeedStatements(env.DB));
  }
}

export async function ensureDatabase(env) {
  if (!env.DB) return;

  if (!readyPromise) {
    readyPromise = initializeDatabase(env).catch(error => {
      readyPromise = null;
      throw error;
    });
  }

  await readyPromise;
}

export async function getCatalog(env) {
  const [linesResult, machinesResult] = await Promise.all([
    env.DB.prepare(`SELECT id, name, sort_order AS sortOrder
      FROM production_lines
      WHERE active = 1
      ORDER BY sort_order, name`).all(),
    env.DB.prepare(`SELECT id, name, line_id AS lineId, equipment_type AS equipmentType, sort_order AS sortOrder
      FROM machines
      WHERE active = 1
      ORDER BY line_id, sort_order, name`).all()
  ]);

  const machinesByLine = new Map();
  for (const machine of machinesResult.results || []) {
    if (!machinesByLine.has(machine.lineId)) machinesByLine.set(machine.lineId, []);
    machinesByLine.get(machine.lineId).push(machine);
  }

  return (linesResult.results || []).map(line => ({
    ...line,
    machines: machinesByLine.get(line.id) || []
  }));
}

export async function getOperators(env) {
  const result = await env.DB.prepare(`SELECT
      id,
      name,
      registration,
      default_shift AS defaultShift
    FROM operators
    WHERE active = 1
    ORDER BY name`).all();
  return result.results || [];
}

export async function getItems(env, itemNumber = '') {
  if (itemNumber) {
    const item = await env.DB.prepare(`SELECT
        id,
        item_number AS itemNumber,
        description,
        default_cycle_time_seconds AS cycleTimeSeconds,
        frequency_1 AS frequency1,
        frequency_2 AS frequency2
      FROM items
      WHERE active = 1 AND item_number = ?
      LIMIT 1`).bind(itemNumber).first();
    return item ? [item] : [];
  }

  const result = await env.DB.prepare(`SELECT
      id,
      item_number AS itemNumber,
      description,
      default_cycle_time_seconds AS cycleTimeSeconds,
      frequency_1 AS frequency1,
      frequency_2 AS frequency2
    FROM items
    WHERE active = 1
    ORDER BY item_number
    LIMIT 5000`).all();
  return result.results || [];
}

export async function getDatabaseSummary(env) {
  const row = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM production_lines WHERE active = 1) AS lines,
    (SELECT COUNT(*) FROM machines WHERE active = 1) AS machines,
    (SELECT COUNT(*) FROM operators WHERE active = 1) AS operators,
    (SELECT COUNT(*) FROM items WHERE active = 1) AS items,
    (SELECT COUNT(*) FROM production_records) AS records`).first();
  return row || { lines: 0, machines: 0, operators: 0, items: 0, records: 0 };
}
