import assert from 'node:assert/strict';

const deploymentUrl=String(process.argv[2]||'').replace(/\/$/,'');
assert(deploymentUrl.startsWith('https://'),'Informe o endereço HTTPS do NEOMES publicado.');

const nonce=Date.now();

async function fetchText(path,label){
  const separator=path.includes('?')?'&':'?';
  const response=await fetch(`${deploymentUrl}${path}${separator}factoryMapSmoke=${nonce}`,{
    redirect:'follow',
    cache:'no-store',
    headers:{ Accept:'text/html,text/css,text/javascript,application/javascript,*/*' }
  });
  const text=await response.text();
  assert(response.ok,`${label}: HTTP ${response.status}: ${text.slice(0,400)}`);
  assert(text.length>0,`${label}: resposta vazia.`);
  return text;
}

function requireIncludes(content,tokens,label){
  for(const token of tokens)assert(content.includes(token),`${label}: conteúdo obrigatório ausente: ${token}`);
}

const healthResponse=await fetch(`${deploymentUrl}/health?factoryMapSmoke=${nonce}`,{ cache:'no-store' });
const health=await healthResponse.json().catch(()=>({}));
assert(healthResponse.ok&&health.ok&&health.database,'Worker/D1 não responderam corretamente.');

const index=await fetchText('/','Página inicial');
requireIncludes(index,[
  'app/factory-map-workspace.css?v=6.3.0',
  'app/factory-map-stability.css?v=6.3.1',
  'app/factory-map-stability.js?v=6.3.1',
  'app/factory-map-workspace.js?v=6.3.0'
],'Página inicial');
assert(index.indexOf('app/factory-map-stability.js?v=6.3.1')<index.indexOf('app/factory-map-workspace.js?v=6.3.0'),'A camada de estabilidade deve carregar antes do workspace.');

const [dashboard,workspace,stability,spatial,workspaceCss,stabilityCss]=await Promise.all([
  fetchText('/app/preparer-dashboard.js','Cockpit do preparador'),
  fetchText('/app/factory-map-workspace.js','Workspace industrial'),
  fetchText('/app/factory-map-stability.js','Estabilidade do mapa'),
  fetchText('/app/factory-map-spatial.js','Motor espacial'),
  fetchText('/app/factory-map-workspace.css','CSS do workspace'),
  fetchText('/app/factory-map-stability.css','CSS de estabilidade')
]);

requireIncludes(dashboard,[
  'REFRESH_INTERVAL_MS = 15000',
  'visibilitychange',
  '/api/v1/turn-assistant/line-dashboard',
  'data-map-machine',
  'prepDetailLayer'
],'Cockpit do preparador');
assert(!/fetch\([^\n]+method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(dashboard),'Cockpit publicado não pode alterar dados operacionais.');

requireIncludes(workspace,[
  'calculateCorridors',
  'calculateLineRegions',
  'requestAnimationFrame',
  'pointerdown',
  'pointermove',
  'sessionStorage',
  'factory-minimap',
  'data-factory-action="fullscreen"',
  'semanticZoomLevel'
],'Workspace industrial');
assert(!/fetch\([^\n]+method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(workspace),'Workspace publicado não pode alterar dados operacionais.');

requireIncludes(stability,[
  'FactoryScopedMutationObserver',
  'NativeMutationObserver',
  'resetBaseFiltersBeforeMap',
  'sanitizeSavedLine',
  'factory-card-distant',
  'window.MutationObserver=NativeMutationObserver'
],'Estabilidade do mapa');
assert(!/fetch\([^\n]+method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(stability),'Camada de estabilidade publicada deve permanecer somente leitura.');

requireIncludes(workspaceCss,[
  'touch-action:none',
  'height:100dvh',
  '.factory-corridor',
  'data-semantic-zoom="distant"',
  '.factory-minimap'
],'CSS do workspace');
requireIncludes(stabilityCss,['factory-map-mode','factory-card-distant','--factory-status'],'CSS de estabilidade');

const spatialModule=await import(`data:text/javascript;base64,${Buffer.from(spatial).toString('base64')}`);
const cards=[
  { line:'Linha 1',x:0,y:0,width:142,height:78 },
  { line:'Linha 1',x:0,y:110,width:142,height:78 },
  { line:'Linha 2',x:250,y:0,width:142,height:78 },
  { line:'Linha 2',x:250,y:110,width:142,height:78 },
  { line:'Linha 3',x:0,y:330,width:142,height:78 },
  { line:'Linha 3',x:250,y:330,width:142,height:78 }
];
const corridors=spatialModule.calculateCorridors(cards,{ minGap:32,maxWidth:64,minLength:150 });
assert(corridors.length>=2,'Motor publicado não inferiu os corredores esperados.');
for(const corridor of corridors)for(const card of cards)assert.equal(spatialModule.rectIntersects(corridor,card),false,'Motor publicado posicionou máquina dentro de corredor.');
assert.equal(spatialModule.semanticZoomLevel(.3),'distant');
assert.equal(spatialModule.semanticZoomLevel(.7),'intermediate');
assert.equal(spatialModule.semanticZoomLevel(1.1),'close');

for(const viewport of [{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1366,height:768}]){
  const plant={x:0,y:0,width:2500,height:2800};
  const camera=spatialModule.fitCamera(viewport,plant,{padding:24});
  assert(plant.width*camera.scale<=viewport.width-48+.001,`Planta publicada não cabe horizontalmente em ${viewport.width}×${viewport.height}.`);
  assert(plant.height*camera.scale<=viewport.height-48+.001,`Planta publicada não cabe verticalmente em ${viewport.width}×${viewport.height}.`);
}

console.log('NEOMES: workspace industrial publicado, acessível, somente leitura e validado nos quatro viewports.');
