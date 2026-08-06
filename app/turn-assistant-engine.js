export const DEFAULT_SHIFT_MINUTES = 480;
export const DEFAULT_BAR_LENGTH_MM = 3600;
export const DEFAULT_KERF_MM = 1;
export const FACTORY_TIME_ZONE = 'America/Sao_Paulo';
export const MACHINE_PHYSICAL_STATUSES = Object.freeze(['producing','stopped','setup','maintenance']);
export const ORDER_STATUSES = Object.freeze(['none','active','closed']);
export const OPERATOR_WORKFLOW_STATUSES = Object.freeze(['conference_pending','ready','shift_closed']);

const finite = value => Number.isFinite(Number(value));
const nonNegative = value => finite(value) ? Math.max(0, Number(value)) : NaN;
const positive = value => finite(value) && Number(value) > 0 ? Number(value) : NaN;
const integer = value => finite(value) ? Math.max(0, Math.floor(Number(value))) : NaN;

function dateKeyWithOffset(dateKey, days = 0) {
  const [year,month,day] = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(year,month - 1,day + days));
  return date.toISOString().slice(0,10);
}

function zonedDateParts(reference = new Date(), timeZone = FACTORY_TIME_ZONE) {
  const date = reference instanceof Date ? reference : new Date(reference);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type,part.value]));
  return {
    dateKey:`${parts.year}-${parts.month}-${parts.day}`,
    hour:Number(parts.hour),
    minute:Number(parts.minute)
  };
}

export function detectOperationalContext(reference = new Date(), timeZone = FACTORY_TIME_ZONE) {
  const parts = zonedDateParts(reference,timeZone);
  if (!parts) return { shift:'1',productionDate:'',shiftMinutes:DEFAULT_SHIFT_MINUTES,timeZone };
  const minuteOfDay = parts.hour * 60 + parts.minute;
  if (minuteOfDay >= 390 && minuteOfDay < 870) {
    return { shift:'1',productionDate:parts.dateKey,shiftMinutes:DEFAULT_SHIFT_MINUTES,timeZone };
  }
  if (minuteOfDay >= 870 && minuteOfDay < 1350) {
    return { shift:'2',productionDate:parts.dateKey,shiftMinutes:DEFAULT_SHIFT_MINUTES,timeZone };
  }
  return {
    shift:'3',
    productionDate:minuteOfDay < 390 ? dateKeyWithOffset(parts.dateKey,-1) : parts.dateKey,
    shiftMinutes:DEFAULT_SHIFT_MINUTES,
    timeZone
  };
}

export function createTurnClock(input = {}) {
  const totalMinutes = positive(input.totalMinutes) || DEFAULT_SHIFT_MINUTES;
  const usedMinutes = Number.isFinite(nonNegative(input.usedMinutes)) ? nonNegative(input.usedMinutes) : 0;
  return {
    totalMinutes,
    usedMinutes,
    remainingMinutes:Math.max(0,totalMinutes - usedMinutes),
    overrunMinutes:Math.max(0,usedMinutes - totalMinutes)
  };
}

