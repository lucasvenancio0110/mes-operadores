const EPSILON = 1e-9;
const QUOTIENT_SNAP_TOLERANCE = 1e-3;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

function wholeNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function measurementCountAt(pieceCount, frequency, maximum = Infinity) {
  if (!(frequency > 0)) return 0;
  const quotient = Math.max(0, Number(pieceCount) || 0) / frequency;
  const nearestInteger = Math.round(quotient);
  const normalizedQuotient = Math.abs(quotient - nearestInteger) <= QUOTIENT_SNAP_TOLERANCE
    ? nearestInteger
    : quotient;
  return Math.min(maximum, Math.max(0, Math.floor(normalizedQuotient + EPSILON)));
}

/**
 * Calcula uma frequência de medição considerando toda a OP e converte os
 * próximos pontos acumulados em quantidades produzidas no turno atual.
 */
export function calculateFrequencyMeasurementPlan(input = {}) {
  const opTarget = wholeNonNegative(input.opTarget);
  const producedSoFar = Math.min(wholeNonNegative(input.producedSoFar), opTarget);
  const shiftTarget = wholeNonNegative(input.shiftTarget);
  const frequency = positive(input.frequency);
  const expectedEnd = Math.min(opTarget, producedSoFar + shiftTarget);

  if (!(opTarget > 0) || !(frequency > 0)) {
    return {
      frequency,
      opTarget,
      producedSoFar,
      shiftTarget,
      expectedEnd,
      totalMeasurements: 0,
      previousMeasurements: 0,
      measurementsThisShift: 0,
      measurementsByShiftEnd: 0,
      remainingAfterShift: 0,
      points: []
    };
  }

  // Frequências podem chegar arredondadas a três casas decimais.
  // Quando o quociente está praticamente inteiro, ele é normalizado para
  // evitar que 12,99995 seja interpretado como somente 12 medições.
  const totalMeasurements = measurementCountAt(opTarget, frequency);
  const previousMeasurements = measurementCountAt(producedSoFar, frequency, totalMeasurements);
  const measurementsByShiftEnd = measurementCountAt(expectedEnd, frequency, totalMeasurements);

  const points = [];
  for (let measurementNumber = previousMeasurements + 1; measurementNumber <= measurementsByShiftEnd; measurementNumber += 1) {
    const exactAccumulatedPoint = measurementNumber * frequency;
    const accumulatedPiece = Math.min(opTarget, Math.ceil(exactAccumulatedPoint - EPSILON));
    const shiftPiece = Math.max(1, accumulatedPiece - producedSoFar);
    points.push({
      measurementNumber,
      totalMeasurements,
      shiftSequence: points.length + 1,
      exactAccumulatedPoint,
      accumulatedPiece,
      shiftPiece
    });
  }

  const measurementsThisShift = points.length;
  // Regra invariável da tela:
  // anteriores + neste turno + depois do turno = total da OP.
  const remainingAfterShift = Math.max(
    totalMeasurements - previousMeasurements - measurementsThisShift,
    0
  );

  return {
    frequency,
    opTarget,
    producedSoFar,
    shiftTarget,
    expectedEnd,
    totalMeasurements,
    previousMeasurements,
    measurementsThisShift,
    measurementsByShiftEnd: previousMeasurements + measurementsThisShift,
    remainingAfterShift,
    points
  };
}

export function calculateMeasurementPlans(input = {}) {
  const common = {
    opTarget: input.opTarget,
    producedSoFar: input.producedSoFar,
    shiftTarget: input.shiftTarget
  };
  return {
    frequency1: calculateFrequencyMeasurementPlan({ ...common, frequency: input.frequency1 }),
    frequency2: calculateFrequencyMeasurementPlan({ ...common, frequency: input.frequency2 })
  };
}
