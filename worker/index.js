const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function normalizeRecord(input) {
  const now = new Date().toISOString();
  const record = { ...input };

  if (!record.id || typeof record.id !== 'string') {
    throw new Error('Registro sem identificador válido.');
  }

  record.createdAt = record.createdAt || now;
  record.updatedAt = record.updatedAt || now;
  record.productionDate = record.productionDate || record.createdAt.slice(0, 10);
  record.status = record.status || 'active';
  record.source = record.source || 'mes-operadores';

  return record;
}

async function health(env) {
  if (!env.DB) {
    return json({ ok: true, database: false, message: 'Worker ativo; banco D1 ainda não vinculado.' });
  }

  try {
    await env.DB.prepare('SELECT 1 AS ok').first();
    return json({ ok: true, database: true });
  } catch (error) {
    return json({ ok: false, database: false, error: error.message }, 503);
  }
}

async function listRecords(request, env) {
  if (!env.DB) {
    return json({ error: 'Banco D1 ainda não vinculado ao Worker.' }, 503, corsHeaders(request));
  }

  const url = new URL(request.url);
  const lineId = url.searchParams.get('lineId');
  const machineId = url.searchParams.get('machineId');
  const productionDate = url.searchParams.get('productionDate');

  const conditions = [];
  const values = [];

  if (lineId) {
    conditions.push('line_id = ?');
    values.push(lineId);
  }
  if (machineId) {
    conditions.push('machine_id = ?');
    values.push(machineId);
  }
  if (productionDate) {
    conditions.push('production_date = ?');
    values.push(productionDate);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const statement = env.DB.prepare(`
    SELECT payload
    FROM production_records
    ${where}
    ORDER BY created_at DESC
    LIMIT 5000
  `).bind(...values);

  const result = await statement.all();
  const records = (result.results || []).map(row => {
    try {
      return JSON.parse(row.payload);
    } catch {
      return null;
    }
  }).filter(Boolean);

  return json({ records }, 200, corsHeaders(request));
}

async function upsertRecord(request, env) {
  if (!env.DB) {
    return json({ error: 'Banco D1 ainda não vinculado ao Worker.' }, 503, corsHeaders(request));
  }

  let record;
  try {
    record = normalizeRecord(await request.json());
  } catch (error) {
    return json({ error: error.message || 'JSON inválido.' }, 400, corsHeaders(request));
  }

  const payload = JSON.stringify({ ...record, syncStatus: 'synced' });

  await env.DB.prepare(`
    INSERT INTO production_records (
      id,
      created_at,
      updated_at,
      production_date,
      line_id,
      line_name,
      machine_id,
      machine_name,
      operator_name,
      shift,
      status,
      source,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at,
      production_date = excluded.production_date,
      line_id = excluded.line_id,
      line_name = excluded.line_name,
      machine_id = excluded.machine_id,
      machine_name = excluded.machine_name,
      operator_name = excluded.operator_name,
      shift = excluded.shift,
      status = excluded.status,
      source = excluded.source,
      payload = excluded.payload
  `).bind(
    record.id,
    record.createdAt,
    record.updatedAt,
    record.productionDate,
    record.lineId || '',
    record.lineName || '',
    record.machineId || '',
    record.machineName || '',
    record.operatorName || '',
    String(record.shift || ''),
    record.status,
    record.source,
    payload
  ).run();

  return json({ ok: true, record: JSON.parse(payload) }, 200, corsHeaders(request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return health(env);
      }

      if (url.pathname === '/api/v1/records' && request.method === 'GET') {
        return listRecords(request, env);
      }

      if (url.pathname === '/api/v1/records' && request.method === 'POST') {
        return upsertRecord(request, env);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: 'Erro interno no servidor.', detail: error.message }, 500, corsHeaders(request));
    }
  }
};