export function calculatePointingAccounting(input = {}) {
  const goodPieces = integer(input.goodPieces);
  const rejects = integer(input.rejects);
  const cycleSeconds = positive(input.cycleSeconds);
  const stopMinutes = Number.isFinite(nonNegative(input.stopMinutes)) ? nonNegative(input.stopMinutes) : 0;
  const clock = createTurnClock({ totalMinutes:input.totalMinutes,usedMinutes:input.usedMinutes });
  const missing = [];
  if (!Number.isFinite(goodPieces)) missing.push('peças boas');
  if (!Number.isFinite(rejects)) missing.push('refugos');
  if (!Number.isFinite(cycleSeconds)) missing.push('tempo de ciclo');
  if (missing.length) return { accepted:false,status:'missing',missing,...clock };

  const totalCycles = goodPieces + rejects;
  const productiveMinutes = totalCycles * cycleSeconds / 60;
  const accountedMinutes = productiveMinutes + stopMinutes;
  const usedAfter = clock.usedMinutes + accountedMinutes;
  const remainingAfter = Math.max(0,clock.totalMinutes - usedAfter);
  const overrunMinutes = Math.max(0,usedAfter - clock.totalMinutes);
  return {
    accepted:true,
    advisory:overrunMinutes > 0,
    status:overrunMinutes > 0 ? 'advisory' : 'ready',
    missing:[],goodPieces,rejects,totalCycles,cycleSeconds,productiveMinutes,stopMinutes,accountedMinutes,
    totalMinutes:clock.totalMinutes,usedBefore:clock.usedMinutes,usedAfter,remainingBefore:clock.remainingMinutes,
    remainingAfter,overrunMinutes,rejectMinutes:rejects * cycleSeconds / 60
  };
}

export function nextFlowAxes(input = {}) {
  const closeOrder = Boolean(input.closeOrder);
  const finalShift = Boolean(input.finalShift);
  return {
    physicalStatus:MACHINE_PHYSICAL_STATUSES.includes(input.physicalStatus) ? input.physicalStatus : 'producing',
    opStatus:closeOrder ? 'closed' : 'active',
    workflowStatus:finalShift ? 'shift_closed' : 'conference_pending'
  };
}

export function operatorCardState(input = {}) {
  const physicalStatus = MACHINE_PHYSICAL_STATUSES.includes(input.physicalStatus) ? input.physicalStatus : 'producing';
  const opStatus = ORDER_STATUSES.includes(input.opStatus) ? input.opStatus : 'none';
  const workflowStatus = OPERATOR_WORKFLOW_STATUSES.includes(input.workflowStatus) ? input.workflowStatus : 'conference_pending';
  if (physicalStatus === 'stopped' && opStatus !== 'active') return 'stopped';
  if (opStatus !== 'active') return 'no-order';
  if (workflowStatus === 'shift_closed') return 'shift-closed';
  if (workflowStatus === 'conference_pending') return 'conference-pending';
  return 'ready';
}

export function shiftWindow(shift, productionDate = '', reference = new Date()) {
  const base = productionDate
    ? new Date(`${productionDate}T12:00:00`)
    : new Date(reference);
  const start = new Date(base);
  const end = new Date(base);
  const value = String(shift || '1');
  if (value === '1') {
    start.setHours(6,30,0,0);
    end.setHours(14,30,0,0);
  } else if (value === '2') {
    start.setHours(14,30,0,0);
    end.setHours(22,30,0,0);
  } else {
    start.setHours(22,30,0,0);
    end.setDate(end.getDate() + 1);
    end.setHours(6,30,0,0);
  }
  return { start, end };
}

export function minutesBetween(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return NaN;
  return Math.max(0, (to.getTime() - from.getTime()) / 60000);
}

export function continuousMinutesBetween(start, end) {
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return NaN;
  if (to.getTime() < from.getTime()) from.setUTCDate(from.getUTCDate() - 1);
  return Math.max(0, (to.getTime() - from.getTime()) / 60000);
}

export function remainingShiftMinutes({ shift, productionDate = '', now = new Date() }) {
  const { end } = shiftWindow(shift,productionDate,now);
  return Math.max(0, Math.min(DEFAULT_SHIFT_MINUTES, minutesBetween(now,end)));
}

export function calculateFullShiftTarget(cycleSeconds, shiftMinutes = DEFAULT_SHIFT_MINUTES) {
  const cycle = positive(cycleSeconds);
  const duration = positive(shiftMinutes);
  if (!Number.isFinite(cycle) || !Number.isFinite(duration)) return 0;
  return Math.max(0,Math.floor(duration * 60 / cycle));
}

