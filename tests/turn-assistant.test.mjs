import assert from 'node:assert/strict';
import {
  calculateMaterial,calculateOrderForecast,calculatePeriodPerformance,
  calculateTurnClock,predictionMessage,shiftWindow,minutesBetween
} from '../app/turn-assistant-engine.js';

const material=calculateMaterial({ pieceLengthMm:11,currentBarPieces:276,feederBars:1,barLengthMm:3600,kerfMm:1 });
assert.equal(material.piecesPerFullBar,300);
assert.equal(material.availablePieces,576);

const finishesByOp=calculateOrderForecast({
  now:'2026-08-05T14:42:00-03:00',cycleSeconds:287,opTarget:1000,producedSoFar:472,
  pieceLengthMm:11,currentBarPieces:276,feederBars:1,barLengthMm:3600,kerfMm:1
});
assert.equal(finishesByOp.reason,'op');
assert.equal(finishesByOp.opRemaining,528);
assert.equal(finishesByOp.leftoverMaterialPieces,48);
assert.equal(predictionMessage(finishesByOp),'A meta da OP deverá ser atingida antes de acabar a matéria-prima.');

const stopsByMaterial=calculateOrderForecast({
  now:'2026-08-05T14:42:00-03:00',cycleSeconds:60,opTarget:1000,producedSoFar:472,
  pieceLengthMm:11,currentBarPieces:100,feederBars:1,barLengthMm:3600,kerfMm:1
});
assert.equal(stopsByMaterial.reason,'material');
assert.equal(stopsByMaterial.availablePieces,400);
assert.equal(stopsByMaterial.missingPieces,128);
assert.equal(stopsByMaterial.additionalBars,1);
assert.equal(predictionMessage(stopsByMaterial),'A matéria-prima informada deverá acabar antes de atingir a meta da OP.');

const period=calculatePeriodPerformance({ availableMinutes:480,goodPieces:80,rejects:4,cycleSeconds:300 });
assert.equal(period.totalCycles,84);
assert.equal(period.runningMinutes,420);
assert.equal(period.downtimeMinutes,60);
assert.equal(period.rejectMinutes,20);
assert.equal(period.inconsistent,false);

const first=calculatePeriodPerformance({ availableMinutes:180,goodPieces:70,rejects:5,cycleSeconds:120 });
const second=calculatePeriodPerformance({ availableMinutes:300,goodPieces:85,rejects:5,cycleSeconds:180 });
assert.equal(first.runningMinutes,150);
assert.equal(first.downtimeMinutes,30);
assert.equal(second.runningMinutes,270);
assert.equal(second.downtimeMinutes,30);
const clock=calculateTurnClock([{ durationMinutes:180 },{ durationMinutes:300 }]);
assert.equal(clock.usedMinutes,480);
assert.equal(clock.remainingMinutes,0);
assert.equal(clock.consistent,true);

const inconsistent=calculatePeriodPerformance({ availableMinutes:30,goodPieces:20,rejects:0,cycleSeconds:120 });
assert.equal(inconsistent.inconsistent,true);
assert.equal(inconsistent.downtimeMinutes,0);
assert.equal(inconsistent.overrunMinutes,10);

const bounds=shiftWindow('2','2026-08-05');
assert.equal(minutesBetween(bounds.start,bounds.end),480);

console.log('NEOMES 5.0: matéria-prima, previsão, refugos e relógio único validados.');
