import assert from 'node:assert/strict';
import {
  DEFAULT_SHIFT_MINUTES,
  calculateFullShiftTarget,
  calculatePointingAccounting,
  createTurnClock,
  detectOperationalContext,
  nextFlowAxes,
  operatorCardState
} from '../app/turn-assistant-engine.js';

assert.deepEqual(
  detectOperationalContext('2026-08-05T12:00:00.000Z'),
  { shift:'1',productionDate:'2026-08-05',shiftMinutes:480,timeZone:'America/Sao_Paulo' }
);
assert.equal(detectOperationalContext('2026-08-05T18:00:00.000Z').shift,'2');
assert.deepEqual(
  detectOperationalContext('2026-08-06T07:00:00.000Z'),
  { shift:'3',productionDate:'2026-08-05',shiftMinutes:480,timeZone:'America/Sao_Paulo' },
  'A madrugada pertence ao terceiro turno iniciado no dia anterior.'
);
assert.deepEqual(
  detectOperationalContext('2026-08-06T09:30:00.000Z'),
  { shift:'1',productionDate:'2026-08-06',shiftMinutes:480,timeZone:'America/Sao_Paulo' }
);

const initialClock=createTurnClock();
assert.equal(initialClock.remainingMinutes,DEFAULT_SHIFT_MINUTES,'A primeira conferência sempre recebe 480 minutos.');
assert.equal(calculateFullShiftTarget(287,initialClock.remainingMinutes),100);

const firstPointing=calculatePointingAccounting({
  usedMinutes:0,goodPieces:50,rejects:0,cycleSeconds:120,stopMinutes:20
});
assert.equal(firstPointing.accepted,true);
assert.equal(firstPointing.productiveMinutes,100);
assert.equal(firstPointing.accountedMinutes,120);
assert.equal(firstPointing.remainingAfter,360,'A próxima OP deve herdar os 360 minutos não consumidos.');

const secondPointing=calculatePointingAccounting({
  usedMinutes:firstPointing.usedAfter,goodPieces:85,rejects:5,cycleSeconds:180,stopMinutes:30
});
assert.equal(secondPointing.accountedMinutes,300);
assert.equal(secondPointing.usedAfter,420);
assert.equal(secondPointing.remainingAfter,60);

const unrestricted=calculatePointingAccounting({
  usedMinutes:420,goodPieces:10000,rejects:0,cycleSeconds:287,stopMinutes:0
});
assert.equal(unrestricted.accepted,true,'Uma quantidade acima da estimativa continua permitida.');
assert.equal(unrestricted.advisory,true,'O excesso deve gerar apenas aviso consultivo.');
assert(unrestricted.overrunMinutes>0);

const machineA=calculatePointingAccounting({ usedMinutes:0,goodPieces:60,rejects:0,cycleSeconds:120,stopMinutes:0 });
const machineB=createTurnClock();
assert.equal(machineA.remainingAfter,360);
assert.equal(machineB.remainingMinutes,480,'Cada máquina mantém seu próprio relógio de 480 minutos.');

assert.deepEqual(nextFlowAxes({ physicalStatus:'producing' }),{
  physicalStatus:'producing',opStatus:'active',workflowStatus:'conference_pending'
});
assert.deepEqual(nextFlowAxes({ physicalStatus:'producing',closeOrder:true,finalShift:true }),{
  physicalStatus:'producing',opStatus:'closed',workflowStatus:'shift_closed'
});
assert.equal(operatorCardState({ physicalStatus:'producing',opStatus:'active',workflowStatus:'ready' }),'ready');
assert.equal(operatorCardState({ physicalStatus:'producing',opStatus:'active',workflowStatus:'conference_pending' }),'conference-pending');
assert.equal(operatorCardState({ physicalStatus:'stopped',opStatus:'closed',workflowStatus:'conference_pending' }),'stopped');
assert.equal(operatorCardState({ physicalStatus:'producing',opStatus:'closed',workflowStatus:'conference_pending' }),'no-order');

console.log('NEOMES v6: turno automático, relógio lógico e estados independentes validados.');
