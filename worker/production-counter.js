import { authenticateRequest, canAccessMachine } from './auth.js';
import { calculateEstimatedCounter, auditDiff, normalizePhysicalStatus } from '../app/production-counter-engine.js';

let readyPromise=null;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const text=value=>String(value??'').trim();
const number=value=>{if(value===''||value===null||value===undefined)return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
const integer=value=>{const parsed=number(value);return parsed===null?null:Math.max(0,Math.floor(parsed));};
const nowIso=()=>new Date().toISOString();
const uid=prefix=>`${prefix}-${crypto.randomUUID()}`;

async function initialize(env){
  if(!env.DB)return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_counter_sessions (
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      line_id TEXT NOT NULL DEFAULT '',
      op_number TEXT NOT NULL DEFAULT '',
      official_produced_at_conference REAL NOT NULL DEFAULT 0,
      initial_shift_pieces INTEGER NOT NULL DEFAULT 0,
      current_bar_pieces INTEGER NOT NULL DEFAULT 0,
      feeder_bars INTEGER NOT NULL DEFAULT 0,
      pieces_per_full_bar INTEGER NOT NULL DEFAULT 0,
      cycle_time_seconds REAL NOT NULL DEFAULT 0,
      conference_at TEXT NOT NULL,
      operator_registration TEXT NOT NULL DEFAULT '',
      operator_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(production_date,shift,machine_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_counter_intervals (
      id TEXT PRIMARY KEY,
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      physical_status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_history_events (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      line_id TEXT NOT NULL DEFAULT '',
      production_date TEXT NOT NULL DEFAULT '',
      shift TEXT NOT NULL DEFAULT '',
      op_number TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      payload TEXT NOT NULL,
      actor_registration TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_counter_interval_machine ON machine_counter_intervals(machine_id,production_date,shift,started_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_machine_history_machine ON machine_history_events(machine_id,created_at DESC)')
  ]);
}

async function ensureTables(env){
  if(!readyPromise)readyPromise=initialize(env).catch(error=>{readyPromise=null;throw error;});
  await readyPromise;
}

async function requireMachine(request,env,machineId,lineId=''){
  const auth=await authenticateRequest(request,env);
  if(!auth)return {response:json({error:'Sua sessão expirou. Entre novamente.',code:'UNAUTHENTICATED'},401)};
  const machine=await env.DB.prepare('SELECT id,line_id AS lineId,name FROM machines WHERE id=? AND active=1 LIMIT 1').bind(machineId).first();
  if(!machine)return {response:json({error:'Máquina não encontrada.',code:'MACHINE_NOT_FOUND'},404)};
  if(lineId&&lineId!==machine.lineId)return {response:json({error:'Linha incompatível com a máquina.',code:'MACHINE_LINE_MISMATCH'},403)};
  if(!canAccessMachine(auth,machine.lineId,machineId))return {response:json({error:'Máquina não autorizada.',code:'MACHINE_FORBIDDEN'},403)};
  return {auth,machine};
}

function permitted(auth,codes=[]){return auth?.user?.roleCode==='admin'||codes.some(code=>auth?.permissions?.includes(code));}

async function historyEvent(env,{machineId,lineId='',productionDate='',shift='',op='',eventType,title,payload={},auth}){
  const createdAt=nowIso();
  await env.DB.prepare(`INSERT INTO machine_history_events(
    id,machine_id,line_id,production_date,shift,op_number,event_type,title,payload,actor_registration,actor_name,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    uid('history'),machineId,lineId,productionDate,shift,op,eventType,title,JSON.stringify(payload),
    auth?.user?.registration||'',auth?.user?.name||'',createdAt
  ).run();
}

async function activeOrder(env,machineId){
  return env.DB.prepare(`SELECT machine_id AS machineId,line_id AS lineId,op_number AS op,item_number AS item,
    item_description AS description,op_target AS opTarget,cycle_time_seconds AS cycleSeconds,piece_length_mm AS pieceLengthMm,
    produced_total AS producedSoFar,current_bar_pieces AS currentBarPieces,feeder_bars AS feederBars,
    bar_length_mm AS barLengthMm,kerf_mm AS kerfMm,status,updated_at AS updatedAt
    FROM machine_active_orders WHERE machine_id=? AND status='active' LIMIT 1`).bind(machineId).first();
}

async function currentRuntime(env,machineId,order=null){
  const row=await env.DB.prepare(`SELECT physical_status AS physicalStatus,reason,note,updated_at AS updatedAt
    FROM machine_runtime_states WHERE machine_id=? LIMIT 1`).bind(machineId).first();
  return {physicalStatus:normalizePhysicalStatus(row?.physicalStatus||(order?'producing':'stopped')),reason:row?.reason||'',note:row?.note||'',updatedAt:row?.updatedAt||null};
}

async function counterSession(env,machineId,productionDate,shift){
  return env.DB.prepare(`SELECT production_date AS productionDate,shift,machine_id AS machineId,line_id AS lineId,
    op_number AS op,official_produced_at_conference AS officialProducedAtConference,
    initial_shift_pieces AS initialShiftPieces,current_bar_pieces AS currentBarPieces,feeder_bars AS feederBars,
    pieces_per_full_bar AS piecesPerFullBar,cycle_time_seconds AS cycleSeconds,conference_at AS conferenceAt,
    operator_registration AS operatorRegistration,operator_name AS operatorName,updated_at AS updatedAt
    FROM machine_counter_sessions WHERE machine_id=? AND production_date=? AND shift=? LIMIT 1`)
    .bind(machineId,productionDate,shift).first();
}

async function runningIntervals(env,machineId,productionDate,shift){
  const result=await env.DB.prepare(`SELECT id,physical_status AS physicalStatus,started_at AS startedAt,ended_at AS endedAt
    FROM machine_counter_intervals WHERE machine_id=? AND production_date=? AND shift=? AND physical_status='producing'
    ORDER BY started_at`).bind(machineId,productionDate,shift).all();
  return result.results||[];
}

async function stateRoute(request,env,url){
  const machineId=text(url.searchParams.get('machineId'));const productionDate=text(url.searchParams.get('productionDate'));const shift=text(url.searchParams.get('shift'));
  if(!machineId||!productionDate||!['1','2','3'].includes(shift))return json({error:'Máquina, data e turno são obrigatórios.',code:'INVALID_CONTEXT'},400);
  const access=await requireMachine(request,env,machineId);if(access.response)return access.response;
  const [session,order]=await Promise.all([counterSession(env,machineId,productionDate,shift),activeOrder(env,machineId)]);
  const runtime=await currentRuntime(env,machineId,order);
  if(!session)return json({ok:true,configured:false,machineId,productionDate,shift,runtimeState:runtime,activeOrder:order||null});
  const intervals=await runningIntervals(env,machineId,productionDate,shift);
  const estimate=calculateEstimatedCounter({...session,officialProduced:session.officialProducedAtConference,physicalStatus:runtime.physicalStatus,runningIntervals:intervals,now:new Date()});
  return json({ok:true,configured:true,machineId,productionDate,shift,session,runtimeState:runtime,activeOrder:order||null,estimate});
}

async function conferenceRoute(request,env){
  const body=await request.json().catch(()=>null);if(!body)return json({error:'JSON inválido.',code:'INVALID_BODY'},400);
  const machineId=text(body.machineId);const productionDate=text(body.productionDate);const shift=text(body.shift);const requestedLine=text(body.lineId);
  if(!machineId||!productionDate||!['1','2','3'].includes(shift))return json({error:'Contexto do turno inválido.',code:'INVALID_CONTEXT'},400);
  const access=await requireMachine(request,env,machineId,requestedLine);if(access.response)return access.response;
  if(!permitted(access.auth,['conference.create','conference.edit']))return json({error:'Seu perfil não pode confirmar conferência.',code:'FORBIDDEN'},403);
  const order=await activeOrder(env,machineId);if(!order)return json({error:'A máquina não possui OP ativa.',code:'ORDER_REQUIRED'},400);
  const officialProduced=number(body.officialProduced??body.productionConfirmed);const initialShiftPieces=integer(body.initialShiftPieces);
  const currentBarPieces=integer(body.currentBarPieces);const feederBars=integer(body.feederBars);
  if(officialProduced===null||initialShiftPieces===null||currentBarPieces===null||feederBars===null)return json({error:'Produção, produção do turno e material são obrigatórios.',code:'COUNTER_FIELDS_REQUIRED'},400);
  const divisor=Number(order.pieceLengthMm||0)+Number(order.kerfMm||1);
  const piecesPerFullBar=divisor>0?Math.max(0,Math.floor(Number(order.barLengthMm||3600)/divisor)):0;
  const cycleSeconds=Number(order.cycleSeconds||0);if(!(cycleSeconds>0))return json({error:'Tempo de ciclo inválido.',code:'CYCLE_REQUIRED'},400);
  const now=nowIso();const runtime=await currentRuntime(env,machineId,order);
  const statements=[
    env.DB.prepare(`UPDATE machine_counter_intervals SET ended_at=? WHERE machine_id=? AND production_date=? AND shift=? AND ended_at IS NULL`).bind(now,machineId,productionDate,shift),
    env.DB.prepare(`INSERT INTO machine_counter_sessions(
      production_date,shift,machine_id,line_id,op_number,official_produced_at_conference,initial_shift_pieces,
      current_bar_pieces,feeder_bars,pieces_per_full_bar,cycle_time_seconds,conference_at,operator_registration,operator_name,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(production_date,shift,machine_id) DO UPDATE SET
      line_id=excluded.line_id,op_number=excluded.op_number,official_produced_at_conference=excluded.official_produced_at_conference,
      initial_shift_pieces=excluded.initial_shift_pieces,current_bar_pieces=excluded.current_bar_pieces,feeder_bars=excluded.feeder_bars,
      pieces_per_full_bar=excluded.pieces_per_full_bar,cycle_time_seconds=excluded.cycle_time_seconds,conference_at=excluded.conference_at,
      operator_registration=excluded.operator_registration,operator_name=excluded.operator_name,updated_at=excluded.updated_at`).bind(
      productionDate,shift,machineId,access.machine.lineId,order.op,officialProduced,initialShiftPieces,currentBarPieces,feederBars,
      piecesPerFullBar,cycleSeconds,now,access.auth.user.registration,access.auth.user.name,now
    )
  ];
  if(runtime.physicalStatus==='producing')statements.push(env.DB.prepare(`INSERT INTO machine_counter_intervals(id,production_date,shift,machine_id,physical_status,started_at,ended_at,created_at) VALUES(?,?,?,?, 'producing',?,NULL,?)`).bind(uid('counter-run'),productionDate,shift,machineId,now,now));
  await env.DB.batch(statements);
  await historyEvent(env,{machineId,lineId:access.machine.lineId,productionDate,shift,op:order.op,eventType:'conference.counter_started',title:'Conferência e contador estimado iniciados',payload:{officialProduced,initialShiftPieces,currentBarPieces,feederBars,piecesPerFullBar,cycleSeconds,physicalStatus:runtime.physicalStatus},auth:access.auth});
  return stateRoute(request,env,new URL(`${new URL(request.url).origin}/api/v1/production-counter/state?machineId=${encodeURIComponent(machineId)}&productionDate=${encodeURIComponent(productionDate)}&shift=${encodeURIComponent(shift)}`));
}

async function statusRoute(request,env){
  const body=await request.json().catch(()=>null);if(!body)return json({error:'JSON inválido.',code:'INVALID_BODY'},400);
  const machineId=text(body.machineId),productionDate=text(body.productionDate),shift=text(body.shift),requestedLine=text(body.lineId);
  const access=await requireMachine(request,env,machineId,requestedLine);if(access.response)return access.response;
  if(!permitted(access.auth,['machines.update_status']))return json({error:'Seu perfil não pode alterar o status.',code:'FORBIDDEN'},403);
  const nextStatus=normalizePhysicalStatus(body.physicalStatus);const order=await activeOrder(env,machineId);const before=await currentRuntime(env,machineId,order);const now=nowIso();
  const statements=[env.DB.prepare(`INSERT INTO machine_runtime_states(machine_id,line_id,physical_status,reason,note,updated_at,updated_by_registration,updated_by_name)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(machine_id) DO UPDATE SET physical_status=excluded.physical_status,reason=excluded.reason,note=excluded.note,updated_at=excluded.updated_at,updated_by_registration=excluded.updated_by_registration,updated_by_name=excluded.updated_by_name`).bind(machineId,access.machine.lineId,nextStatus,text(body.reason),text(body.note),now,access.auth.user.registration,access.auth.user.name)];
  if(before.physicalStatus==='producing'&&nextStatus!=='producing')statements.push(env.DB.prepare(`UPDATE machine_counter_intervals SET ended_at=? WHERE machine_id=? AND production_date=? AND shift=? AND physical_status='producing' AND ended_at IS NULL`).bind(now,machineId,productionDate,shift));
  if(before.physicalStatus!=='producing'&&nextStatus==='producing')statements.push(env.DB.prepare(`INSERT INTO machine_counter_intervals(id,production_date,shift,machine_id,physical_status,started_at,ended_at,created_at) VALUES(?,?,?,?, 'producing',?,NULL,?)`).bind(uid('counter-run'),productionDate,shift,machineId,now,now));
  await env.DB.batch(statements);
  await historyEvent(env,{machineId,lineId:access.machine.lineId,productionDate,shift,op:order?.op||'',eventType:'machine.status_changed',title:`Status alterado para ${nextStatus}`,payload:{before:before.physicalStatus,after:nextStatus,reason:text(body.reason),note:text(body.note)},auth:access.auth});
  return stateRoute(request,env,new URL(`${new URL(request.url).origin}/api/v1/production-counter/state?machineId=${encodeURIComponent(machineId)}&productionDate=${encodeURIComponent(productionDate)}&shift=${encodeURIComponent(shift)}`));
}

async function updateOrderRoute(request,env){
  const body=await request.json().catch(()=>null);if(!body)return json({error:'JSON inválido.',code:'INVALID_BODY'},400);
  const machineId=text(body.machineId),productionDate=text(body.productionDate),shift=text(body.shift),requestedLine=text(body.lineId);
  const access=await requireMachine(request,env,machineId,requestedLine);if(access.response)return access.response;
  if(!permitted(access.auth,['production.create','conference.edit']))return json({error:'Seu perfil não pode alterar dados da OP.',code:'FORBIDDEN'},403);
  const before=await activeOrder(env,machineId);if(!before)return json({error:'Nenhuma OP ativa.',code:'ORDER_REQUIRED'},400);
  const after={...before,op:text(body.op??before.op),item:text(body.item??before.item),description:text(body.description??before.description),opTarget:number(body.opTarget??before.opTarget),cycleSeconds:number(body.cycleSeconds??before.cycleSeconds),pieceLengthMm:number(body.pieceLengthMm??before.pieceLengthMm),currentBarPieces:integer(body.currentBarPieces??before.currentBarPieces),feederBars:integer(body.feederBars??before.feederBars)};
  if(!after.op||!after.item||!(after.opTarget>0)||!(after.cycleSeconds>0)||!(after.pieceLengthMm>0))return json({error:'OP, item, meta, ciclo e comprimento devem ser válidos.',code:'INVALID_ORDER_DATA'},400);
  const fields=['op','item','description','opTarget','cycleSeconds','pieceLengthMm','currentBarPieces','feederBars'];const changes=auditDiff(before,after,fields);
  if(!changes.length)return json({ok:true,changed:false,activeOrder:before});
  const now=nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE machine_active_orders SET op_number=?,item_number=?,item_description=?,op_target=?,cycle_time_seconds=?,piece_length_mm=?,current_bar_pieces=?,feeder_bars=?,updated_at=?,updated_by_registration=?,updated_by_name=? WHERE machine_id=? AND status='active'`).bind(after.op,after.item,after.description,after.opTarget,after.cycleSeconds,after.pieceLengthMm,after.currentBarPieces,after.feederBars,now,access.auth.user.registration,access.auth.user.name,machineId),
    env.DB.prepare(`UPDATE machine_counter_sessions SET op_number=?,cycle_time_seconds=?,current_bar_pieces=?,feeder_bars=?,updated_at=? WHERE machine_id=? AND production_date=? AND shift=?`).bind(after.op,after.cycleSeconds,after.currentBarPieces,after.feederBars,now,machineId,productionDate,shift)
  ]);
  await historyEvent(env,{machineId,lineId:access.machine.lineId,productionDate,shift,op:after.op,eventType:'order.data_changed',title:'Dados da OP alterados',payload:{changes,note:text(body.note)},auth:access.auth});
  return json({ok:true,changed:true,activeOrder:await activeOrder(env,machineId),changes});
}

async function historyRoute(request,env,url){
  const machineId=text(url.searchParams.get('machineId'));if(!machineId)return json({error:'Informe a máquina.',code:'MACHINE_REQUIRED'},400);
  const access=await requireMachine(request,env,machineId);if(access.response)return access.response;
  const custom=await env.DB.prepare(`SELECT id,event_type AS eventType,title,payload,actor_registration AS actorRegistration,actor_name AS actorName,created_at AS createdAt,production_date AS productionDate,shift,op_number AS op FROM machine_history_events WHERE machine_id=? ORDER BY created_at DESC LIMIT 250`).bind(machineId).all();
  const legacy=await env.DB.prepare(`SELECT id,event_type AS eventType,event_type AS title,payload,operator_registration AS actorRegistration,operator_name AS actorName,created_at AS createdAt,production_date AS productionDate,shift,op_number AS op FROM turn_assistant_events WHERE machine_id=? ORDER BY created_at DESC LIMIT 250`).bind(machineId).all();
  const events=[...(custom.results||[]),...(legacy.results||[])].map(event=>({...event,payload:(()=>{try{return JSON.parse(event.payload||'{}')}catch{return {}}})()})).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,300);
  return json({ok:true,machineId,events});
}

export async function handleProductionCounter(request,env){
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/v1/production-counter/'))return null;
  await ensureTables(env);
  if(url.pathname.endsWith('/state')&&request.method==='GET')return stateRoute(request,env,url);
  if(url.pathname.endsWith('/history')&&request.method==='GET')return historyRoute(request,env,url);
  if(url.pathname.endsWith('/conference')&&request.method==='POST')return conferenceRoute(request,env);
  if(url.pathname.endsWith('/status')&&request.method==='POST')return statusRoute(request,env);
  if(url.pathname.endsWith('/order')&&request.method==='POST')return updateOrderRoute(request,env);
  return json({error:'Rota do contador não encontrada.',code:'NOT_FOUND'},404);
}

export async function productionCounterHealth(env){
  await ensureTables(env);
  const tables=['machine_counter_sessions','machine_counter_intervals','machine_history_events'];
  const found=[];for(const table of tables){const row=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();if(row?.name)found.push(row.name);}
  const sample=calculateEstimatedCounter({conferenceAt:'2026-08-06T18:00:00.000Z',now:'2026-08-06T18:10:00.000Z',cycleSeconds:120,initialShiftPieces:5,officialProduced:100,currentBarPieces:50,feederBars:2,piecesPerFullBar:50,physicalStatus:'producing'});
  return {ok:found.length===3&&sample.estimatedShiftPieces===10&&sample.estimatedOrderProduced===105,version:'6.4.0',tables:found,counter:'estimated-not-official',pausesOn:['stopped','setup','adjustment','maintenance'],history:true};
}
