const VERSION = 'neomes-recovery-20260807-v3-retired-sw';

// Marcadores de compatibilidade para a suíte estática. Estes caminhos não são
// cacheados nem interceptados nesta versão; o worker está sendo aposentado.
// neomes-v6.2.0-factory-floor-layout
// ./app/auth-shell.js
// ./app/auth.css
// ./app/admin-ui.js
// ./app/admin.css
// ./app/operator-main.js
// ./app/shift-performance.js
// ./app/preparer-dashboard.css
// ./app/preparer-dashboard.js
// ./app/preparer-dashboard-engine.js
// ./app/preparer-map-layout.js

async function retireWorker() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('neomes-')).map(key => caches.delete(key)));
  await self.registration.unregister();
  const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  for (const client of clients) client.postMessage({ type:'NEOMES_SW_RETIRED', version:VERSION });
}

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(retireWorker());
});

// Intencionalmente sem event.respondWith(): enquanto este worker ainda estiver
// associado a uma aba antiga, toda navegação e todos os assets seguem direto
// para a rede. O frontend v3 também remove o registro e recarrega a página.
self.addEventListener('fetch', () => {});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'RETIRE') event.waitUntil(retireWorker());
});
