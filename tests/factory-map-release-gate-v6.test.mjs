import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const smokeUrl=new URL('../scripts/smoke-factory-map.mjs',import.meta.url);
const workflowUrl=new URL('../.github/workflows/factory-map-production-smoke.yml',import.meta.url);
const [smoke,workflow]=await Promise.all([readFile(smokeUrl,'utf8'),readFile(workflowUrl,'utf8')]);

const syntax=spawnSync(process.execPath,['--check',fileURLToPath(smokeUrl)],{ encoding:'utf8' });
assert.equal(syntax.status,0,syntax.stderr||'Smoke remoto do mapa contém erro de sintaxe.');

for(const capability of [
  'factory-map-workspace.js?v=6.3.0',
  'factory-map-stability.js?v=6.3.1',
  'calculateCorridors',
  'semanticZoomLevel',
  'rectIntersects',
  '390,height:844',
  '430,height:932',
  '768,height:1024',
  '1366,height:768',
  'Worker/D1',
  'somente leitura'
])assert(smoke.includes(capability),`Smoke remoto sem contrato: ${capability}`);

for(const contract of [
  "workflows: ['Deploy NEOMES to Cloudflare']",
  "branches: [main]",
  'github.event.workflow_run.conclusion == \'success\'',
  'node --check scripts/smoke-factory-map.mjs',
  'node scripts/smoke-factory-map.mjs https://mes-operadores.lucassantanals0110.workers.dev',
  'deployment/factory-map-smoke-latest.json',
  'Bloquear conclusão quando o smoke falhar',
  'steps.factory_smoke.outcome != \'success\''
])assert(workflow.includes(contract),`Workflow de produção sem contrato: ${contract}`);

console.log('Mapa industrial: gate pós-deploy, smoke remoto e evidência persistente validados.');