export function listMeasurementReleases(plans = {}) {
  const sources = [
    { key:'frequency1',label:'Frequência I',order:1,points:plans.frequency1?.points },
    { key:'frequency2',label:'Frequência II',order:2,points:plans.frequency2?.points }
  ];
  const releases = [];
  for (const source of sources) {
    for (const point of Array.isArray(source.points) ? source.points : []) {
      const shiftPiece = integer(point?.shiftPiece);
      if (!(shiftPiece > 0)) continue;
      releases.push({
        ...point,
        shiftPiece,
        frequencyKey:source.key,
        frequencyLabel:source.label,
        frequencyOrder:source.order
      });
    }
  }
  return releases.sort((left,right) =>
    left.shiftPiece - right.shiftPiece
    || left.frequencyOrder - right.frequencyOrder
    || Number(left.measurementNumber || 0) - Number(right.measurementNumber || 0)
  );
}

export function calculateMaterial(input = {}) {
  const barLengthMm = positive(input.barLengthMm) || DEFAULT_BAR_LENGTH_MM;
  const kerfMm = nonNegative(input.kerfMm);
  const effectiveKerfMm = Number.isFinite(kerfMm) ? kerfMm : DEFAULT_KERF_MM;
  const pieceLengthMm = positive(input.pieceLengthMm);
  const currentBarPieces = integer(input.currentBarPieces);
  const feederBars = integer(input.feederBars);
  const piecesPerFullBar = Number.isFinite(pieceLengthMm)
    ? Math.max(0,Math.floor(barLengthMm / (pieceLengthMm + effectiveKerfMm)))
    : NaN;
  const availablePieces = Number.isFinite(piecesPerFullBar)
    && Number.isFinite(currentBarPieces)
    && Number.isFinite(feederBars)
    ? currentBarPieces + feederBars * piecesPerFullBar
    : NaN;
  return {
    barLengthMm,
    kerfMm:effectiveKerfMm,
    pieceLengthMm,
    currentBarPieces,
    feederBars,
    piecesPerFullBar,
    availablePieces
  };
}

export function calculateOrderForecast(input = {}) {
  const cycleSeconds = positive(input.cycleSeconds);
  const opTarget = positive(input.opTarget);
  const producedSoFar = nonNegative(input.producedSoFar);
  const now = input.now ? new Date(input.now) : new Date();
  const material = calculateMaterial(input);
  const opRemaining = Number.isFinite(opTarget) && Number.isFinite(producedSoFar)
    ? Math.max(0,Math.ceil(opTarget - producedSoFar))
    : NaN;

  const missing = [];
  if (!Number.isFinite(cycleSeconds)) missing.push('tempo de ciclo');
  if (!Number.isFinite(opTarget)) missing.push('meta da OP');
  if (!Number.isFinite(producedSoFar)) missing.push('produção atual');
  if (!Number.isFinite(material.pieceLengthMm)) missing.push('comprimento da peça');
  if (!Number.isFinite(material.currentBarPieces)) missing.push('peças restantes na barra atual');
  if (!Number.isFinite(material.feederBars)) missing.push('barras no alimentador');

  if (missing.length) {
    return {
      status:'missing', reason:'missing', missing,
      cycleSeconds, opTarget, producedSoFar, opRemaining,
      ...material, estimatedAt:null, opEstimatedAt:null, materialEstimatedAt:null, stopPieces:NaN,
      missingPieces:NaN, additionalBars:NaN, leftoverMaterialPieces:NaN
    };
  }

  if (opRemaining <= 0) {
    const materialEstimatedAt = new Date(now.getTime() + material.availablePieces * cycleSeconds * 1000).toISOString();
    return {
      status:'complete', reason:'op', missing:[],
      cycleSeconds, opTarget, producedSoFar, opRemaining:0,
      ...material, stopPieces:0, estimatedAt:now.toISOString(), opEstimatedAt:now.toISOString(), materialEstimatedAt,
      missingPieces:0, additionalBars:0,
      leftoverMaterialPieces:material.availablePieces
    };
  }

  const stopPieces = Math.min(opRemaining,material.availablePieces);
  const reason = material.availablePieces < opRemaining ? 'material' : 'op';
  const opEstimatedAt = new Date(now.getTime() + opRemaining * cycleSeconds * 1000).toISOString();
  const materialEstimatedAt = new Date(now.getTime() + material.availablePieces * cycleSeconds * 1000).toISOString();
  const estimatedAt = reason === 'material' ? materialEstimatedAt : opEstimatedAt;
  const missingPieces = reason === 'material' ? Math.max(0,opRemaining - material.availablePieces) : 0;
  const additionalBars = reason === 'material' && material.piecesPerFullBar > 0
    ? Math.ceil(missingPieces / material.piecesPerFullBar)
    : 0;
  const leftoverMaterialPieces = reason === 'op'
    ? Math.max(0,material.availablePieces - opRemaining)
    : 0;

  return {
    status:'ready', reason, missing:[],
    cycleSeconds, opTarget, producedSoFar, opRemaining,
    ...material, stopPieces, estimatedAt, opEstimatedAt, materialEstimatedAt,
    missingPieces, additionalBars, leftoverMaterialPieces
  };
}

