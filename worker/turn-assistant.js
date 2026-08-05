import { ensureAuthTables, authenticateRequest, canAccessMachine } from './auth.js';

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
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_handoff_machine ON machine_turn_handoffs (machine_id,confirmed_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_segments_machine_shift ON machine_turn_segments (machine_id,production_date,shift,started_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_segments_open ON machine_turn_segments (machine_id,status,production_date,shift)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_turn_events_machine ON turn_assistant_events (machine_id,created_at DESC)')
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

function turnClock(rows) {
  const used = rows.reduce((sum,row) => {
    const value = number(row.availableMinutes);
    if (value !== null) return sum + value;
    if (row.endedAt) return sum + durationMinutes(row.startedAt,row.endedAt);
    return sum;
  },0);
  return {
    totalMinutes:DEFAULT_SHIFT_MINUTES,
    usedMinutes:used,
    remainingMinutes:Math.max(0,DEFAULT_SHIFT_MINUTES - used),
    overrunMinutes:Math.max(0,used - DEFAULT_SHIFT_MINUTES)
  };
}

async function requireAuth(request, env, machineId = '', lineId = '') {
  const auth = await authenticateRequest(request,env);
  if (!auth) return { response:json({ error:'Sua sessão expirou. Entre novamente.',code:'UNAUTHENTICATED' },401) };
  if (auth.user?.mustChangePassword) return { response:json({ error:'Troque sua senha antes de continuar.',code:'PASSWORD_CHANGE_REQUIRED' },403) };
  if (machineId && !canAccessMachine(auth,lineId,machineId)) return { response:json({ error:'Máquina ou linha não autorizada.',code:'MACHINE_FORBIDDEN' },403) };
  return { auth };
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
  const lineId = text(url.searchParams.get('lineId'));
  const productionDate = text(url.searchParams.get('productionDate'));
  const shift = text(url.searchParams.get('shift'));
  if (!machineId || !productionDate || !['1','2','3'].includes(shift)) {
    return json({ error:'Máquina, data e turno são obrigatórios.',code:'INVALID_CONTEXT' },400);
  }
  const access = await requireAuth(request,env,machineId,lineId); if (access.response) return access.response;
  const [order,turnSegments,handoff] = await Promise.all([
    activeOrder(env,machineId),
    segments(env,machineId,productionDate,shift),
    env.DB.prepare(`SELECT
      production_confirmed AS productionConfirmed,current_bar_pieces AS currentBarPieces,
      feeder_bars AS feederBars,confirmed_at AS confirmedAt,operator_name AS operatorName
      FROM machine_turn_handoffs WHERE machine_id=? ORDER BY confirmed_at DESC LIMIT 1`).bind(machineId).first()
  ]);
  return json({ ok:true,activeOrder:order,segments:turnSegments,handoff:handoff || null,turnClock:turnClock(turnSegments) });
}

async function handoffRoute(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !validShiftPayload(body)) return json({ error:'Dados do turno inválidos.',code:'INVALID_BODY' },400);
  const machineId = text(body.machineId); const lineId = text(body.lineId);
  const access = await requireAuth(request,env,machineId,lineId); if (access.response) return access.response;
  const productionConfirmed = number(body.productionConfirmed);
  const currentBarPieces = integer(body.currentBarPieces);
  const feederBars = integer(body.feederBars);
  if (productionConfirmed === null || productionConfirmed < 0) return json({ error:'Confirme a quantidade produzida.',code:'PRODUCTION_REQUIRED' },400);
  if (currentBarPieces === null) return json({ error:'Informe quantas peças a barra atual ainda fará.',code:'CURRENT_BAR_REQUIRED' },400);
  if (feederBars === null) return json({ error:'Informe quantas barras inteiras estão no alimentador.',code:'FEEDER_BARS_REQUIRED' },400);

  const previous = await activeOrder(env,machineId);
  const order = previous || {
    machineId,lineId,lineName:text(body.lineName),machineName:text(body.machineName),
    op:text(body.op),item:text(body.item),description:text(body.description),opTarget:number(body.opTarget),
    cycleSeconds:number(body.cycleSeconds),frequency1:number(body.frequency1),frequency2:number(body.frequency2),
    pieceLengthMm:number(body.pieceLengthMm),producedSoFar:productionConfirmed,
    currentBarPieces,feederBars,barLengthMm:number(body.barLengthMm) || DEFAULT_BAR_LENGTH_MM,
    kerfMm:number(body.kerfMm) ?? DEFAULT_KERF_MM,status:'active',openedAt:nowIso()
  };
  if (!order.op || !order.item || !(order.opTarget > 0) || !(order.cycleSeconds > 0) || !(order.pieceLengthMm > 0)) {
    return json({ error:'Cadastre OP, item, meta, ciclo e comprimento da peça antes de iniciar.',code:'ORDER_DATA_REQUIRED' },400);
  }

  const now = nowIso();
  const handoffId = uid('handoff');
  const { start:scheduledStart } = shiftBounds(text(body.productionDate),text(body.shift));
  const initialStart = continuousPeriodStart(scheduledStart,now) || scheduledStart;
  const [existingOpen,latestClosed] = await Promise.all([
    env.DB.prepare(`SELECT id,op_number AS op FROM machine_turn_segments
      WHERE machine_id=? AND production_date=? AND shift=? AND status='open' AND segment_type='order'
      ORDER BY started_at DESC LIMIT 1`).bind(machineId,text(body.productionDate),text(body.shift)).first(),
    env.DB.prepare(`SELECT ended_at AS endedAt FROM machine_turn_segments
      WHERE machine_id=? AND production_date=? AND shift=? AND status='closed' AND segment_type='order'
      ORDER BY ended_at DESC LIMIT 1`).bind(machineId,text(body.productionDate),text(body.shift)).first()
  ]);
  const start = latestClosed?.endedAt ? now : initialStart;
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
    )
  ];
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
  await writeEvent(env,request,access.auth,body,'turn.handoff_confirmed',{ productionConfirmed,currentBarPieces,feederBars,segmentId });
  const saved = await activeOrder(env,machineId);
  const turnSegments = await segments(env,machineId,text(body.productionDate),text(body.shift));
  return json({ ok:true,activeOrder:saved,segmentId,handoff:{ id:handoffId,confirmedAt:now },segments:turnSegments,turnClock:turnClock(turnSegments) },201);
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
  const machineId=text(body.machineId); const lineId=text(body.lineId);
  const access=await requireAuth(request,env,machineId,lineId); if(access.response)return access.response;
  const goodPieces=integer(body.goodPieces); const rejects=integer(body.rejects);
  if(goodPieces===null)return json({ error:'Informe as peças boas produzidas.',code:'GOOD_PIECES_REQUIRED' },400);
  if(rejects===null)return json({ error:'Informe a quantidade de refugos.',code:'REJECTS_REQUIRED' },400);
  const order=await activeOrder(env,machineId);
  if(!order)return json({ error:'Nenhuma OP ativa foi encontrada para esta máquina.',code:'ACTIVE_ORDER_NOT_FOUND' },409);
  const segment=await env.DB.prepare(`SELECT id,started_at AS startedAt,cycle_time_seconds AS cycleSeconds
    FROM machine_turn_segments WHERE machine_id=? AND production_date=? AND shift=? AND status='open' AND segment_type='order'
    ORDER BY started_at DESC LIMIT 1`).bind(machineId,text(body.productionDate),text(body.shift)).first();
  if(!segment)return json({ error:'Confirme os dados da máquina antes de apontar.',code:'OPEN_SEGMENT_NOT_FOUND' },409);
  const mode=text(body.mode)==='order'?'order':'shift';
  const bounds=shiftBounds(text(body.productionDate),text(body.shift));
  const now=nowIso();
  const endedAt=mode==='shift'?bounds.end:now;
  const effectiveStartedAt=continuousPeriodStart(segment.startedAt,endedAt) || segment.startedAt;
  const availableMinutes=continuousDurationMinutes(segment.startedAt,endedAt);
  const result=performance({ availableMinutes,goodPieces,rejects,cycleSeconds:Number(segment.cycleSeconds || order.cycleSeconds) });
  const newTotal=Number(order.producedSoFar || 0)+goodPieces;
  const status=mode==='order'?'closed':'active';
  const eventId=uid('turn-event');
  const payload={ mode,goodPieces,rejects,availableMinutes,...result,downtimeReason:text(body.downtimeReason),downtimeNote:text(body.downtimeNote) };
  await env.DB.batch([
    env.DB.prepare(`UPDATE machine_turn_segments SET
      started_at=?,ended_at=?,good_pieces=?,rejects=?,total_cycles=?,available_minutes=?,running_minutes=?,downtime_minutes=?,
      reject_minutes=?,downtime_reason=?,downtime_note=?,status='closed',updated_at=? WHERE id=?`).bind(
        effectiveStartedAt,endedAt,goodPieces,rejects,result.totalCycles,availableMinutes,result.runningMinutes,result.downtimeMinutes,
        result.rejectMinutes,text(body.downtimeReason),text(body.downtimeNote),now,segment.id
      ),
    env.DB.prepare(`UPDATE machine_active_orders SET produced_total=?,status=?,closed_at=?,updated_at=?,updated_by_registration=?,updated_by_name=? WHERE machine_id=?`).bind(
      newTotal,status,mode==='order'?endedAt:null,now,access.auth.user.registration,access.auth.user.name,machineId
    ),
    env.DB.prepare(`INSERT INTO turn_assistant_events (
      id,production_date,shift,machine_id,op_number,event_type,operator_registration,operator_name,payload,ip_address,user_agent,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      eventId,text(body.productionDate),text(body.shift),machineId,order.op,mode==='order'?'order.closed':'shift.pointed',
      access.auth.user.registration,access.auth.user.name,JSON.stringify(payload),ip(request),agent(request),now
    )
  ]);
  const turnSegments=await segments(env,machineId,text(body.productionDate),text(body.shift));
  return json({ ok:true,mode,activeOrder:mode==='order'?null:{ ...order,producedSoFar:newTotal,updatedAt:now },
    closedOrder:mode==='order'?{ ...order,producedSoFar:newTotal,status:'closed',closedAt:endedAt }:null,
    performance:{ ...result,availableMinutes },segments:turnSegments,turnClock:turnClock(turnSegments),endedAt });
}

async function startOrderRoute(request, env) {
  const body=await request.json().catch(()=>null);
  if(!body||!validShiftPayload(body))return json({ error:'Dados da nova OP inválidos.',code:'INVALID_BODY' },400);
  const machineId=text(body.machineId);const lineId=text(body.lineId);
  const access=await requireAuth(request,env,machineId,lineId);if(access.response)return access.response;
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
  const statements=[];
  if(openOther){
    const idleMinutes=durationMinutes(openOther.startedAt,now);
    statements.push(env.DB.prepare(`UPDATE machine_turn_segments SET ended_at=?,available_minutes=?,downtime_minutes=?,downtime_reason=?,status='closed',updated_at=? WHERE id=?`)
      .bind(now,idleMinutes,idleMinutes,text(body.transitionReason)||'Troca de ordem',now,openOther.id));
  } else {
    const latest=await env.DB.prepare(`SELECT ended_at AS endedAt FROM machine_turn_segments
      WHERE machine_id=? AND production_date=? AND shift=? AND status='closed' ORDER BY ended_at DESC LIMIT 1`)
      .bind(machineId,text(body.productionDate),text(body.shift)).first();
    if(latest?.endedAt && durationMinutes(latest.endedAt,now)>0.5){
      const gap=durationMinutes(latest.endedAt,now);
      statements.push(env.DB.prepare(`INSERT INTO machine_turn_segments (
        id,production_date,shift,machine_id,line_id,segment_type,operator_registration,operator_name,
        started_at,ended_at,available_minutes,downtime_minutes,downtime_reason,status,created_at,updated_at
      ) VALUES (?,?,?,?,?,'transition',?,?,?,?,?,?,?,'closed',?,?)`).bind(
        uid('segment'),text(body.productionDate),text(body.shift),machineId,lineId,access.auth.user.registration,access.auth.user.name,
        latest.endedAt,now,gap,gap,text(body.transitionReason)||'Troca de ordem',now,now
      ));
    }
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
    )
  );
  await env.DB.batch(statements);
  await writeEvent(env,request,access.auth,{ ...body,op },'order.started',{ orderType:sameItem?'same-item':'different-item',segmentId });
  const order=await activeOrder(env,machineId);
  const turnSegments=await segments(env,machineId,text(body.productionDate),text(body.shift));
  return json({ ok:true,activeOrder:order,segmentId,segments:turnSegments,turnClock:turnClock(turnSegments) },201);
}

async function stoppedRoute(request, env) {
  const body=await request.json().catch(()=>null);
  if(!body||!validShiftPayload(body))return json({ error:'Dados inválidos.',code:'INVALID_BODY' },400);
  const machineId=text(body.machineId);const lineId=text(body.lineId);
  const access=await requireAuth(request,env,machineId,lineId);if(access.response)return access.response;
  const now=nowIso();
  const segmentId=uid('segment');
  await env.DB.batch([
    env.DB.prepare(`UPDATE machine_active_orders SET status='stopped',updated_at=?,updated_by_registration=?,updated_by_name=? WHERE machine_id=?`)
      .bind(now,access.auth.user.registration,access.auth.user.name,machineId),
    env.DB.prepare(`INSERT INTO machine_turn_segments (
      id,production_date,shift,machine_id,line_id,segment_type,operator_registration,operator_name,
      started_at,downtime_reason,downtime_note,status,created_at,updated_at
    ) VALUES (?,?,?,?,?,'idle',?,?,?,?,?,'open',?,?)`).bind(
      segmentId,text(body.productionDate),text(body.shift),machineId,lineId,access.auth.user.registration,access.auth.user.name,
      now,text(body.reason)||'Sem programação',text(body.note),now,now
    )
  ]);
  await writeEvent(env,request,access.auth,body,'machine.stopped',{ reason:text(body.reason)||'Sem programação',segmentId });
  return json({ ok:true,segmentId,status:'stopped' });
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
  return json({ error:'Rota do assistente de turno não encontrada.',code:'NOT_FOUND' },404);
}

export async function turnAssistantHealth(env) {
  await ensureTables(env);
  const tables=['machine_active_orders','machine_turn_handoffs','machine_turn_segments','turn_assistant_events'];
  const found=[];
  for(const table of tables){
    const row=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
    if(row?.name)found.push(row.name);
  }
  const sample=performance({ availableMinutes:480,goodPieces:80,rejects:4,cycleSeconds:300 });
  const rolloverMinutes=continuousDurationMinutes('2026-08-05T17:30:00.000Z','2026-08-05T16:25:00.000Z');
  return {
    ok:found.length===tables.length&&Math.round(sample.downtimeMinutes)===60&&rolloverMinutes===1375,
    schemaReady:found.length===tables.length,
    tables:found,
    periodCalculationReady:Math.round(sample.runningMinutes)===420&&Math.round(sample.downtimeMinutes)===60&&rolloverMinutes===1375,
    rolloverMinutes,
    pointingValidation:'advisory-only',
    shiftMinutes:DEFAULT_SHIFT_MINUTES,
    transaction:'d1-batch'
  };
}
