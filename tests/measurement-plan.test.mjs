import assert from 'node:assert/strict';
import { calculateFrequencyMeasurementPlan, calculateMeasurementPlans } from '../app/measurement-engine.js';

{
  const plan = calculateFrequencyMeasurementPlan({
    opTarget: 1000,
    producedSoFar: 0,
    shiftTarget: 1000,
    frequency: 100
  });
  assert.equal(plan.totalMeasurements, 10);
  assert.equal(plan.measurementsThisShift, 10);
  assert.equal(plan.points.at(-1).measurementNumber, 10);
  assert.equal(plan.points.at(-1).shiftPiece, 1000);
}

{
  const plan = calculateFrequencyMeasurementPlan({
    opTarget: 1000,
    producedSoFar: 470,
    shiftTarget: 250,
    frequency: 100
  });
  assert.equal(plan.totalMeasurements, 10);
  assert.equal(plan.previousMeasurements, 4);
  assert.equal(plan.measurementsThisShift, 3);
  assert.equal(plan.remainingAfterShift, 3);
  assert.deepEqual(plan.points.map(point => point.measurementNumber), [5, 6, 7]);
  assert.deepEqual(plan.points.map(point => point.shiftPiece), [30, 130, 230]);
}

{
  const plan = calculateFrequencyMeasurementPlan({
    opTarget: 1000,
    producedSoFar: 470,
    shiftTarget: 95,
    frequency: 57.45
  });
  assert.equal(plan.totalMeasurements, 17);
  assert.equal(plan.previousMeasurements, 8);
  assert.equal(plan.measurementsThisShift, 1);
  assert.equal(plan.points[0].measurementNumber, 9);
  assert.equal(plan.points[0].shiftPiece, 48);
}

{
  const plans = calculateMeasurementPlans({
    opTarget: 1000,
    producedSoFar: 470,
    shiftTarget: 95,
    frequency1: 57.45,
    frequency2: 14.478
  });
  assert.equal(plans.frequency2.totalMeasurements, 69);
  assert.equal(plans.frequency2.previousMeasurements, 32);
  assert.equal(plans.frequency2.measurementsThisShift, 7);
  assert.deepEqual(plans.frequency2.points.map(point => point.measurementNumber), [33, 34, 35, 36, 37, 38, 39]);
  assert.deepEqual(plans.frequency2.points.map(point => point.shiftPiece), [8, 23, 37, 52, 66, 81, 95]);
}

{
  const plan = calculateFrequencyMeasurementPlan({
    opTarget: 500,
    producedSoFar: 470,
    shiftTarget: 100,
    frequency: 100
  });
  assert.equal(plan.expectedEnd, 500);
  assert.equal(plan.totalMeasurements, 5);
  assert.equal(plan.measurementsThisShift, 1);
  assert.equal(plan.points[0].measurementNumber, 5);
  assert.equal(plan.points[0].shiftPiece, 30);
  assert.equal(plan.remainingAfterShift, 0);
}

console.log('Measurement plan checks passed.');
