import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePreparerMetrics, closureCopy, preparerMachineState } from '../app/preparer-dashboard-engine.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [dashboard,authShell,css,index,serviceWorker,backend]=await Promise.all([
  read('app/preparer-dashboard.js'),read('app/auth-shell.js'),read('app/preparer-dashboard.css'),
  read('index.html'),read('sw.js'),read('worker/turn-assistant.js')
]);

const machine={
  activeOrder:{ op:'123',item:'ABC',opTarget:1000,producedSoFar:500,cycleSeconds:120,frequency1:100,frequency2:75 },
  turnClock:{ usedMinutes:120,remainingMinutes:360 },
  turnState:{ goodPieces:40,rejects:2,stopMinutes:15 },
  runtimeState:{ physicalStatus:'producing' },
  flowAxes:{ physicalStatus:'producing',opStatus:'active',workflowStatus:'ready' },
  forecast:{ reason:'op',estimatedAt:'2026-08-06T18:00:00.000Z',materialEstimatedAt:'2026-08-06T20:00:00.000Z',opRemaining:500,availablePieces:800 }
};
const metrics=calculatePreparerMetrics(machine);
assert.equal(metrics.turnTarget,180,'A meta deve usar 360 minutos restantes divididos pelo ciclo de 2 minutos.');
assert.equal(metrics.shiftTarget,180,'A meta do saldo deve respeitar OP e matéria-prima.');
assert.deepEqual(metrics.releases.map(item=>item.turnPiece),[65,140,140,215],'Todas as liberações devem aparecer em peças acumuladas do turno.');
assert.equal(preparerMachineState(machine).code,'producing');
assert.equal(preparerMachineState({ ...machine,flowAxes:{ ...machine.flowAxes,workflowStatus:'conference_pending' } }).code,'conference-pending');
assert.equal(closureCopy(machine).reason,'op');
assert(closureCopy(machine).secondary.includes('matéria-prima'));
assert.equal(closureCopy({ ...machine,forecast:{ ...machine.forecast,reason:'material' } }).secondary,'','Falta de material não deve sugerir adicionar barra nem repetir aviso.');

assert(authShell.includes("user.roleCode === 'preparator'")&&authShell.includes("import('./preparer-dashboard.js')"),'Preparador não é roteado ao cockpit próprio.');
assert(dashboard.includes('/api/v1/turn-assistant/line-dashboard'),'Cockpit não consulta a linha autorizada.');
assert(dashboard.includes('REFRESH_INTERVAL_MS = 15000')&&dashboard.includes("visibilitychange"),'Atualização ao vivo de 15 segundos ausente.');
assert(dashboard.includes('detectOperationalContext()')&&dashboard.includes('prepShiftLabel'),'Cockpit não troca automaticamente de contexto na virada do turno.');
assert(!/fetch\([^\n]+method:\s*['\"](?:POST|PUT|PATCH|DELETE)/.test(dashboard),'Cockpit do preparador deve ser somente leitura.');
for(const text of ['Operador responsável','Meta no saldo do turno','Relógio lógico usado','Risco de material','Liberações do turno','Último apontamento'])assert(dashboard.includes(text),`Informação ausente no cockpit: ${text}`);
assert(css.includes('@media(max-width:760px)')&&css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'),'Cockpit não cobre desktop e celular.');
assert(index.includes('app/preparer-dashboard.css?v=6.0.0'),'CSS do cockpit não está versionado no index.');
for(const asset of ['./app/preparer-dashboard.css','./app/preparer-dashboard.js','./app/preparer-dashboard-engine.js'])assert(serviceWorker.includes(asset),`Service Worker não inclui ${asset}.`);
assert(backend.includes("auth.lineAccess")&&backend.includes("/api/v1/turn-assistant/line-dashboard")&&backend.includes("Acesso restrito ao preparador"),'Backend não protege o cockpit por perfil e linha.');

console.log('NEOMES v6 preparador: linha autorizada, cockpit ao vivo e leitura operacional validados.');
