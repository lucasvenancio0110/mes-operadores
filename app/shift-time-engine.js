export const FULL_SHIFT_MINUTES = 480;
export const FULL_SHIFT_SECONDS = FULL_SHIFT_MINUTES * 60;

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

export function cyclePartsToSeconds(minutes, seconds = 0) {
  const minuteValue = Number(minutes);
  const secondValue = Number(seconds);
  if (!Number.isFinite(minuteValue) || !Number.isFinite(secondValue) || minuteValue < 0 || secondValue < 0 || secondValue >= 60) return NaN;
  return minuteValue * 60 + secondValue;
}

export function cycleSecondsToDecimalMinutes(cycleSeconds) {
  const cycle = positiveNumber(cycleSeconds);
  return Number.isFinite(cycle) ? cycle / 60 : NaN;
}

export function calculateFullShiftTarget(cycleSeconds, shiftMinutes = FULL_SHIFT_MINUTES) {
  const cycle = positiveNumber(cycleSeconds);
  const duration = positiveNumber(shiftMinutes);
  if (!Number.isFinite(cycle) || !Number.isFinite(duration)) return NaN;
  return duration * 60 / cycle;
}

export function calculateFullShiftTime({ cycleSeconds, producedPieces, shiftMinutes = FULL_SHIFT_MINUTES } = {}) {
  const cycle = positiveNumber(cycleSeconds);
  const pieces = Number(producedPieces);
  const duration = positiveNumber(shiftMinutes);
  if (!Number.isFinite(cycle) || !Number.isFinite(pieces) || pieces < 0 || !Number.isFinite(duration)) {
    return { valid:false, productiveSeconds:NaN, stoppageSeconds:NaN, target:NaN };
  }
  const availableSeconds = duration * 60;
  const productiveSeconds = pieces * cycle;
  return {
    valid:true,
    availableSeconds,
    productiveSeconds,
    stoppageSeconds:Math.max(0, availableSeconds - productiveSeconds),
    target:availableSeconds / cycle
  };
}
