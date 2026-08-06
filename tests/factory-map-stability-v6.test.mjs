import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [index,serviceWorker,stability,stabilityCss,spatial]=await Promise.all([
  read('index.html'),
  read('sw.js'),
  read('app/factory-map-stability.js'),
  read('app/factory-map-stability.css'),
  read('app/factory-map-spatial.js')
]);

const stabilityScript='app/factory-map-stability.js?v=6.3.1';
const workspaceScript='app/factory-map-workspace.js?v=6.3.0';
assert(index.includes(stabilityScript)&&index.includes(workspaceScript),'Camadas do mapa não estão carregadas.');
assert(index.indexOf(stabilityScript)<index.indexOf(workspaceScript),'A estabilidade deve carregar antes do workspace.');
assert(index.includes('app/factory-map-stability.css?v=6.3.1'),'CSS de estabilidade não está carregado.');
for(const asset of ['./app/factory-map-stability.js','./app/factory-map-stability.css'])assert(serviceWorker.includes(asset),`Service Worker não inclui ${asset}.`);
for(const capability of ['NativeMutationObserver','FactoryScopedMutationObserver','workspaceObserverPending','resetBaseFiltersBeforeMap','sanitizeSavedLine','factory-card-distant'])assert(stability.includes(capability),`Camada de estabilidade sem capacidade: ${capability}`);
assert(stability.includes('window.MutationObserver=NativeMutationObserver'),'MutationObserver global deve ser restaurado após escopar o workspace.');
assert(!/fetch\([^\n]+method:\s*['\"](?:POST|PUT|PATCH|DELETE)/.test(stability),'Camada de estabilidade deve permanecer somente leitura.');
for(const capability of ['factory-map-mode','factory-card-distant','data-semantic-zoom="distant"','--factory-status'])assert(stabilityCss.includes(capability),`CSS de estabilidade sem capacidade: ${capability}`);
assert(spatial.includes('minScale:0.12'),'Zoom mínimo deve enquadrar a planta completa no celular.');

console.log('Workspace industrial: estabilidade, ordem de carregamento e legibilidade distante validadas.');
