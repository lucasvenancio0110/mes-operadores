import assert from 'node:assert/strict';
import {
  FULL_SHIFT_MINUTES,
  FULL_SHIFT_SECONDS,
  cyclePartsToSeconds,
  cycleSecondsToDecimalMinutes,
  calculateFullShiftTarget,
  calculateFullShiftTime
} from '../app/shift-time-engine.js';

assert.equal(FULL_SHIFT_MINUTES, 480, 'O turno deve possuir 480 minutos.');
assert.equal(FULL_SHIFT_SECONDS, 28800, 'O turno deve possuir 28.800 segundos.');

const cycle447 = cyclePartsToSeconds(4, 47);
assert.equal(cycle447, 287, '4:47 deve ser convertido para 287 segundos.');
assert.ok(Math.abs(cycleSecondsToDecimalMinutes(cycle447) - 4.783333333333333) < 1e-10, '4:47 deve equivaler a 4,7833 minutos, nunca 4,47.');

const target447 = calculateFullShiftTarget(cycle447);
assert.ok(Math.abs(target447 - 100.34843205574913) < 1e-10, 'A meta de 4:47 deve usar os 480 minutos completos.');

const performance = calculateFullShiftTime({ cycleSeconds:cycle447, producedPieces:100 });
assert.equal(performance.availableSeconds, 28800);
assert.equal(performance.productiveSeconds, 28700);
assert.equal(performance.stoppageSeconds, 100, '100 peças em ciclo 4:47 devem resultar em 1min40s de parada calculada.');

const above = calculateFullShiftTime({ cycleSeconds:cycle447, producedPieces:110 });
assert.equal(above.stoppageSeconds, 0, 'O tempo de parada nunca pode ficar negativo.');

console.log('Shift duration and cycle fraction checks passed.');
