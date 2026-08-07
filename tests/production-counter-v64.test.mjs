import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index,sw,worker,secureMain,workerIndex,wrangler]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../sw.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/production-counter.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/secure-main.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/index.js',import.meta.url),'utf8'),
  readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8')
]);

for(const required of [
  'app/turn-assistant.js?v=6.0.2',
  'app/turn-assistant-autostart.js?v=6.0.0',
  'app/factory-map-stability.js?v=6.3.1',
  'app/factory-map-workspace.js?v=6.3.0',
  'app/auth-shell.js?v=6.2.0'
])assert(index.includes(required),`Recuperação removeu módulo operacional obrigatório: ${required}`);

for(const forbidden of ['production-counter.js','production-counter.css']){
  assert(!index.includes(forbidden),`Frontend de recuperação não pode carregar ${forbidden}.`);
}

for(const token of [
  "const recoveryVersion = '20260807-v3-no-sw'",
  'navigator.serviceWorker.getRegistrations()',
  'registration.unregister()',
  "key.startsWith('neomes-')",
  'window.__NEOMES_RECOVERY_READY',
  'await window.__NEOMES_RECOVERY_READY',
  'window.location.replace'
])assert(index.includes(token),`Bootstrap v3 incompleto: ${token}`);

assert(!index.includes('navigator.serviceWorker.register('),'Recovery v3 não pode registrar novo Service Worker.');
assert(index.includes('for (const modulePath of bootModules) await import(modulePath)'),'Módulos operacionais devem aguardar a limpeza completa do worker antigo.');

for(const token of [
  "const VERSION = 'neomes-recovery-20260807-v3-retired-sw'",
  'self.registration.unregister()',
  "self.addEventListener('fetch', () => {})",
  "event.data?.type === 'RETIRE'"
])assert(sw.includes(token),`Service Worker aposentado incompleto: ${token}`);
assert(!sw.includes('event.respondWith('),'Worker aposentado não pode interceptar navegação ou assets.');
assert(!sw.includes('APP_SHELL'),'Worker aposentado não pode manter app shell em cache.');

for(const token of [
  "headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')",
  "path === '/index.html'",
  "path === '/sw.js'",
  "path.endsWith('.js')",
  "path.endsWith('.css')"
])assert(workerIndex.includes(token),`Worker não protege contra cache antigo do navegador: ${token}`);

for(const token of ['machine_counter_sessions','machine_counter_intervals','conference.counter_started'])assert(worker.includes(token),`Recuperação não deve apagar dados/backend existentes: ${token}`);
for(const token of ['handleProductionCounter','productionCounterHealth'])assert(secureMain.includes(token),`Backend dormente do contador deve permanecer íntegro: ${token}`);
assert(wrangler.includes('worker/secure-main.js'),'Wrangler deve preservar o entrypoint seguro oficial.');

console.log('NEOMES recovery v3: service worker removido, caches eliminados e módulos operacionais iniciados somente após boot limpo.');
