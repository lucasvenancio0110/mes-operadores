import application from './main.js';
import {
  ensureAuthTables,
  handleSecurityRoute,
  authenticateRequest,
  authorizationError,
  canAccessMachine
} from './auth.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers }
  });
}

function hasPermission(auth, code) {
  return Boolean(auth && (auth.user.roleCode === 'admin' || auth.permissions.includes(code)));
}

function sameOriginAllowed(request) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return true;
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

function isElevated(auth) {
  return ['admin','leadership','preparator','technical'].includes(auth?.user?.roleCode);
}

function recordBelongsToUser(record, auth) {
  return String(record?.registration || record?.operatorRegistration || '') === String(auth.user.registration)
    || String(record?.operatorName || '') === String(auth.user.name);
}

async function filterJsonResponse(response, filter) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload) return response;
  const filtered = filter(payload);
  const headers = new Headers(response.headers);
  headers.set('Content-Type','application/json; charset=utf-8');
  headers.set('Cache-Control','no-store');
  return new Response(JSON.stringify(filtered), { status:response.status, headers });
}

async function validateOperationalMutation(request, auth) {
  const url = new URL(request.url);
  if (!['POST','PUT','PATCH','DELETE'].includes(request.method)) return null;
  if (!sameOriginAllowed(request)) return json({ error:'Origem da requisição não autorizada.', code:'INVALID_ORIGIN' },403);

  const body = await request.clone().json().catch(() => null);
  if (!body) return null;

  if (url.pathname === '/api/v1/settings' && !hasPermission(auth,'settings.edit')) {
    return json({ error:'Acesso não autorizado.', code:'FORBIDDEN' },403);
  }

  if (url.pathname === '/api/v1/assignments') {
    if (!isElevated(auth) && String(body.registration || '') !== String(auth.user.registration)) {
      return json({ error:'Você só pode alterar as máquinas da própria sessão.', code:'FORBIDDEN' },403);
    }
    for (const assignment of body.assignments || []) {
      if (!canAccessMachine(auth,assignment.lineId,assignment.machineId)) return json({ error:'Máquina ou linha não autorizada.', code:'MACHINE_FORBIDDEN' },403);
    }
  }

  if (['/api/v1/machine-states','/api/v1/events','/api/v1/records','/api/v1/shift-sessions'].includes(url.pathname)) {
    const registration = String(body.registration || body.operatorRegistration || '');
    if (!isElevated(auth) && registration && registration !== String(auth.user.registration)) {
      return json({ error:'Não é permitido registrar dados em nome de outro usuário.', code:'FORBIDDEN' },403);
    }
    if (!canAccessMachine(auth,body.lineId,body.machineId)) return json({ error:'Máquina ou linha não autorizada.', code:'MACHINE_FORBIDDEN' },403);
  }

  return null;
}

async function delegateProtected(request, env, context, auth) {
  const url = new URL(request.url);
  const mutationError = await validateOperationalMutation(request,auth);
  if (mutationError) return mutationError;

  if (url.pathname === '/api/v1/operators' && !hasPermission(auth,'users.view')) return json({ error:'Acesso não autorizado.', code:'FORBIDDEN' },403);
  if (url.pathname === '/api/v1/database-summary' && !hasPermission(auth,'users.view')) return json({ error:'Acesso não autorizado.', code:'FORBIDDEN' },403);
  if (url.pathname === '/api/v1/settings' && request.method === 'GET' && !hasPermission(auth,'settings.view')) return json({ error:'Acesso não autorizado.', code:'FORBIDDEN' },403);

  if (url.pathname === '/api/v1/assignments' && request.method === 'GET' && !isElevated(auth)) {
    const requestedRegistration = String(url.searchParams.get('registration') || '');
    if (requestedRegistration !== String(auth.user.registration)) return json({ error:'Acesso não autorizado.', code:'FORBIDDEN' },403);
  }

  let response = await application.fetch(request,env,context);

  if (url.pathname === '/api/v1/records' && request.method === 'GET' && !hasPermission(auth,'production.view_all')) {
    response = await filterJsonResponse(response,payload => ({ ...payload, records:(payload.records || []).filter(record => recordBelongsToUser(record,auth)) }));
  }

  if (url.pathname === '/api/v1/machine-states' && request.method === 'GET') {
    response = await filterJsonResponse(response,payload => ({
      ...payload,
      states:(payload.states || []).filter(state => {
        if (!canAccessMachine(auth,state.lineId,state.machineId)) return false;
        return isElevated(auth) || recordBelongsToUser(state,auth);
      })
    }));
  }

  if (url.pathname === '/api/v1/events' && request.method === 'GET') {
    response = await filterJsonResponse(response,payload => ({
      ...payload,
      events:(payload.events || []).filter(event => {
        if (!canAccessMachine(auth,event.lineId,event.machineId)) return false;
        return isElevated(auth) || recordBelongsToUser(event,auth);
      })
    }));
  }

  return response;
}

export default {
  async fetch(request, env, context) {
    await ensureAuthTables(env);
    const url = new URL(request.url);

    if (url.pathname === '/health' || !url.pathname.startsWith('/api/')) {
      return application.fetch(request,env,context);
    }

    const securityResponse = await handleSecurityRoute(request,env);
    if (securityResponse) return securityResponse;

    const auth = await authenticateRequest(request,env);
    const authError = authorizationError(auth);
    if (authError) return authError;

    return delegateProtected(request,env,context,auth);
  }
};
