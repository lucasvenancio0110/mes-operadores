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
import {
  ensureOperationalTables,
  loginOperator,
  getAssignments,
  saveAssignments,
  getShiftContext,
  saveShiftSession
} from './shift.js';
import {
  ensureOperations,
  listMachineStates,
  saveMachineState,
  listMachineEvents,
  saveMachineEvent
} from './operations.js';

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

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env, context) {
    if (env.DB) {
      await ensureDatabase(env);
      await ensureOperationalTables(env);
      await ensureOperations(env);
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/api/v1/catalog') {
        return json({ lines: await getCatalog(env) });
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/operators') {
        return json({ operators: await getOperators(env) });
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/session/login') {
        const payload = await requestJson(request);
        if (!payload) return json({ error: 'JSON inválido.' }, 400);
        return json({ operator: await loginOperator(env, payload) });
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/assignments') {
        const assignments = await getAssignments(env, {
          productionDate: url.searchParams.get('productionDate') || '',
          shift: url.searchParams.get('shift') || '',
          registration: url.searchParams.get('registration') || ''
        });
        return json({ assignments });
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/assignments') {
        const payload = await requestJson(request);
        if (!payload) return json({ error: 'JSON inválido.' }, 400);
        return json({ assignments: await saveAssignments(env, payload) });
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/shift-context') {
        const contextData = await getShiftContext(env, {
          machineId: url.searchParams.get('machineId') || '',
          opNumber: url.searchParams.get('opNumber') || ''
        });
        return json(contextData);
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/shift-sessions') {
        const payload = await requestJson(request);
        if (!payload) return json({ error: 'JSON inválido.' }, 400);
        return json({ session: await saveShiftSession(env, payload) });
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

      if (request.method === 'GET' && url.pathname === '/api/v1/machine-states') {
        const states = await listMachineStates(env, {
          machineId: url.searchParams.get('machineId') || '',
          lineId: url.searchParams.get('lineId') || '',
          status: url.searchParams.get('status') || ''
        });
        return json({ states });
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/machine-states') {
        const payload = await requestJson(request);
        if (!payload) return json({ error: 'JSON inválido.' }, 400);
        return json({ state: await saveMachineState(env, payload) });
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/events') {
        const events = await listMachineEvents(env, {
          machineId: url.searchParams.get('machineId') || '',
          eventType: url.searchParams.get('eventType') || '',
          from: url.searchParams.get('from') || ''
        });
        return json({ events });
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/events') {
        const payload = await requestJson(request);
        if (!payload) return json({ error: 'JSON inválido.' }, 400);
        return json({ event: await saveMachineEvent(env, payload) });
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
    } catch (error) {
      console.error('Falha na API operacional:', error);
      return json({ error: error.message || 'Erro interno.' }, 400);
    }

    return application.fetch(request, env, context);
  }
};
