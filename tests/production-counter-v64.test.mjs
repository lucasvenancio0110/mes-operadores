import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateEstimatedCounter, auditDiff, isCounterRunning } from '../app/production-counter-engine.js';

const base={conferenceAt:'2026-08-06T18:00:00.000Z',cycleSeconds:120,initialShiftPieces:5,officialProduced:100,currentBarPieces:50,feederBars:2,piecesPerFullBar:50};
const running=calculateEstimatedCounter({...base,now:'2026-08-06T18:10:00.000Z',physicalStatus:'producing'});
assert.equal(running.estimatedShiftPieces,10,'Cinco ciclos após a conferência devem somar cinco peças estimadas.');
assert.equal(running.estimatedOrderProduced,105,'Produção estimada da OP parte do valor oficial confirmado.');
assert.equal(running.estimatedRemainingPieces,145,'Material estimado deve descontar apenas os ciclos estimados após a conferência.');
assert.equal(running.estimatedFinishAt,'2026-08-06T23:00:00.000Z','ETA inicial deve refletir somente o tempo produtivo restante.');

const paused=calculateEstimatedCounter({...base,now:'2026-08-06T18:40:00.000Z',physicalStatus:'maintenance',runningIntervals:[{startedAt:'2026-08-06T18:00:00.000Z',endedAt:'2026-08-06T18:10:00.000Z'}]});
assert.equal(paused.estimatedShiftPieces,10,'Contador não pode avançar durante manutenção.');
assert.equal(paused.estimatedFinishAt,'2026-08-06T23:30:00.000Z','Trinta minutos parado devem empurrar o ETA em trinta minutos.');
assert.equal(isCounterRunning('setup'),false);
assert.equal(isCounterRunning('ajuste'),false);
assert.equal(isCounterRunning('producing'),true);

const resumed=calculateEstimatedCounter({...base,now:'2026-08-06T18:50:00.000Z',physicalStatus:'producing',runningIntervals:[{startedAt:'2026-08-06T18:00:00.000Z',endedAt:'2026-08-06T18:10:00.000Z'},{startedAt:'2026-08-06T18:40:00.000Z',endedAt:null}]});
assert.equal(resumed.estimatedShiftPieces,15,'Após 30 min parado, o contador deve retomar do ponto anterior e somar apenas tempo produzindo.');
assert.equal(resumed.estimatedFinishAt,'2026-08-06T23:30:00.000Z','Ao retomar, o ETA deve incorporar a parada sem criar atraso adicional indevido.');

const halfCycle=calculateEstimatedCounter({...base,now:'2026-08-06T18:01:00.000Z',physicalStatus:'maintenance',runningIntervals:[{startedAt:'2026-08-06T18:00:00.000Z',endedAt:'2026-08-06T18:01:00.000Z'}]});
assert.equal(halfCycle.estimatedShiftPieces,5,'Meio ciclo ainda não pode contar uma peça.');
assert.equal(halfCycle.partialCycleSeconds,60,'Progresso parcial do ciclo deve ser preservado.');
assert.equal(halfCycle.estimatedRemainingSeconds,17940,'ETA deve descontar o minuto produtivo já consumido no ciclo atual.');

assert.deepEqual(auditDiff({cycleSeconds:90,op:'1'},{cycleSeconds:95,op:'1'},['cycleSeconds','op']),[{field:'cycleSeconds',before:90,after:95}]);

const [index,sw,worker,secureMain,ui,css,wrangler]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../sw.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/production-counter.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/secure-main.js',import.meta.url),'utf8'),
  readFile(new URL('../app/production-counter.js',import.meta.url),'utf8'),
  readFile(new URL('../app/production-counter.css',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8')
]);
for(const token of ['production-counter.css?v=6.4.0','production-counter.js?v=6.4.0'])assert(index.includes(token),`Index sem ${token}`);
for(const token of ['./app/production-counter-engine.js','./app/production-counter.js','./app/production-counter.css'])assert(sw.includes(token),`PWA sem ${token}`);
for(const token of ['machine_counter_sessions','machine_counter_intervals','machine_history_events','conference.counter_started','machine.status_changed','order.data_changed'])assert(worker.includes(token),`Backend sem ${token}`);
for(const token of ['handleProductionCounter','productionCounterHealth','/api/v1/auth/production-counter-health'])assert(secureMain.includes(token),`Worker seguro sem integração: ${token}`);
for(const token of ['initialShiftPieces','CONTADOR ESTIMADO','Editar dados','Histórico da máquina','setInterval(renderPanels,1000)','15000'])assert(ui.includes(token),`UI sem ${token}`);
for(const token of ["document.querySelectorAll('.ops-machine-card')","ensureCounterPanel(card,machineId,'card')","pendingConferences.set(machineId,","store.subscribe((_state,reason)=>"])assert(ui.includes(token),`Contador não integrado ao card principal: ${token}`);
assert(!ui.includes('document.body.contains(form)'),'Conferência não pode ser descartada enquanto o formulário ainda estiver no DOM.');
assert(!ui.includes('setTimeout(()=>registerConference'),'Inicialização do contador não pode depender de timeout arbitrário.');
for(const token of ['neomes-live-counter','neomes-counter-status-actions','neomes-counter-modal'])assert(css.includes(token),`CSS sem ${token}`);
assert(wrangler.includes('worker/secure-main.js'),'Wrangler deve preservar o entrypoint seguro oficial.');

console.log('NEOMES 6.4: contador no card, início pós-conferência, pausa, retomada, ETA e histórico auditável validados.');
