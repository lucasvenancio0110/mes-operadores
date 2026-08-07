import { ensureAuthTables, authenticateRequest, canAccessMachine } from './auth.js';
import {
  calculatePointingAccounting,
  createTurnClock,
  detectOperationalContext
} from '../app/turn-assistant-engine.js';

const DEFAULT_SHIFT_MINUTES = 480;
const DEFAULT_BAR_LENGTH_MM = 3600;
const DEFAULT_KERF_MM = 1;
let readyPromise = null;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers }
  });
}

function text(value) { return String(value ?? '').trim(); }
function number(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function integer(value) {
  const parsed = number(value);
  return parsed === null ? null : Math.max(0,Math.floor(parsed));
}
function nowIso() { return new Date().toISOString(); }
function ip(request) { return request.headers.get('CF-Connecting-IP') || ''; }
function agent(request) { return (request.headers.get('User-Agent') || '').slice(0,500); }
function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}
function uid(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function durationMinutes(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0,(to.getTime() - from.getTime()) / 60000);
}

function continuousPeriodStart(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to.getTime() < from.getTime()) from.setUTCDate(from.getUTCDate() - 1);
  return from.toISOString();
}

function continuousDurationMinutes(start, end) {
  const effectiveStart = continuousPeriodStart(start,end);
  return effectiveStart ? durationMinutes(effectiveStart,end) : 0;
}

function dateKeyWithOffset(dateKey, days = 0) {
  const [year,month,day] = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(year,month - 1,day + days));
  return date.toISOString().slice(0,10);
}

function localShiftInstant(dateKey, clock) {
  return new Date(`${dateKey}T${clock}:00-03:00`).toISOString();
}

function shiftBounds(productionDate, shift) {
  const date = dateKeyWithOffset(productionDate);
  const value = String(shift);
  if (value === '1') {
    return { start:localShiftInstant(date,'06:30'),end:localShiftInstant(date,'14:30') };
  }
  if (value === '2') {
    return { start:localShiftInstant(date,'14:30'),end:localShiftInstant(date,'22:30') };
  }
  return {
    start:localShiftInstant(date,'22:30'),
    end:localShiftInstant(dateKeyWithOffset(date,1),'06:30')
  };
}

