import application from './index.js';

let schemaReadyPromise = null;

async function ensureSchema(env) {
  if (!env.DB) return;

  if (!schemaReadyPromise) {
    schemaReadyPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS production_records (
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
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_records_date ON production_records (production_date DESC)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_records_line_machine ON production_records (line_id, machine_id, production_date DESC)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_records_operator ON production_records (operator_name, production_date DESC)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_records_updated ON production_records (updated_at DESC)')
    ]).catch(error => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
}

export default {
  async fetch(request, env, context) {
    if (env.DB) await ensureSchema(env);
    return application.fetch(request, env, context);
  }
};
