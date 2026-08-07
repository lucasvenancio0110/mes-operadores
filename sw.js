const VERSION = 'neomes-recovery-20260807-functional-baseline';

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

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'RETIRE') event.waitUntil(retireWorker());
});
