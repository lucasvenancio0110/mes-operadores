export const DEFAULT_SHIFT_MINUTES = 480;
export const DEFAULT_BAR_LENGTH_MM = 3600;
export const DEFAULT_KERF_MM = 1;

const finite = value => Number.isFinite(Number(value));
const nonNegative = value => finite(value) ? Math.max(0, Number(value)) : NaN;
const positive = value => finite(value) && Number(value) > 0 ? Number(value) : NaN;
const integer = value => finite(value) ? Math.max(0, Math.floor(Number(value))) : NaN;

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

export function remainingShiftMinutes({ shift, productionDate = '', now = new Date() }) {
  const { end } = shiftWindow(shift,productionDate,now);
  return Math.max(0, Math.min(DEFAULT_SHIFT_MINUTES, minutesBetween(now,end)));
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
