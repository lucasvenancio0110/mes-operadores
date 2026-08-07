import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index,sw,worker,secureMain,wrangler]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../sw.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/production-counter.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/secure-main.js',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8')
]);

for(const required of [
  'app/turn-assistant.js?v=6.0.1',
  'app/turn-assistant-autostart.js?v=6.0.0',
  'app/factory-map-stability.js?v=6.3.1',
  'app/factory-map-workspace.js?v=6.3.0',
  'app/auth-shell.js?v=6.2.0'
])assert(index.includes(required),`Rollback removeu módulo operacional obrigatório: ${required}`);

for(const forbidden of ['production-counter.js','production-counter.css']){
  assert(!index.includes(forbidden),`Frontend de recuperação não pode carregar ${forbidden}.`);
  assert(!sw.includes(`./app/${forbidden}`),`Service Worker de recuperação não pode armazenar ${forbidden}.`);
}

assert(sw.includes("const VERSION = 'neomes-v6.2.0-factory-floor-layout-recovery-20260807-v1'"),'Cache de recuperação deve possuir identidade nova preservando o contrato 6.2.0.');
assert(sw.includes('keys.filter(key => ![STATIC_CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key))'),'Ativação deve apagar caches antigos da PWA.');
assert(sw.includes('self.skipWaiting()')&&sw.includes('self.clients.claim()'),'Service Worker de recuperação deve assumir o controle sem aguardar versão antiga.');
for(const asset of ['./app/turn-assistant.js','./app/preparer-dashboard.js','./app/factory-map-workspace.js','./app/auth-shell.js'])assert(sw.includes(asset),`PWA de recuperação sem asset operacional: ${asset}`);

for(const token of ['machine_counter_sessions','machine_counter_intervals','conference.counter_started'])assert(worker.includes(token),`Rollback não deve apagar dados/backend existentes: ${token}`);
for(const token of ['handleProductionCounter','productionCounterHealth'])assert(secureMain.includes(token),`Backend dormente do contador deve permanecer íntegro: ${token}`);
assert(wrangler.includes('worker/secure-main.js'),'Wrangler deve preservar o entrypoint seguro oficial.');

console.log('NEOMES recovery: frontend pré-contador restaurado, caches 6.4 invalidados e backend preservado.');