export function calculatePeriodPerformance(input = {}) {
  const availableMinutes = nonNegative(input.availableMinutes);
  const goodPieces = integer(input.goodPieces);
  const rejects = integer(input.rejects);
  const cycleSeconds = positive(input.cycleSeconds);
  const missing = [];
  if (!Number.isFinite(availableMinutes)) missing.push('tempo disponível');
  if (!Number.isFinite(goodPieces)) missing.push('peças boas');
  if (!Number.isFinite(rejects)) missing.push('refugos');
  if (!Number.isFinite(cycleSeconds)) missing.push('tempo de ciclo');
  if (missing.length) return { status:'missing', missing };

  const totalCycles = goodPieces + rejects;
  const runningMinutes = totalCycles * cycleSeconds / 60;
  const rawDowntimeMinutes = availableMinutes - runningMinutes;
  const inconsistent = rawDowntimeMinutes < -0.01;
  const downtimeMinutes = Math.max(0,rawDowntimeMinutes);
  const rejectMinutes = rejects * cycleSeconds / 60;
  return {
    status:inconsistent ? 'inconsistent' : 'ready',
    missing:[], availableMinutes, goodPieces, rejects, totalCycles,
    cycleSeconds, runningMinutes, downtimeMinutes, rejectMinutes,
    overrunMinutes:inconsistent ? Math.abs(rawDowntimeMinutes) : 0,
    inconsistent
  };
}

export function calculateTurnClock(segments = [], totalMinutes = DEFAULT_SHIFT_MINUTES) {
  const normalized = (Array.isArray(segments) ? segments : []).map(segment => ({
    ...segment,
    durationMinutes:nonNegative(segment.durationMinutes)
  }));
  const usedMinutes = normalized.reduce((sum,segment) => sum + (Number.isFinite(segment.durationMinutes) ? segment.durationMinutes : 0),0);
  return {
    totalMinutes,
    usedMinutes,
    remainingMinutes:Math.max(0,totalMinutes - usedMinutes),
    overrunMinutes:Math.max(0,usedMinutes - totalMinutes),
    consistent:usedMinutes <= totalMinutes + 0.01
  };
}

export function formatDuration(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.max(0,Math.round(value));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours}h`;
  return `${hours}h${String(mins).padStart(2,'0')}`;
}

export function predictionMessage(forecast) {
  if (!forecast || forecast.status === 'missing') {
    const first = forecast?.missing?.[0] || 'os dados obrigatórios';
    return `Informe ${first} para calcular a previsão.`;
  }
  if (forecast.status === 'complete') return 'A meta da OP já foi atingida.';
  if (forecast.reason === 'material') {
    return 'Vai fechar neste horário por falta de matéria-prima.';
  }
  return 'Vai fechar por atingir a meta da OP.';
}
