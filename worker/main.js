import application from './index.js';
import {
  ensureDatabase,
  getCatalog,
  getOperators,
  getItems,
  getDatabaseSummary
} from './database.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

export default {
  async fetch(request, env, context) {
    if (env.DB) await ensureDatabase(env);

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/v1/catalog') {
      return json({ lines: await getCatalog(env) });
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/operators') {
      return json({ operators: await getOperators(env) });
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/items') {
      const itemNumber = url.searchParams.get('itemNumber') || '';
      return json({ items: await getItems(env, itemNumber) });
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/database-summary') {
      return json({ ok: true, ...(await getDatabaseSummary(env)) });
    }

    return application.fetch(request, env, context);
  }
};
