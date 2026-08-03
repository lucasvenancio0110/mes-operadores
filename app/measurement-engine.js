const EPSILON = 1e-9;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

function wholeNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
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

  // Só existe medição quando um múltiplo completo da frequência é atingido.
  const totalMeasurements = Math.max(0, Math.floor((opTarget + EPSILON) / frequency));
  const previousMeasurements = Math.min(
    totalMeasurements,
    Math.max(0, Math.floor((producedSoFar + EPSILON) / frequency))
  );
  const measurementsByShiftEnd = Math.min(
    totalMeasurements,
    Math.max(0, Math.floor((expectedEnd + EPSILON) / frequency))
  );

  const points = [];
  for (let measurementNumber = previousMeasurements + 1; measurementNumber <= measurementsByShiftEnd; measurementNumber += 1) {
    const exactAccumulatedPoint = measurementNumber * frequency;
    const accumulatedPiece = Math.ceil(exactAccumulatedPoint - EPSILON);
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

  return {
    frequency,
    opTarget,
    producedSoFar,
    shiftTarget,
    expectedEnd,
    totalMeasurements,
    previousMeasurements,
    measurementsThisShift: points.length,
    measurementsByShiftEnd,
    remainingAfterShift: Math.max(totalMeasurements - measurementsByShiftEnd, 0),
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
