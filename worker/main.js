import application from './index.js';
import {
  ensureDatabase,
  getCatalog,
  getOperators,
  getItems,
  getDatabaseSummary
} from './database.js';
import {
  captureMasterData,
  getItemForMachine,
  getWorkOrder
} from './learning.js';

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
      const machineId = url.searchParams.get('machineId') || '';

      if (itemNumber) {
        const item = await getItemForMachine(env, itemNumber, machineId);
        return json({ items: item ? [item] : [] });
      }

      return json({ items: await getItems(env) });
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/orders') {
      const opNumber = url.searchParams.get('op') || '';
      const order = await getWorkOrder(env, opNumber);
      return json({ order });
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/database-summary') {
      return json({ ok: true, ...(await getDatabaseSummary(env)) });
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/records') {
      let record = null;
      try {
        record = await request.clone().json();
      } catch {
        // A API principal devolverá a mensagem adequada para JSON inválido.
      }

      const response = await application.fetch(request, env, context);

      if (response.ok && record) {
        try {
          await captureMasterData(env, record);
        } catch (error) {
          console.error('Registro salvo, mas houve falha ao atualizar dados mestres:', error);
        }
      }

      return response;
    }

    return application.fetch(request, env, context);
  }
};
