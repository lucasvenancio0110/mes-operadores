const VERSION = 'neodent-mes-v3.4.0';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const BASE = self.registration.scope;
const asset = path => new URL(path, BASE).toString();
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './icons/mes-icon.svg',
  './icons/neomes-mark.svg',
  './app/app.css',
  './app/operator.css',
  './app/premium.css',
  './app/premium-runtime.css',
  './app/planning.css',
  './app/measurement-plan.css',
  './app/catalog.js',
  './app/core.js',
  './app/components.js',
  './app/operator-main.js',
  './app/cloud-state.js',
  './app/exports.js',
  './app/premium-runtime.js',
  './app/production-planning.js',
  './app/measurement-engine.js',
  './app/measurement-plan.js'
].map(asset);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => ![STATIC_CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(client => client.postMessage({ type: 'APP_UPDATED', version: VERSION })))
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
          return response;
        })
        .catch(async () =>
          (await caches.match(request)) ||
          (await caches.match(asset('./index.html'))) ||
          caches.match(asset('./offline.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