async function initialize(env) {
  if (!env.DB) return;
  await ensureAuthTables(env);
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_active_orders (
      machine_id TEXT PRIMARY KEY,
      line_id TEXT NOT NULL DEFAULT '',
      line_name TEXT NOT NULL DEFAULT '',
      machine_name TEXT NOT NULL DEFAULT '',
      op_number TEXT NOT NULL,
      item_number TEXT NOT NULL DEFAULT '',
      item_description TEXT NOT NULL DEFAULT '',
      op_target REAL NOT NULL,
      cycle_time_seconds REAL NOT NULL,
      frequency_1 REAL,
      frequency_2 REAL,
      piece_length_mm REAL NOT NULL,
      produced_total REAL NOT NULL DEFAULT 0,
      current_bar_pieces INTEGER NOT NULL DEFAULT 0,
      feeder_bars INTEGER NOT NULL DEFAULT 0,
      bar_length_mm REAL NOT NULL DEFAULT 3600,
      kerf_mm REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      updated_at TEXT NOT NULL,
      updated_by_registration TEXT,
      updated_by_name TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_turn_handoffs (
      id TEXT PRIMARY KEY,
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      op_number TEXT NOT NULL,
      operator_registration TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      production_before REAL,
      production_confirmed REAL NOT NULL,
      current_bar_pieces INTEGER NOT NULL,
      feeder_bars INTEGER NOT NULL,
      confirmed_at TEXT NOT NULL,
      correction_note TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_turn_segments (
      id TEXT PRIMARY KEY,
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      line_id TEXT NOT NULL DEFAULT '',
      op_number TEXT NOT NULL DEFAULT '',
      item_number TEXT NOT NULL DEFAULT '',
      segment_type TEXT NOT NULL DEFAULT 'order',
      operator_registration TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      opening_production REAL,
      good_pieces INTEGER,
      rejects INTEGER,
      total_cycles INTEGER,
      cycle_time_seconds REAL,
      available_minutes REAL,
      running_minutes REAL,
      downtime_minutes REAL,
      reject_minutes REAL,
      downtime_reason TEXT,
      downtime_note TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS turn_assistant_events (
      id TEXT PRIMARY KEY,
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      op_number TEXT,
      event_type TEXT NOT NULL,
      operator_registration TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_turn_states (
      production_date TEXT NOT NULL,
      shift TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      line_id TEXT NOT NULL DEFAULT '',
      operator_registration TEXT NOT NULL DEFAULT '',
      operator_name TEXT NOT NULL DEFAULT '',
      workflow_status TEXT NOT NULL DEFAULT 'conference_pending',
      accounted_minutes REAL NOT NULL DEFAULT 0,
      good_pieces INTEGER NOT NULL DEFAULT 0,
      rejects INTEGER NOT NULL DEFAULT 0,
      stop_minutes REAL NOT NULL DEFAULT 0,
      last_conference_at TEXT,
      last_pointing_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (production_date,shift,machine_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS machine_runtime_states (
      machine_id TEXT PRIMARY KEY,
      line_id TEXT NOT NULL DEFAULT '',
      physical_status TEXT NOT NULL DEFAULT 'producing',
      reason TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      updated_by_registration TEXT NOT NULL DEFAULT '',
      updated_by_name TEXT NOT NULL DEFAULT ''
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_handoff_machine ON machine_turn_handoffs (machine_id,confirmed_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_segments_machine_shift ON machine_turn_segments (machine_id,production_date,shift,started_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_segments_open ON machine_turn_segments (machine_id,status,production_date,shift)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_events_machine ON turn_assistant_events (machine_id,created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_states_line_shift ON machine_turn_states (line_id,production_date,shift,updated_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_runtime_states_line ON machine_runtime_states (line_id,physical_status,updated_at DESC)')
  ]);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO machine_runtime_states (
        machine_id,line_id,physical_status,reason,note,updated_at,updated_by_registration,updated_by_name
      )
      SELECT machine_id,line_id,'stopped','Estado migrado','',updated_at,
        COALESCE(updated_by_registration,''),COALESCE(updated_by_name,'')
      FROM machine_active_orders WHERE status='stopped'
      ON CONFLICT(machine_id) DO UPDATE SET
        physical_status='stopped',updated_at=excluded.updated_at,
        updated_by_registration=excluded.updated_by_registration,updated_by_name=excluded.updated_by_name`),
    env.DB.prepare(`UPDATE machine_active_orders
      SET status=CASE WHEN closed_at IS NULL THEN 'active' ELSE 'closed' END
      WHERE status='stopped'`)
  ]);
}

async function ensureTables(env) {
  if (!readyPromise) readyPromise = initialize(env).catch(error => { readyPromise = null; throw error; });
  await readyPromise;
}

function mapOrder(row) {
  if (!row) return null;
  return {
    machineId:row.machineId,lineId:row.lineId,lineName:row.lineName,machineName:row.machineName,
    op:row.op,item:row.item,description:row.description,opTarget:Number(row.opTarget),
    cycleSeconds:Number(row.cycleSeconds),frequency1:row.frequency1 === null ? null : Number(row.frequency1),
    frequency2:row.frequency2 === null ? null : Number(row.frequency2),pieceLengthMm:Number(row.pieceLengthMm),
    producedSoFar:Number(row.producedSoFar || 0),currentBarPieces:Number(row.currentBarPieces || 0),
    feederBars:Number(row.feederBars || 0),barLengthMm:Number(row.barLengthMm || DEFAULT_BAR_LENGTH_MM),
    kerfMm:Number(row.kerfMm || DEFAULT_KERF_MM),status:row.status,openedAt:row.openedAt,
    closedAt:row.closedAt || null,updatedAt:row.updatedAt
  };
}

async function activeOrder(env, machineId, includeClosed = false) {
  const status = includeClosed ? "status IN ('active','closed','stopped')" : "status='active'";
  const row = await env.DB.prepare(`SELECT
      machine_id AS machineId,line_id AS lineId,line_name AS lineName,machine_name AS machineName,
      op_number AS op,item_number AS item,item_description AS description,op_target AS opTarget,
      cycle_time_seconds AS cycleSeconds,frequency_1 AS frequency1,frequency_2 AS frequency2,
      piece_length_mm AS pieceLengthMm,produced_total AS producedSoFar,current_bar_pieces AS currentBarPieces,
      feeder_bars AS feederBars,bar_length_mm AS barLengthMm,kerf_mm AS kerfMm,status,
      opened_at AS openedAt,closed_at AS closedAt,updated_at AS updatedAt
    FROM machine_active_orders WHERE machine_id=? AND ${status} LIMIT 1`).bind(machineId).first();
  return mapOrder(row);
}

async function segments(env, machineId, productionDate, shift) {
  const result = await env.DB.prepare(`SELECT
      id,production_date AS productionDate,shift,machine_id AS machineId,line_id AS lineId,
      op_number AS op,item_number AS item,segment_type AS segmentType,
      operator_registration AS operatorRegistration,operator_name AS operatorName,
      started_at AS startedAt,ended_at AS endedAt,opening_production AS openingProduction,
      good_pieces AS goodPieces,rejects,total_cycles AS totalCycles,cycle_time_seconds AS cycleSeconds,
      available_minutes AS availableMinutes,running_minutes AS runningMinutes,downtime_minutes AS downtimeMinutes,
      reject_minutes AS rejectMinutes,downtime_reason AS downtimeReason,downtime_note AS downtimeNote,status
    FROM machine_turn_segments
    WHERE machine_id=? AND production_date=? AND shift=? ORDER BY started_at`)
    .bind(machineId,productionDate,shift).all();
  return result.results || [];
}

function mapTurnState(row) {
  if (!row) return null;
  return {
    productionDate:row.productionDate,shift:String(row.shift),machineId:row.machineId,lineId:row.lineId,
    operatorRegistration:row.operatorRegistration || '',operatorName:row.operatorName || '',
    workflowStatus:row.workflowStatus || 'conference_pending',
    accountedMinutes:Number(row.accountedMinutes || 0),goodPieces:Number(row.goodPieces || 0),
    rejects:Number(row.rejects || 0),stopMinutes:Number(row.stopMinutes || 0),
    lastConferenceAt:row.lastConferenceAt || null,lastPointingAt:row.lastPointingAt || null,
    updatedAt:row.updatedAt || null
  };
}

function mapRuntimeState(row, order = null) {
  return {
    machineId:row?.machineId || order?.machineId || '',
    lineId:row?.lineId || order?.lineId || '',
    physicalStatus:row?.physicalStatus || (order ? 'producing' : 'stopped'),
    reason:row?.reason || '',note:row?.note || '',updatedAt:row?.updatedAt || order?.updatedAt || null
  };
}

async function savedTurnState(env, machineId, productionDate, shift) {
  const row=await env.DB.prepare(`SELECT
      production_date AS productionDate,shift,machine_id AS machineId,line_id AS lineId,
      operator_registration AS operatorRegistration,operator_name AS operatorName,
      workflow_status AS workflowStatus,accounted_minutes AS accountedMinutes,
      good_pieces AS goodPieces,rejects,stop_minutes AS stopMinutes,
      last_conference_at AS lastConferenceAt,last_pointing_at AS lastPointingAt,updated_at AS updatedAt
    FROM machine_turn_states WHERE machine_id=? AND production_date=? AND shift=? LIMIT 1`)
    .bind(machineId,productionDate,shift).first();
  return mapTurnState(row);
}

async function turnState(env, machineId, productionDate, shift, lineId = '') {
  const saved=await savedTurnState(env,machineId,productionDate,shift);
  if(saved)return saved;
  const legacy=await env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='closed' THEN COALESCE(available_minutes,0) ELSE 0 END),0) AS accountedMinutes,
      COALESCE(SUM(CASE WHEN status='closed' THEN COALESCE(good_pieces,0) ELSE 0 END),0) AS goodPieces,
      COALESCE(SUM(CASE WHEN status='closed' THEN COALESCE(rejects,0) ELSE 0 END),0) AS rejects,
      COALESCE(SUM(CASE WHEN status='closed' THEN COALESCE(downtime_minutes,0) ELSE 0 END),0) AS stopMinutes,
      MAX(ended_at) AS lastPointingAt
    FROM machine_turn_segments WHERE machine_id=? AND production_date=? AND shift=?`)
    .bind(machineId,productionDate,shift).first();
  return {
    productionDate,shift:String(shift),machineId,lineId,operatorRegistration:'',operatorName:'',
    workflowStatus:legacy?.lastPointingAt?'conference_pending':'conference_pending',
    accountedMinutes:Number(legacy?.accountedMinutes || 0),goodPieces:Number(legacy?.goodPieces || 0),
    rejects:Number(legacy?.rejects || 0),stopMinutes:Number(legacy?.stopMinutes || 0),
    lastConferenceAt:null,lastPointingAt:legacy?.lastPointingAt || null,updatedAt:null
  };
}

async function runtimeState(env, machineId, order = null) {
  const row=await env.DB.prepare(`SELECT machine_id AS machineId,line_id AS lineId,
      physical_status AS physicalStatus,reason,note,updated_at AS updatedAt
    FROM machine_runtime_states WHERE machine_id=? LIMIT 1`).bind(machineId).first();
  return mapRuntimeState(row,order);
}

function turnClock(rows, state = null) {
  const legacyUsed = rows.reduce((sum,row) => {
    if(row.status!=='closed')return sum;
    const value=number(row.availableMinutes);
    return sum+(value === null ? 0 : value);
  },0);
  return createTurnClock({ totalMinutes:DEFAULT_SHIFT_MINUTES,usedMinutes:state ? state.accountedMinutes : legacyUsed });
}

function flowAxes(order, state, runtime) {
  return {
    physicalStatus:runtime.physicalStatus,
    opStatus:order?.status==='active'?'active':order?.status==='closed'?'closed':'none',
    workflowStatus:state?.workflowStatus || 'conference_pending'
  };
}

async function requireAuth(request, env, machineId = '', lineId = '') {
  const auth = await authenticateRequest(request,env);
  if (!auth) return { response:json({ error:'Sua sessão expirou. Entre novamente.',code:'UNAUTHENTICATED' },401) };
  if (auth.user?.mustChangePassword) return { response:json({ error:'Troque sua senha antes de continuar.',code:'PASSWORD_CHANGE_REQUIRED' },403) };
  if (machineId) {
    const machine=await env.DB.prepare('SELECT id,line_id AS lineId FROM machines WHERE id=? AND active=1 LIMIT 1').bind(machineId).first();
    if(!machine)return { response:json({ error:'Máquina não encontrada ou inativa.',code:'MACHINE_NOT_FOUND' },404) };
    if(lineId&&lineId!==machine.lineId)return { response:json({ error:'A linha informada não pertence a esta máquina.',code:'MACHINE_LINE_MISMATCH' },403) };
    if(!canAccessMachine(auth,machine.lineId,machineId))return { response:json({ error:'Máquina ou linha não autorizada.',code:'MACHINE_FORBIDDEN' },403) };
    return { auth,machine };
  }
  return { auth,machine:null };
}

function requireCapability(auth, permissions = []) {
  if(auth?.user?.roleCode==='admin'||permissions.some(permission=>auth?.permissions?.includes(permission)))return null;
  return json({ error:'Seu perfil não pode alterar este fluxo.',code:'FORBIDDEN' },403);
}

function validShiftPayload(body) {
  return text(body?.productionDate) && ['1','2','3'].includes(text(body?.shift));
}

async function writeEvent(env, request, auth, body, type, payload) {
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO turn_assistant_events (
      id,production_date,shift,machine_id,op_number,event_type,operator_registration,operator_name,payload,ip_address,user_agent,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      uid('turn-event'),text(body.productionDate),text(body.shift),text(body.machineId),text(body.op || body.opNumber),type,
      auth.user.registration,auth.user.name,JSON.stringify(payload),ip(request),agent(request),now
    ).run();
}

async function contextRoute(request, env, url) {
  const machineId = text(url.searchParams.get('machineId'));
  const requestedLineId = text(url.searchParams.get('lineId'));
  const productionDate = text(url.searchParams.get('productionDate'));
  const shift = text(url.searchParams.get('shift'));
  if (!machineId || !productionDate || !['1','2','3'].includes(shift)) {
    return json({ error:'Máquina, data e turno são obrigatórios.',code:'INVALID_CONTEXT' },400);
  }
  const access = await requireAuth(request,env,machineId,requestedLineId); if (access.response) return access.response;
  const denied=requireCapability(access.auth,['machines.view']);if(denied)return denied;
  const lineId=access.machine.lineId;
  const [order,turnSegments,handoff,state] = await Promise.all([
    activeOrder(env,machineId),
    segments(env,machineId,productionDate,shift),
    env.DB.prepare(`SELECT
      production_confirmed AS productionConfirmed,current_bar_pieces AS currentBarPieces,
      feeder_bars AS feederBars,confirmed_at AS confirmedAt,operator_name AS operatorName
      FROM machine_turn_handoffs WHERE machine_id=? ORDER BY confirmed_at DESC LIMIT 1`).bind(machineId).first(),
    turnState(env,machineId,productionDate,shift,lineId)
  ]);
  const runtime=await runtimeState(env,machineId,order);
  const opShiftGoodPieces=order
    ? turnSegments.filter(segment=>segment.status==='closed'&&segment.segmentType==='order'&&String(segment.op)===String(order.op))
      .reduce((sum,segment)=>sum+Number(segment.goodPieces || 0),0)
    : 0;
  return json({
    ok:true,activeOrder:order,segments:turnSegments,handoff:handoff || null,
    turnState:state,runtimeState:runtime,flowAxes:flowAxes(order,state,runtime),
    opShiftGoodPieces,turnClock:turnClock(turnSegments,state)
  });
}

async function handoffRoute(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !validShiftPayload(body)) return json({ error:'Dados do turno inválidos.',code:'INVALID_BODY' },400);
  const machineId = text(body.machineId); const requestedLineId = text(body.lineId);
  const access = await requireAuth(request,env,machineId,requestedLineId); if (access.response) return access.response;
  const denied=requireCapability(access.auth,['conference.create','conference.edit']);if(denied)return denied;
  const lineId=access.machine.lineId;
  const productionConfirmed = number(body.productionConfirmed);
  const currentBarPieces = integer(body.currentBarPieces);
  const feederBars = integer(body.feederBars);
  const requestedCycleSeconds = body.cycleSeconds === undefined ? null : number(body.cycleSeconds);
  if (productionConfirmed === null || productionConfirmed < 0) return json({ error:'Confirme a quantidade produzida.',code:'PRODUCTION_REQUIRED' },400);
  if (body.cycleSeconds !== undefined && !(requestedCycleSeconds > 0)) return json({ error:'Informe um tempo de ciclo válido.',code:'CYCLE_REQUIRED' },400);
  if (currentBarPieces === null) return json({ error:'Informe quantas peças a barra atual ainda fará.',code:'CURRENT_BAR_REQUIRED' },400);
  if (feederBars === null) return json({ error:'Informe quantas barras inteiras estão no alimentador.',code:'FEEDER_BARS_REQUIRED' },400);

  const previous = await activeOrder(env,machineId);
  const effectiveCycleSeconds = requestedCycleSeconds > 0 ? requestedCycleSeconds : number(previous?.cycleSeconds);
  const order = previous ? { ...previous,cycleSeconds:effectiveCycleSeconds } : {
    machineId,lineId,lineName:text(body.lineName),machineName:text(body.machineName),
    op:text(body.op),item:text(body.item),description:text(body.description),opTarget:number(body.opTarget),
    cycleSeconds:effectiveCycleSeconds,frequency1:number(body.frequency1),frequency2:number(body.frequency2),
    pieceLengthMm:number(body.pieceLengthMm),producedSoFar:productionConfirmed,
    currentBarPieces,feederBars,barLengthMm:number(body.barLengthMm) || DEFAULT_BAR_LENGTH_MM,
    kerfMm:number(body.kerfMm) ?? DEFAULT_KERF_MM,status:'active',openedAt:nowIso()
  };
  const cycleChanged = Boolean(previous && requestedCycleSeconds > 0 && Math.abs(Number(previous.cycleSeconds)-requestedCycleSeconds) > 0.0001);
  if (!order.op || !order.item || !(order.opTarget > 0) || !(order.cycleSeconds > 0) || !(order.pieceLengthMm > 0)) {
    return json({ error:'Cadastre OP, item, meta, ciclo e comprimento da peça antes de iniciar.',code:'ORDER_DATA_REQUIRED' },400);
  }

  const now = nowIso();
  const handoffId = uid('handoff');
  const { start:scheduledStart } = shiftBounds(text(body.productionDate),text(body.shift));
  const initialStart = continuousPeriodStart(scheduledStart,now) || scheduledStart;
  const [existingOpen,latestClosed,stateBefore] = await Promise.all([
    env.DB.prepare(`SELECT id,op_number AS op FROM machine_turn_segments
      WHERE machine_id=? AND production_date=? AND shift=? AND status='open' AND segment_type='order'
      ORDER BY started_at DESC LIMIT 1`).bind(machineId,text(body.productionDate),text(body.shift)).first(),
    env.DB.prepare(`SELECT ended_at AS endedAt FROM machine_turn_segments
      WHERE machine_id=? AND production_date=? AND shift=? AND status='closed' AND segment_type='order'
      ORDER BY ended_at DESC LIMIT 1`).bind(machineId,text(body.productionDate),text(body.shift)).first(),
    turnState(env,machineId,text(body.productionDate),text(body.shift),order.lineId || lineId)
  ]);
  const start = latestClosed?.endedAt || stateBefore.accountedMinutes > 0 ? now : initialStart;
  const segmentId = existingOpen?.id || uid('segment');
  const statements = [
    env.DB.prepare(`INSERT INTO machine_active_orders (
      machine_id,line_id,line_name,machine_name,op_number,item_number,item_description,op_target,cycle_time_seconds,
      frequency_1,frequency_2,piece_length_mm,produced_total,current_bar_pieces,feeder_bars,bar_length_mm,kerf_mm,
      status,opened_at,closed_at,updated_at,updated_by_registration,updated_by_name
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,NULL,?,?,?)
    ON CONFLICT(machine_id) DO UPDATE SET
      line_id=excluded.line_id,line_name=excluded.line_name,machine_name=excluded.machine_name,
      op_number=excluded.op_number,item_number=excluded.item_number,item_description=excluded.item_description,
      op_target=excluded.op_target,cycle_time_seconds=excluded.cycle_time_seconds,frequency_1=excluded.frequency_1,
      frequency_2=excluded.frequency_2,piece_length_mm=excluded.piece_length_mm,produced_total=excluded.produced_total,
      current_bar_pieces=excluded.current_bar_pieces,feeder_bars=excluded.feeder_bars,
      bar_length_mm=excluded.bar_length_mm,kerf_mm=excluded.kerf_mm,status='active',closed_at=NULL,
      updated_at=excluded.updated_at,updated_by_registration=excluded.updated_by_registration,updated_by_name=excluded.updated_by_name`)
      .bind(machineId,order.lineId || lineId,order.lineName || text(body.lineName),order.machineName || text(body.machineName),
        order.op,order.item,order.description || '',order.opTarget,order.cycleSeconds,order.frequency1,order.frequency2,
        order.pieceLengthMm,productionConfirmed,currentBarPieces,feederBars,order.barLengthMm || DEFAULT_BAR_LENGTH_MM,
        order.kerfMm ?? DEFAULT_KERF_MM,order.openedAt || now,now,access.auth.user.registration,access.auth.user.name),
    env.DB.prepare(`INSERT INTO machine_turn_handoffs (
      id,production_date,shift,machine_id,op_number,operator_registration,operator_name,
      production_before,production_confirmed,current_bar_pieces,feeder_bars,confirmed_at,correction_note,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      handoffId,text(body.productionDate),text(body.shift),machineId,order.op,access.auth.user.registration,access.auth.user.name,
      previous?.producedSoFar ?? productionConfirmed,productionConfirmed,currentBarPieces,feederBars,now,text(body.correctionNote),now
    ),
    env.DB.prepare(`INSERT INTO machine_turn_states (
      production_date,shift,machine_id,line_id,operator_registration,operator_name,workflow_status,
      accounted_minutes,good_pieces,rejects,stop_minutes,last_conference_at,last_pointing_at,updated_at
    ) VALUES (?,?,?,?,?,?,'ready',?,?,?,?,?,?,?)
    ON CONFLICT(production_date,shift,machine_id) DO UPDATE SET
      line_id=excluded.line_id,operator_registration=excluded.operator_registration,operator_name=excluded.operator_name,
      workflow_status='ready',last_conference_at=excluded.last_conference_at,updated_at=excluded.updated_at`).bind(
      text(body.productionDate),text(body.shift),machineId,order.lineId || lineId,
      access.auth.user.registration,access.auth.user.name,stateBefore.accountedMinutes,stateBefore.goodPieces,
      stateBefore.rejects,stateBefore.stopMinutes,now,stateBefore.lastPointingAt,now
    ),
    env.DB.prepare(`INSERT INTO machine_runtime_states (
      machine_id,line_id,physical_status,reason,note,updated_at,updated_by_registration,updated_by_name
    ) VALUES (?,?,'producing','','',?,?,?)
    ON CONFLICT(machine_id) DO UPDATE SET
      line_id=excluded.line_id,physical_status='producing',reason='',note='',updated_at=excluded.updated_at,
      updated_by_registration=excluded.updated_by_registration,updated_by_name=excluded.updated_by_name`).bind(
      machineId,order.lineId || lineId,now,access.auth.user.registration,access.auth.user.name
    )
  ];
  if (existingOpen && cycleChanged) {
    statements.push(env.DB.prepare(`UPDATE machine_turn_segments
      SET cycle_time_seconds=?,updated_at=? WHERE id=?`).bind(order.cycleSeconds,now,existingOpen.id));
  }
  if (!existingOpen) {
    statements.push(env.DB.prepare(`INSERT INTO machine_turn_segments (
      id,production_date,shift,machine_id,line_id,op_number,item_number,segment_type,
      operator_registration,operator_name,started_at,opening_production,cycle_time_seconds,status,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,'order',?,?,?,?,?,'open',?,?)`).bind(
      segmentId,text(body.productionDate),text(body.shift),machineId,order.lineId || lineId,order.op,order.item,
      access.auth.user.registration,access.auth.user.name,start,productionConfirmed,order.cycleSeconds,now,now
    ));
  }
  await env.DB.batch(statements);
  await writeEvent(env,request,access.auth,body,'turn.handoff_confirmed',{
    productionConfirmed,currentBarPieces,feederBars,segmentId,cycleSeconds:order.cycleSeconds,
    previousCycleSeconds:previous?.cycleSeconds ?? null,cycleChanged
  });
  const saved = await activeOrder(env,machineId);
  const turnSegments = await segments(env,machineId,text(body.productionDate),text(body.shift));
  const savedState=await savedTurnState(env,machineId,text(body.productionDate),text(body.shift));
  const runtime=await runtimeState(env,machineId,saved);
  const opShiftGoodPieces=turnSegments.filter(segment=>segment.status==='closed'&&segment.segmentType==='order'&&String(segment.op)===String(saved.op))
    .reduce((sum,segment)=>sum+Number(segment.goodPieces || 0),0);
  return json({
    ok:true,activeOrder:saved,segmentId,handoff:{ id:handoffId,confirmedAt:now },segments:turnSegments,
    turnState:savedState,runtimeState:runtime,flowAxes:flowAxes(saved,savedState,runtime),
    opShiftGoodPieces,turnClock:turnClock(turnSegments,savedState)
  },201);
}

function performance({ availableMinutes,goodPieces,rejects,cycleSeconds }) {
  const totalCycles = goodPieces + rejects;
  const runningMinutes = totalCycles * cycleSeconds / 60;
  const raw = availableMinutes - runningMinutes;
  return {
    totalCycles,runningMinutes,downtimeMinutes:Math.max(0,raw),rejectMinutes:rejects * cycleSeconds / 60,
    overrunMinutes:Math.max(0,-raw),inconsistent:raw < -0.01
  };
}

async function closePeriodRoute(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !validShiftPayload(body)) return json({ error:'Dados do fechamento inválidos.',code:'INVALID_BODY' },400);
  const machineId=text(body.machineId); const requestedLineId=text(body.lineId);
  const access=await requireAuth(request,env,machineId,requestedLineId); if(access.response)return access.response;
  const denied=requireCapability(access.auth,['production.create']);if(denied)return denied;
  const lineId=access.machine.lineId;
  const goodPieces=integer(body.goodPieces); const rejects=integer(body.rejects);
  const stopMinutes=number(body.stopMinutes) ?? 0;
  if(goodPieces===null)return json({ error:'Informe as peças boas produzidas.',code:'GOOD_PIECES_REQUIRED' },400);
  if(rejects===null)return json({ error:'Informe a quantidade de refugos.',code:'REJECTS_REQUIRED' },400);
  if(stopMinutes<0)return json({ error:'Os minutos de parada não podem ser negativos.',code:'INVALID_STOP_MINUTES' },400);
  const order=await activeOrder(env,machineId);
  if(!order)return json({ error:'Nenhuma OP ativa foi encontrada para esta máquina.',code:'ACTIVE_ORDER_NOT_FOUND' },409);
  const segment=await env.DB.prepare(`SELECT id,started_at AS startedAt,cycle_time_seconds AS cycleSeconds
    FROM machine_turn_segments WHERE machine_id=? AND production_date=? AND shift=? AND status='open' AND segment_type='order'
    ORDER BY started_at DESC LIMIT 1`).bind(machineId,text(body.productionDate),text(body.shift)).first();
  if(!segment)return json({ error:'Confirme os dados da máquina antes de apontar.',code:'OPEN_SEGMENT_NOT_FOUND' },409);
  const mode=text(body.mode)==='order'?'order':'pointing';
  const finalShift=body.finalShift===true;
  const now=nowIso();
  const endedAt=now;
  const stateBefore=await turnState(env,machineId,text(body.productionDate),text(body.shift),lineId || order.lineId);
  const result=calculatePointingAccounting({
    totalMinutes:DEFAULT_SHIFT_MINUTES,usedMinutes:stateBefore.accountedMinutes,
    goodPieces,rejects,stopMinutes,cycleSeconds:Number(segment.cycleSeconds || order.cycleSeconds)
  });
  if(!result.accepted)return json({ error:`Informe ${result.missing.join(', ')}.`,code:'INVALID_POINTING' },400);
  const newTotal=Number(order.producedSoFar || 0)+goodPieces;
  const status=mode==='order'?'closed':'active';
  const workflowStatus=finalShift?'shift_closed':'conference_pending';
  const eventId=uid('turn-event');
  const payload={
    mode,finalShift,goodPieces,rejects,stopMinutes,
    productiveMinutes:result.productiveMinutes,accountedMinutes:result.accountedMinutes,
    remainingBefore:result.remainingBefore,remainingAfter:result.remainingAfter,
    overrunMinutes:result.overrunMinutes,downtimeReason:text(body.downtimeReason),downtimeNote:text(body.downtimeNote)
  };
  await env.DB.batch([
    env.DB.prepare(`UPDATE machine_turn_segments SET
      ended_at=?,good_pieces=?,rejects=?,total_cycles=?,available_minutes=?,running_minutes=?,downtime_minutes=?,
      reject_minutes=?,downtime_reason=?,downtime_note=?,status='closed',updated_at=? WHERE id=?`).bind(
        endedAt,goodPieces,rejects,result.totalCycles,result.accountedMinutes,result.productiveMinutes,result.stopMinutes,
        result.rejectMinutes,text(body.downtimeReason),text(body.downtimeNote),now,segment.id
      ),
    env.DB.prepare(`UPDATE machine_active_orders SET produced_total=?,status=?,closed_at=?,updated_at=?,updated_by_registration=?,updated_by_name=? WHERE machine_id=?`).bind(
      newTotal,status,mode==='order'?endedAt:null,now,access.auth.user.registration,access.auth.user.name,machineId
    ),
    env.DB.prepare(`INSERT INTO machine_turn_states (
      production_date,shift,machine_id,line_id,operator_registration,operator_name,workflow_status,
      accounted_minutes,good_pieces,rejects,stop_minutes,last_conference_at,last_pointing_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(production_date,shift,machine_id) DO UPDATE SET
      line_id=excluded.line_id,operator_registration=excluded.operator_registration,operator_name=excluded.operator_name,
      workflow_status=excluded.workflow_status,accounted_minutes=excluded.accounted_minutes,
      good_pieces=excluded.good_pieces,rejects=excluded.rejects,stop_minutes=excluded.stop_minutes,
      last_conference_at=excluded.last_conference_at,last_pointing_at=excluded.last_pointing_at,updated_at=excluded.updated_at`).bind(
      text(body.productionDate),text(body.shift),machineId,lineId || order.lineId,
      access.auth.user.registration,access.auth.user.name,workflowStatus,result.usedAfter,
      stateBefore.goodPieces+goodPieces,stateBefore.rejects+rejects,stateBefore.stopMinutes+stopMinutes,
      stateBefore.lastConferenceAt,now,now
    ),
    env.DB.prepare(`INSERT INTO turn_assistant_events (
      id,production_date,shift,machine_id,op_number,event_type,operator_registration,operator_name,payload,ip_address,user_agent,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      eventId,text(body.productionDate),text(body.shift),machineId,order.op,
      mode==='order'?'order.closed':finalShift?'shift.finalized':'production.pointed',
      access.auth.user.registration,access.auth.user.name,JSON.stringify(payload),ip(request),agent(request),now
    )
  ]);
  const turnSegments=await segments(env,machineId,text(body.productionDate),text(body.shift));
  const savedState=await savedTurnState(env,machineId,text(body.productionDate),text(body.shift));
  const nextOrder=mode==='order'?null:{ ...order,producedSoFar:newTotal,updatedAt:now,status:'active' };
  const runtime=await runtimeState(env,machineId,nextOrder);
  return json({ ok:true,mode,finalShift,activeOrder:nextOrder,
    closedOrder:mode==='order'?{ ...order,producedSoFar:newTotal,status:'closed',closedAt:endedAt }:null,
    performance:{
      ...result,availableMinutes:result.remainingBefore,runningMinutes:result.productiveMinutes,
      downtimeMinutes:result.stopMinutes
    },
    turnState:savedState,runtimeState:runtime,flowAxes:flowAxes(nextOrder || { ...order,status:'closed' },savedState,runtime),
    segments:turnSegments,turnClock:turnClock(turnSegments,savedState),endedAt });
}

async function startOrderRoute(request, env) {
  const body=await request.json().catch(()=>null);
  if(!body||!validShiftPayload(body))return json({ error:'Dados da nova OP inválidos.',code:'INVALID_BODY' },400);
  const machineId=text(body.machineId);const requestedLineId=text(body.lineId);
  const access=await requireAuth(request,env,machineId,requestedLineId);if(access.response)return access.response;
  const denied=requireCapability(access.auth,['production.create']);if(denied)return denied;
  const lineId=access.machine.lineId;
  const previous=await activeOrder(env,machineId,true);
  const sameItem=text(body.orderType)==='same-item';
  const op=text(body.op);const item=sameItem?text(previous?.item):text(body.item);
  const description=sameItem?text(previous?.description):text(body.description);
  const opTarget=number(body.opTarget);
  const cycleSeconds=sameItem?number(previous?.cycleSeconds):number(body.cycleSeconds);
  const frequency1=sameItem?number(previous?.frequency1):number(body.frequency1);
  const frequency2=sameItem?number(previous?.frequency2):number(body.frequency2);
  const pieceLengthMm=sameItem?number(previous?.pieceLengthMm):number(body.pieceLengthMm);
  const producedSoFar=number(body.productionInitial) ?? 0;
  const currentBarPieces=integer(body.currentBarPieces);const feederBars=integer(body.feederBars);
  if(!op)return json({ error:'Informe o número da nova OP.',code:'OP_REQUIRED' },400);
  if(!item)return json({ error:'Informe o item da nova OP.',code:'ITEM_REQUIRED' },400);
  if(!(opTarget>0))return json({ error:'Informe a meta da nova OP.',code:'OP_TARGET_REQUIRED' },400);
  if(!(cycleSeconds>0))return json({ error:'Informe um tempo de ciclo válido.',code:'CYCLE_REQUIRED' },400);
  if(!(pieceLengthMm>0))return json({ error:'Informe o comprimento da peça.',code:'PIECE_LENGTH_REQUIRED' },400);
  if(currentBarPieces===null)return json({ error:'Informe quantas peças a barra atual ainda fará.',code:'CURRENT_BAR_REQUIRED' },400);
  if(feederBars===null)return json({ error:'Informe quantas barras inteiras estão no alimentador.',code:'FEEDER_BARS_REQUIRED' },400);
  const now=nowIso();
  const openOther=await env.DB.prepare(`SELECT id,started_at AS startedAt,segment_type AS segmentType FROM machine_turn_segments
    WHERE machine_id=? AND production_date=? AND shift=? AND status='open' ORDER BY started_at DESC LIMIT 1`)
    .bind(machineId,text(body.productionDate),text(body.shift)).first();
  const stateBefore=await turnState(env,machineId,text(body.productionDate),text(body.shift),lineId);
  const statements=[];
  if(openOther){
    statements.push(env.DB.prepare(`UPDATE machine_turn_segments SET ended_at=?,available_minutes=?,downtime_minutes=?,downtime_reason=?,status='closed',updated_at=? WHERE id=?`)
      .bind(now,0,0,text(body.transitionReason)||'Troca de ordem',now,openOther.id));
  }
  const segmentId=uid('segment');
  statements.push(
    env.DB.prepare(`INSERT INTO machine_active_orders (
      machine_id,line_id,line_name,machine_name,op_number,item_number,item_description,op_target,cycle_time_seconds,
      frequency_1,frequency_2,piece_length_mm,produced_total,current_bar_pieces,feeder_bars,bar_length_mm,kerf_mm,
      status,opened_at,closed_at,updated_at,updated_by_registration,updated_by_name
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,NULL,?,?,?)
    ON CONFLICT(machine_id) DO UPDATE SET
      line_id=excluded.line_id,line_name=excluded.line_name,machine_name=excluded.machine_name,op_number=excluded.op_number,
      item_number=excluded.item_number,item_description=excluded.item_description,op_target=excluded.op_target,
      cycle_time_seconds=excluded.cycle_time_seconds,frequency_1=excluded.frequency_1,frequency_2=excluded.frequency_2,
      piece_length_mm=excluded.piece_length_mm,produced_total=excluded.produced_total,current_bar_pieces=excluded.current_bar_pieces,
      feeder_bars=excluded.feeder_bars,bar_length_mm=excluded.bar_length_mm,kerf_mm=excluded.kerf_mm,status='active',
      opened_at=excluded.opened_at,closed_at=NULL,updated_at=excluded.updated_at,
      updated_by_registration=excluded.updated_by_registration,updated_by_name=excluded.updated_by_name`).bind(
        machineId,lineId,text(body.lineName),text(body.machineName),op,item,description,opTarget,cycleSeconds,frequency1,frequency2,
        pieceLengthMm,producedSoFar,currentBarPieces,feederBars,number(previous?.barLengthMm)||DEFAULT_BAR_LENGTH_MM,
        number(previous?.kerfMm)??DEFAULT_KERF_MM,now,now,access.auth.user.registration,access.auth.user.name
      ),
    env.DB.prepare(`INSERT INTO machine_turn_segments (
      id,production_date,shift,machine_id,line_id,op_number,item_number,segment_type,operator_registration,operator_name,
      started_at,opening_production,cycle_time_seconds,status,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,'order',?,?,?,?,?,'open',?,?)`).bind(
      segmentId,text(body.productionDate),text(body.shift),machineId,lineId,op,item,access.auth.user.registration,access.auth.user.name,
      now,producedSoFar,cycleSeconds,now,now
    ),
    env.DB.prepare(`INSERT INTO machine_turn_states (
      production_date,shift,machine_id,line_id,operator_registration,operator_name,workflow_status,
      accounted_minutes,good_pieces,rejects,stop_minutes,last_conference_at,last_pointing_at,updated_at
    ) VALUES (?,?,?,?,?,?,'ready',?,?,?,?,?,?,?)
    ON CONFLICT(production_date,shift,machine_id) DO UPDATE SET
      line_id=excluded.line_id,operator_registration=excluded.operator_registration,operator_name=excluded.operator_name,
      workflow_status='ready',last_conference_at=excluded.last_conference_at,updated_at=excluded.updated_at`).bind(
      text(body.productionDate),text(body.shift),machineId,lineId,access.auth.user.registration,access.auth.user.name,
      stateBefore.accountedMinutes,stateBefore.goodPieces,stateBefore.rejects,stateBefore.stopMinutes,
      now,stateBefore.lastPointingAt,now
    ),
    env.DB.prepare(`INSERT INTO machine_runtime_states (
      machine_id,line_id,physical_status,reason,note,updated_at,updated_by_registration,updated_by_name
    ) VALUES (?,?,'producing','','',?,?,?)
    ON CONFLICT(machine_id) DO UPDATE SET
      line_id=excluded.line_id,physical_status='producing',reason='',note='',updated_at=excluded.updated_at,
      updated_by_registration=excluded.updated_by_registration,updated_by_name=excluded.updated_by_name`).bind(
      machineId,lineId,now,access.auth.user.registration,access.auth.user.name
    )
  );
  await env.DB.batch(statements);
  await writeEvent(env,request,access.auth,{ ...body,op },'order.started',{ orderType:sameItem?'same-item':'different-item',segmentId });
  const order=await activeOrder(env,machineId);
  const turnSegments=await segments(env,machineId,text(body.productionDate),text(body.shift));
  const savedState=await savedTurnState(env,machineId,text(body.productionDate),text(body.shift));
  const runtime=await runtimeState(env,machineId,order);
  return json({
    ok:true,activeOrder:order,segmentId,segments:turnSegments,turnState:savedState,runtimeState:runtime,
    flowAxes:flowAxes(order,savedState,runtime),opShiftGoodPieces:0,turnClock:turnClock(turnSegments,savedState)
  },201);
}

async function stoppedRoute(request, env) {
  const body=await request.json().catch(()=>null);
  if(!body||!validShiftPayload(body))return json({ error:'Dados inválidos.',code:'INVALID_BODY' },400);
  const machineId=text(body.machineId);const requestedLineId=text(body.lineId);
  const access=await requireAuth(request,env,machineId,requestedLineId);if(access.response)return access.response;
  const denied=requireCapability(access.auth,['machines.update_status']);if(denied)return denied;
  const lineId=access.machine.lineId;
  const now=nowIso();
  const segmentId=uid('segment');
  const stateBefore=await turnState(env,machineId,text(body.productionDate),text(body.shift),lineId);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO machine_runtime_states (
      machine_id,line_id,physical_status,reason,note,updated_at,updated_by_registration,updated_by_name
    ) VALUES (?,?,'stopped',?,?,?,?,?)
    ON CONFLICT(machine_id) DO UPDATE SET
      line_id=excluded.line_id,physical_status='stopped',reason=excluded.reason,note=excluded.note,
      updated_at=excluded.updated_at,updated_by_registration=excluded.updated_by_registration,
      updated_by_name=excluded.updated_by_name`).bind(
      machineId,lineId,text(body.reason)||'Sem programação',text(body.note),now,
      access.auth.user.registration,access.auth.user.name
    ),
    env.DB.prepare(`INSERT INTO machine_turn_states (
      production_date,shift,machine_id,line_id,operator_registration,operator_name,workflow_status,
      accounted_minutes,good_pieces,rejects,stop_minutes,last_conference_at,last_pointing_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(production_date,shift,machine_id) DO UPDATE SET
      line_id=excluded.line_id,operator_registration=excluded.operator_registration,operator_name=excluded.operator_name,
      workflow_status=excluded.workflow_status,updated_at=excluded.updated_at`).bind(
      text(body.productionDate),text(body.shift),machineId,lineId,access.auth.user.registration,access.auth.user.name,
      stateBefore.workflowStatus==='shift_closed'?'shift_closed':'conference_pending',
      stateBefore.accountedMinutes,stateBefore.goodPieces,stateBefore.rejects,stateBefore.stopMinutes,
      stateBefore.lastConferenceAt,stateBefore.lastPointingAt,now
    ),
    env.DB.prepare(`INSERT INTO machine_turn_segments (
      id,production_date,shift,machine_id,line_id,segment_type,operator_registration,operator_name,
      started_at,downtime_reason,downtime_note,status,created_at,updated_at
    ) VALUES (?,?,?,?,?,'idle',?,?,?,?,?,'open',?,?)`).bind(
      segmentId,text(body.productionDate),text(body.shift),machineId,lineId,access.auth.user.registration,access.auth.user.name,
      now,text(body.reason)||'Sem programação',text(body.note),now,now
    )
  ]);
  await writeEvent(env,request,access.auth,body,'machine.stopped',{ reason:text(body.reason)||'Sem programação',segmentId });
  const savedState=await savedTurnState(env,machineId,text(body.productionDate),text(body.shift));
  const runtime=await runtimeState(env,machineId,null);
  return json({
    ok:true,segmentId,status:'stopped',activeOrder:null,turnState:savedState,runtimeState:runtime,
    flowAxes:flowAxes(null,savedState,runtime),turnClock:createTurnClock({ usedMinutes:savedState.accountedMinutes })
  });
}

function dashboardForecast(order) {
  if(!order)return { reason:'none',estimatedAt:null,materialEstimatedAt:null,opRemaining:0,availablePieces:0 };
  const opRemaining=Math.max(0,Math.ceil(Number(order.opTarget || 0)-Number(order.producedSoFar || 0)));
  const divisor=Number(order.pieceLengthMm || 0)+Number(order.kerfMm || DEFAULT_KERF_MM);
  const piecesPerFullBar=divisor>0?Math.max(0,Math.floor(Number(order.barLengthMm || DEFAULT_BAR_LENGTH_MM)/divisor)):0;
  const availablePieces=Math.max(0,Number(order.currentBarPieces || 0)+Number(order.feederBars || 0)*piecesPerFullBar);
  const reason=availablePieces<opRemaining?'material':'op';
  const stopPieces=Math.min(opRemaining,availablePieces);
  const estimatedAt=Number(order.cycleSeconds)>0
    ?new Date(Date.now()+stopPieces*Number(order.cycleSeconds)*1000).toISOString()
    :null;
  const materialEstimatedAt=Number(order.cycleSeconds)>0
    ?new Date(Date.now()+availablePieces*Number(order.cycleSeconds)*1000).toISOString()
    :null;
  return { reason,estimatedAt,materialEstimatedAt,opRemaining,availablePieces,piecesPerFullBar,stopPieces };
}

function dashboardRisk(order, state, runtime, forecast) {
  if(runtime.physicalStatus==='maintenance')return { priority:1,code:'maintenance',label:'Manutenção' };
  if(runtime.physicalStatus==='stopped')return { priority:2,code:'stopped',label:'Máquina parada' };
  if(order&&state.workflowStatus==='conference_pending')return { priority:1,code:'conference_pending',label:'Conferência pendente' };
  if(!order)return { priority:3,code:'no_order',label:'Sem OP ativa' };
  if(forecast.reason==='material')return { priority:2,code:'material',label:'Risco de matéria-prima' };
  const minutesToClose=forecast.stopPieces*Number(order.cycleSeconds || 0)/60;
  if(minutesToClose<=120)return { priority:3,code:'closing_soon',label:'OP fecha em breve' };
  return { priority:5,code:'normal',label:'Normal' };
}

async function lineDashboardRoute(request, env, url) {
  const access=await requireAuth(request,env);if(access.response)return access.response;
  const auth=access.auth;
  const allowed=['admin','leadership','preparator'].includes(auth.user.roleCode);
  if(!allowed)return json({ error:'Acesso restrito ao preparador e à liderança.',code:'FORBIDDEN' },403);
  const detected=detectOperationalContext();
  const productionDate=text(url.searchParams.get('productionDate'))||detected.productionDate;
  const shift=['1','2','3'].includes(text(url.searchParams.get('shift')))?text(url.searchParams.get('shift')):detected.shift;
  const conditions=['m.active=1'];
  const bindings=[productionDate,shift,productionDate,shift];
  if(auth.user.roleCode!=='admin'){
    if(!auth.lineAccess.length)return json({ ok:true,productionDate,shift,serverTime:nowIso(),lines:[],machines:[],summary:{ total:0,producing:0,setup:0,stopped:0,pending:0,closingSoon:0,materialRisks:0 } });
    conditions.push(`m.line_id IN (${auth.lineAccess.map(()=>'?').join(',')})`);
    bindings.push(...auth.lineAccess);
  }
  if(auth.machineAccess.length){
    conditions.push(`m.id IN (${auth.machineAccess.map(()=>'?').join(',')})`);
    bindings.push(...auth.machineAccess);
  }
  const result=await env.DB.prepare(`SELECT
      m.id AS machineId,m.name AS machineName,m.line_id AS lineId,pl.name AS lineName,
      ao.op_number AS op,ao.item_number AS item,ao.item_description AS description,ao.op_target AS opTarget,
      ao.cycle_time_seconds AS cycleSeconds,ao.frequency_1 AS frequency1,ao.frequency_2 AS frequency2,
      ao.piece_length_mm AS pieceLengthMm,ao.produced_total AS producedSoFar,
      ao.current_bar_pieces AS currentBarPieces,ao.feeder_bars AS feederBars,
      ao.bar_length_mm AS barLengthMm,ao.kerf_mm AS kerfMm,ao.status AS orderStatus,
      ts.operator_registration AS stateRegistration,ts.operator_name AS stateOperatorName,
      ts.workflow_status AS workflowStatus,ts.accounted_minutes AS accountedMinutes,
      ts.good_pieces AS shiftGoodPieces,ts.rejects AS shiftRejects,ts.stop_minutes AS shiftStopMinutes,
      ts.last_conference_at AS lastConferenceAt,ts.last_pointing_at AS lastPointingAt,ts.updated_at AS stateUpdatedAt,
      rs.physical_status AS physicalStatus,rs.reason AS physicalReason,rs.note AS physicalNote,rs.updated_at AS runtimeUpdatedAt,
      assignment.operator_registration AS assignedRegistration,assignment.operator_name AS assignedOperatorName
    FROM machines m
    JOIN production_lines pl ON pl.id=m.line_id
    LEFT JOIN machine_active_orders ao ON ao.machine_id=m.id AND ao.status='active'
    LEFT JOIN machine_turn_states ts ON ts.machine_id=m.id AND ts.production_date=? AND ts.shift=?
    LEFT JOIN machine_runtime_states rs ON rs.machine_id=m.id
    LEFT JOIN operator_machine_assignments assignment ON assignment.id=(
      SELECT latest.id FROM operator_machine_assignments latest
      WHERE latest.machine_id=m.id AND latest.production_date=? AND latest.shift=?
      ORDER BY latest.updated_at DESC,latest.id DESC LIMIT 1
    )
    WHERE ${conditions.join(' AND ')}
    ORDER BY pl.sort_order,m.sort_order,m.name`).bind(...bindings).all();
  const machines=(result.results||[]).map(row=>{
    const order=row.op?mapOrder({
      machineId:row.machineId,lineId:row.lineId,lineName:row.lineName,machineName:row.machineName,
      op:row.op,item:row.item,description:row.description,opTarget:row.opTarget,cycleSeconds:row.cycleSeconds,
      frequency1:row.frequency1,frequency2:row.frequency2,pieceLengthMm:row.pieceLengthMm,
      producedSoFar:row.producedSoFar,currentBarPieces:row.currentBarPieces,feederBars:row.feederBars,
      barLengthMm:row.barLengthMm,kerfMm:row.kerfMm,status:row.orderStatus,openedAt:null,closedAt:null,updatedAt:row.stateUpdatedAt
    }):null;
    const state=mapTurnState({
      productionDate,shift,machineId:row.machineId,lineId:row.lineId,
      operatorRegistration:row.stateRegistration,operatorName:row.stateOperatorName,
      workflowStatus:row.workflowStatus||'conference_pending',accountedMinutes:row.accountedMinutes,
      goodPieces:row.shiftGoodPieces,rejects:row.shiftRejects,stopMinutes:row.shiftStopMinutes,
      lastConferenceAt:row.lastConferenceAt,lastPointingAt:row.lastPointingAt,updatedAt:row.stateUpdatedAt
    });
    const runtime=mapRuntimeState({
      machineId:row.machineId,lineId:row.lineId,physicalStatus:row.physicalStatus||(order?'producing':'stopped'),
      reason:row.physicalReason,note:row.physicalNote,updatedAt:row.runtimeUpdatedAt
    },order);
    const forecast=dashboardForecast(order);
    return {
      machineId:row.machineId,machineName:row.machineName,lineId:row.lineId,lineName:row.lineName,
      assignedOperator:row.assignedRegistration?{ registration:row.assignedRegistration,name:row.assignedOperatorName }:null,
      activeOrder:order,turnState:state,runtimeState:runtime,flowAxes:flowAxes(order,state,runtime),
      turnClock:createTurnClock({ usedMinutes:state.accountedMinutes }),forecast,
      risk:dashboardRisk(order,state,runtime,forecast)
    };
  }).sort((left,right)=>left.risk.priority-right.risk.priority||left.lineName.localeCompare(right.lineName)||left.machineName.localeCompare(right.machineName));
  const summary={
    total:machines.length,
    producing:machines.filter(machine=>machine.runtimeState.physicalStatus==='producing').length,
    setup:machines.filter(machine=>machine.runtimeState.physicalStatus==='setup').length,
    stopped:machines.filter(machine=>['stopped','maintenance'].includes(machine.runtimeState.physicalStatus)).length,
    pending:machines.filter(machine=>machine.flowAxes.workflowStatus==='conference_pending'&&machine.activeOrder).length,
    closingSoon:machines.filter(machine=>machine.risk.code==='closing_soon').length,
    materialRisks:machines.filter(machine=>machine.risk.code==='material').length
  };
  const lines=[...new Map(machines.map(machine=>[machine.lineId,{ id:machine.lineId,name:machine.lineName }])).values()];
  return json({ ok:true,productionDate,shift,serverTime:nowIso(),lines,machines,summary });
}

export async function handleTurnAssistant(request, env) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/v1/turn-assistant/'))return null;
  await ensureTables(env);
  if(!sameOrigin(request) && request.method!=='GET')return json({ error:'Origem da requisição não autorizada.',code:'INVALID_ORIGIN' },403);
  if(url.pathname==='/api/v1/turn-assistant/context'&&request.method==='GET')return contextRoute(request,env,url);
  if(url.pathname==='/api/v1/turn-assistant/handoff'&&request.method==='POST')return handoffRoute(request,env);
  if(url.pathname==='/api/v1/turn-assistant/close-period'&&request.method==='POST')return closePeriodRoute(request,env);
  if(url.pathname==='/api/v1/turn-assistant/start-order'&&request.method==='POST')return startOrderRoute(request,env);
  if(url.pathname==='/api/v1/turn-assistant/stopped'&&request.method==='POST')return stoppedRoute(request,env);
  if(url.pathname==='/api/v1/turn-assistant/line-dashboard'&&request.method==='GET')return lineDashboardRoute(request,env,url);
  return json({ error:'Rota do assistente de turno não encontrada.',code:'NOT_FOUND' },404);
}

export async function turnAssistantHealth(env) {
  await ensureTables(env);
  const tables=[
    'machine_active_orders','machine_turn_handoffs','machine_turn_segments','turn_assistant_events',
    'machine_turn_states','machine_runtime_states'
  ];
  const found=[];
  for(const table of tables){
    const row=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
    if(row?.name)found.push(row.name);
  }
  const sample=calculatePointingAccounting({ usedMinutes:0,goodPieces:80,rejects:4,cycleSeconds:300,stopMinutes:60 });
  const rolloverMinutes=continuousDurationMinutes('2026-08-05T17:30:00.000Z','2026-08-05T16:25:00.000Z');
  const automaticShift=detectOperationalContext('2026-08-06T07:00:00.000Z');
  return {
    ok:found.length===tables.length&&Math.round(sample.accountedMinutes)===480&&rolloverMinutes===1375
      &&automaticShift.shift==='3'&&automaticShift.productionDate==='2026-08-05',
    version:'6.0.0',
    schemaReady:found.length===tables.length,
    tables:found,
    periodCalculationReady:Math.round(sample.productiveMinutes)===420&&Math.round(sample.stopMinutes)===60&&rolloverMinutes===1375,
    rolloverMinutes,
    pointingValidation:'advisory-only',
    minuteLedger:'logical-accounted-per-machine-shift',
    automaticShift,
    stateAxes:['physicalStatus','opStatus','workflowStatus'],
    shiftMinutes:DEFAULT_SHIFT_MINUTES,
    transaction:'d1-batch'
  };
}
