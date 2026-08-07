import { authenticateRequest, canAccessMachine } from './auth.js';

const ALLOWED_STATUSES = new Set(['producing','setup','adjustment','maintenance','stopped']);
let readyPromise=null;

const json = (data,status=200) => new Response(JSON.stringify(data),{
  status,
  headers:{ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store' }
});
const text = value => String(value ?? '').trim();
const nowIso = () => new Date().toISOString();
const uid = prefix => `${prefix}-${crypto.randomUUID()}`;

async function initialize(env){
  if(!env.DB)return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_runtime_states (
      machine_id TEXT PRIMARY KEY,line_id TEXT NOT NULL DEFAULT '',physical_status TEXT NOT NULL DEFAULT 'producing',
      reason TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,
      updated_by_registration TEXT NOT NULL DEFAULT '',updated_by_name TEXT NOT NULL DEFAULT ''
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS turn_assistant_events (
      id TEXT PRIMARY KEY,production_date TEXT NOT NULL,shift TEXT NOT NULL,machine_id TEXT NOT NULL,op_number TEXT,
      event_type TEXT NOT NULL,operator_registration TEXT NOT NULL,operator_name TEXT NOT NULL,payload TEXT NOT NULL,
      ip_address TEXT,user_agent TEXT,created_at TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_runtime_states_line ON machine_runtime_states (line_id,physical_status,updated_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_events_machine ON turn_assistant_events (machine_id,created_at DESC)')
  ]);
}

async function ensureRuntimeTables(env){
  if(!readyPromise)readyPromise=initialize(env).catch(error=>{readyPromise=null;throw error;});
  await readyPromise;
}

function sameOrigin(request) {
  const origin=request.headers.get('Origin');
  return !origin || origin===new URL(request.url).origin;
}

function normalizeStatus(value) {
  const status=text(value).toLowerCase();
  if(status==='ajuste')return 'adjustment';
  if(status==='manutencao'||status==='manutenção')return 'maintenance';
  if(status==='parada')return 'stopped';
  return ALLOWED_STATUSES.has(status)?status:'';
}

function allowed(auth,permission) {
  return auth?.user?.roleCode==='admin' || auth?.permissions?.includes(permission);
}

async function requireMachine(request,env,machineId,lineId='') {
  const auth=await authenticateRequest(request,env);
  if(!auth)return { response:json({ error:'Sua sessão expirou. Entre novamente.',code:'UNAUTHENTICATED' },401) };
  const machine=await env.DB.prepare('SELECT id,line_id AS lineId,name FROM machines WHERE id=? AND active=1 LIMIT 1').bind(machineId).first();
  if(!machine)return { response:json({ error:'Máquina não encontrada.',code:'MACHINE_NOT_FOUND' },404) };
  if(lineId && String(lineId)!==String(machine.lineId))return { response:json({ error:'Linha incompatível com a máquina.',code:'MACHINE_LINE_MISMATCH' },403) };
  if(!canAccessMachine(auth,machine.lineId,machineId))return { response:json({ error:'Máquina não autorizada.',code:'MACHINE_FORBIDDEN' },403) };
  return { auth,machine };
}

async function statusRoute(request,env) {
  if(!sameOrigin(request))return json({ error:'Origem da requisição não autorizada.',code:'INVALID_ORIGIN' },403);
  const body=await request.json().catch(()=>null);
  if(!body)return json({ error:'JSON inválido.',code:'INVALID_BODY' },400);
  const machineId=text(body.machineId);
  const lineId=text(body.lineId);
  const physicalStatus=normalizeStatus(body.physicalStatus);
  if(!machineId || !physicalStatus)return json({ error:'Máquina e situação são obrigatórias.',code:'INVALID_STATUS' },400);
  const access=await requireMachine(request,env,machineId,lineId);
  if(access.response)return access.response;
  if(!allowed(access.auth,'machines.update_status'))return json({ error:'Seu perfil não pode alterar a situação da máquina.',code:'FORBIDDEN' },403);

  const previous=await env.DB.prepare(`SELECT physical_status AS physicalStatus,reason,note,updated_at AS updatedAt
    FROM machine_runtime_states WHERE machine_id=? LIMIT 1`).bind(machineId).first();
  const reason=text(body.reason);
  const note=text(body.note);
  const updatedAt=nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO machine_runtime_states(
      machine_id,line_id,physical_status,reason,note,updated_at,updated_by_registration,updated_by_name
    ) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(machine_id) DO UPDATE SET
      line_id=excluded.line_id,physical_status=excluded.physical_status,reason=excluded.reason,note=excluded.note,
      updated_at=excluded.updated_at,updated_by_registration=excluded.updated_by_registration,updated_by_name=excluded.updated_by_name`).bind(
      machineId,access.machine.lineId,physicalStatus,reason,note,updatedAt,access.auth.user.registration,access.auth.user.name
    ),
    env.DB.prepare(`INSERT INTO turn_assistant_events(
      id,production_date,shift,machine_id,op_number,event_type,operator_registration,operator_name,payload,ip_address,user_agent,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      uid('runtime-event'),text(body.productionDate),text(body.shift),machineId,text(body.op),'machine.status_changed',
      access.auth.user.registration,access.auth.user.name,
      JSON.stringify({ before:previous?.physicalStatus || null,after:physicalStatus,reason,note }),
      request.headers.get('CF-Connecting-IP') || '',(request.headers.get('User-Agent') || '').slice(0,500),updatedAt
    )
  ]);

  return json({
    ok:true,
    runtimeState:{
      machineId,lineId:access.machine.lineId,physicalStatus,reason,note,updatedAt,
      updatedByRegistration:access.auth.user.registration,updatedByName:access.auth.user.name
    }
  });
}

async function historyRoute(request,env,url) {
  const machineId=text(url.searchParams.get('machineId'));
  if(!machineId)return json({ error:'Informe a máquina.',code:'MACHINE_REQUIRED' },400);
  const access=await requireMachine(request,env,machineId);
  if(access.response)return access.response;
  const result=await env.DB.prepare(`SELECT id,event_type AS eventType,op_number AS op,operator_registration AS actorRegistration,
      operator_name AS actorName,payload,created_at AS createdAt,production_date AS productionDate,shift
    FROM turn_assistant_events WHERE machine_id=? ORDER BY created_at DESC LIMIT 250`).bind(machineId).all();
  const events=(result.results || []).map(event=>{
    let payload={};
    try{payload=JSON.parse(event.payload || '{}');}catch{}
    return { ...event,payload };
  });
  return json({ ok:true,machineId,events });
}

export async function handleMachineRuntime(request,env) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/v1/machine-runtime/'))return null;
  await ensureRuntimeTables(env);
  if(url.pathname==='/api/v1/machine-runtime/status' && request.method==='POST')return statusRoute(request,env);
  if(url.pathname==='/api/v1/machine-runtime/history' && request.method==='GET')return historyRoute(request,env,url);
  return json({ error:'Rota de situação da máquina não encontrada.',code:'NOT_FOUND' },404);
}