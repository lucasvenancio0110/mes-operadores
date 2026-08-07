import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePreparerMetrics, closureCopy, closureUrgency, preparerMachineState } from '../app/preparer-dashboard-engine.js';
import { FACTORY_MAP_GEOMETRY, FACTORY_MAP_POSITIONS, factoryMapBounds, factoryMapMachineIds, mapMachineMetadata } from '../app/preparer-map-layout.js';

await import('./factory-map-workspace-v6.test.mjs');

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [dashboard,authShell,css,index,serviceWorker,backend,workspace,workspaceCss,spatial,runtime,runtimeBackend]=await Promise.all([
  read('app/preparer-dashboard.js'),read('app/auth-shell.js'),read('app/preparer-dashboard.css'),
  read('index.html'),read('sw.js'),read('worker/turn-assistant.js'),
  read('app/factory-map-workspace.js'),read('app/factory-map-workspace.css'),read('app/factory-map-spatial.js'),
  read('app/machine-runtime.js'),read('worker/machine-runtime.js')
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
const reference=new Date('2026-08-06T08:00:00.000Z');
assert.equal(closureUrgency({ forecast:{ estimatedAt:'2026-08-07T00:00:00.000Z' } },reference).code,'attention','Exatamente 16 horas deve entrar no alerta laranja.');
assert.equal(closureUrgency({ forecast:{ estimatedAt:'2026-08-06T16:00:00.000Z' } },reference).code,'attention','Exatamente 8 horas ainda deve permanecer no alerta laranja.');
assert.equal(closureUrgency({ forecast:{ estimatedAt:'2026-08-06T15:59:59.000Z' } },reference).code,'critical','Qualquer instante abaixo de 8 horas deve entrar no alerta crítico.');
assert.equal(closureUrgency({ forecast:{ estimatedAt:'2026-08-06T15:59:00.000Z' } },reference).code,'critical','Menos de 8 horas deve entrar no alerta crítico.');
assert.equal(closureUrgency({ forecast:{ estimatedAt:'2026-08-07T00:01:00.000Z' } },reference).code,'stable','Acima de 16 horas não deve gerar alerta.');

const mapped=factoryMapMachineIds();
assert.equal(mapped.length,136,'Mapa deve cobrir 134 TNL, MILLTAP e DISCOVERY.');
assert.equal(new Set(mapped).size,mapped.length,'Nenhuma máquina pode aparecer duas vezes no mapa.');
assert.equal(FACTORY_MAP_POSITIONS.filter(position=>position.provisional).length,3,'Somente TNL 006, 144 e 145 devem permanecer provisórias.');
for(const machineId of ['tnl-006','tnl-144','tnl-145'])assert.equal(mapMachineMetadata(machineId).provisional,true,`${machineId} deve permanecer sinalizada como posição provisória.`);
assert.equal(mapMachineMetadata('tnl-024').placement.cell,'B2','A TNL 024 deve conservar a âncora da planilha.');
assert.equal(mapMachineMetadata('tnl-091').placement.cell,'L17','A TNL 091 deve conservar a âncora da planilha.');
assert.equal(mapMachineMetadata('tnl-091').workcenter,'TNL_A3','Work center deve permanecer como observação técnica da máquina.');
const bounds=factoryMapBounds();
assert(bounds.width>2000&&bounds.height>2500,'O mapa geral deve preservar a proporção espacial completa da planilha.');
const overlaps=[];
for(let first=0;first<FACTORY_MAP_POSITIONS.length;first+=1)for(let second=first+1;second<FACTORY_MAP_POSITIONS.length;second+=1){
  const a=FACTORY_MAP_POSITIONS[first];const b=FACTORY_MAP_POSITIONS[second];
  if(a.x<b.x+FACTORY_MAP_GEOMETRY.cardWidth&&a.x+FACTORY_MAP_GEOMETRY.cardWidth>b.x&&a.y<b.y+FACTORY_MAP_GEOMETRY.cardHeight&&a.y+FACTORY_MAP_GEOMETRY.cardHeight>b.y)overlaps.push([a.machineId,b.machineId]);
}
assert.deepEqual(overlaps,[],'Os cards uniformes não podem se sobrepor nas posições da planilha.');

assert(authShell.includes("['preparator','leadership'].includes(user.roleCode)")&&authShell.includes("import('./preparer-dashboard.js')"),'Preparador e liderança não são roteados ao cockpit visual.');
assert(dashboard.includes('/api/v1/turn-assistant/line-dashboard'),'Cockpit não consulta a linha autorizada.');
assert(dashboard.includes('REFRESH_INTERVAL_MS = 15000')&&dashboard.includes("visibilitychange"),'Atualização ao vivo de 15 segundos ausente.');
assert(dashboard.includes('detectOperationalContext()')&&dashboard.includes('prepShiftLabel'),'Cockpit não troca automaticamente de contexto na virada do turno.');
assert(!/fetch\([^\n]+method:\s*['\"](?:POST|PUT|PATCH|DELETE)/.test(dashboard),'Cockpit do preparador deve ser somente leitura.');
for(const text of ['Operador responsável','Meta no saldo do turno','Relógio lógico usado','Risco de material','Liberações do turno','Último apontamento'])assert(dashboard.includes(text),`Informação ausente no cockpit: ${text}`);
for(const text of ['Mapa da fábrica','PLANTA DA FÁBRICA','Mapa geral','Deslize para navegar','POSIÇÃO PROVISÓRIA','REGISTRO TÉCNICO · WORK CENTER'])assert(dashboard.includes(text),`Informação ausente no mapa: ${text}`);
for(const forbidden of ['BLOCO OPERACIONAL','Bloco principal','Bloco frontal','Bloco intermediário','Bloco inferior','Bloco especial'])assert(!dashboard.includes(forbidden),`O mapa ainda contém uma divisão inventada: ${forbidden}`);
assert(dashboard.includes("let viewMode = 'map'")&&dashboard.includes('data-view-mode')&&dashboard.includes('data-map-machine'),'Navegação entre mapa e detalhes não foi criada.');
assert(dashboard.includes('data-map-zoom="fit"')&&dashboard.includes('factoryMapBounds'),'Zoom e recorte espacial por linha não foram criados.');
assert(dashboard.includes('prepDetailLayer')&&dashboard.includes('role="dialog"'),'Detalhe acessível da máquina não foi criado.');
assert(css.includes('@media(max-width:760px)')&&css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'),'Cockpit não cobre desktop e celular.');
assert(css.includes('width:142px;height:78px')&&css.includes('position:absolute'),'Cards do mapa não possuem tamanho compacto, uniforme e espacial.');
assert(css.includes('touch-action:pan-x pan-y')&&css.includes('transform-origin:top left'),'Mapa não permite navegação espacial no celular.');
assert(css.includes('.prep-map-status[data-tone="critical"]')&&css.includes('footer[data-urgency="critical"]'),'Status e risco de fechamento não possuem linguagens visuais independentes.');
assert(index.includes('app/preparer-dashboard.css?v=6.2.0'),'CSS do mapa não está versionado no index.');

assert(index.includes('app/factory-map-workspace.css?v=6.3.0')&&index.includes('app/factory-map-workspace.js?v=6.3.0'),'Workspace industrial 6.3.0 não está carregado.');
for(const capability of ['MutationObserver','pointerdown','pointermove','requestAnimationFrame','sessionStorage','data-factory-action="fullscreen"','factory-minimap','calculateCorridors','semanticZoomLevel'])assert(workspace.includes(capability),`Workspace industrial sem capacidade: ${capability}`);
for(const capability of ['calculateCorridors','fitCamera','clampCamera','semanticZoomLevel','rectIntersects'])assert(spatial.includes(capability),`Motor espacial sem capacidade: ${capability}`);
assert(workspaceCss.includes('touch-action:none')&&workspaceCss.includes('height:100dvh')&&workspaceCss.includes('data-semantic-zoom="distant"')&&workspaceCss.includes('.factory-corridor'),'CSS não cobre gesto, tela cheia, semantic zoom e corredores.');
assert(!/fetch\([^\n]+method:\s*['\"](?:POST|PUT|PATCH|DELETE)/.test(workspace),'Workspace do mapa deve permanecer somente leitura.');

assert(backend.includes("auth.lineAccess")&&backend.includes("/api/v1/turn-assistant/line-dashboard")&&backend.includes("Acesso restrito ao preparador"),'Backend não protege o cockpit por perfil e linha.');

assert(index.includes('app/machine-runtime.js?v=1.0.0')&&index.includes('app/machine-runtime.css?v=1.0.0'),'Domínio de situação física não está carregado.');
for(const status of ['producing','setup','adjustment','maintenance','stopped'])assert(runtime.includes(status),`Situação física ausente: ${status}`);
assert(runtimeBackend.includes('machine_runtime_states')&&runtimeBackend.includes('machine.status_changed'),'Situação física não está persistida/auditada no domínio correto.');
assert(!index.includes('production-counter.js')&&!index.includes('production-counter.css'),'Contador não pode participar do frontend de recuperação.');
assert(serviceWorker.includes('self.registration.unregister()'),'Service Worker de recuperação deve se aposentar.');
assert(!serviceWorker.includes('respondWith('),'Service Worker de recuperação não pode interceptar rede.');
assert(!serviceWorker.includes('Marcadores de compatibilidade'),'Service Worker não pode conter strings artificiais para satisfazer testes.');

console.log('NEOMES recovery: cálculos, mapa, status físico isolado e frontend sem contador validados.');
