const VERSION = 'neomes-v6.2.0-factory-floor-layout-v6.4-counter';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const BASE = self.registration.scope;
const asset = path => new URL(path, BASE).toString();
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/brand/neomes-logo-horizontal.svg',
  './assets/brand/neomes-symbol.svg',
  './icons/neomes-app-icon.svg',
  './icons/neomes-app-icon-maskable.svg',
  './app/app.css',
  './app/operator.css',
  './app/premium.css',
  './app/premium-runtime.css',
  './app/planning.css',
  './app/measurement-plan.css',
  './app/conference-ux.css',
  './app/brand.css',
  './app/cloud-sync.css',
  './app/desktop-nav.css',
  './app/desktop-workspace.css',
  './app/desktop-workspace-fix.css',
  './app/shift-performance.css',
  './app/turn-assistant.css',
  './app/preparer-dashboard.css',
  './app/factory-map-workspace.css',
  './app/factory-map-stability.css',
  './app/production-counter.css',
  './app/auth.css',
  './app/admin.css',
  './app/bootstrap-admin.css',
  './app/auth-shell.js',
  './app/admin-ui.js',
  './app/admin-password-fix.js',
  './app/admin-password-reset-fix.js',
  './app/bootstrap-admin-ui.js',
  './app/catalog.js',
  './app/core.js',
  './app/components.js',
  './app/brand.js',
  './app/operator-main.js',
  './app/cloud-state.js',
  './app/exports.js',
  './app/premium-runtime.js',
  './app/production-planning.js',
  './app/measurement-engine.js',
  './app/measurement-frequency-parser.js',
  './app/measurement-plan.js',
  './app/measurement-frequency-fix.js',
  './app/frequency-fields-v2.js',
  './app/conference-ux.js',
  './app/shift-performance.js',
  './app/shift-time-engine.js',
  './app/shift-time-fix.js',
  './app/turn-assistant-engine.js',
  './app/turn-assistant.js',
  './app/turn-assistant-submit.js',
  './app/turn-assistant-autostart.js',
  './app/preparer-dashboard-engine.js',
  './app/preparer-map-layout.js',
  './app/preparer-dashboard.js',
  './app/factory-map-spatial.js',
  './app/factory-map-stability.js',
  './app/factory-map-workspace.js',
  './app/production-counter-engine.js',
  './app/production-counter.js'
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
      .then(() => self.clients.matchAll({ type:'window' }))
      .then(clients => clients.forEach(client => client.postMessage({ type:'APP_UPDATED', version:VERSION })))
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
          if (response.ok) caches.open(RUNTIME_CACHE).then(cache => cache.put(request,response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(asset('./index.html'))) || caches.match(asset('./offline.html')))
    );
    return;
  }

  const mustBeFresh = request.destination === 'script' || request.destination === 'style' || /\.(?:js|css)$/.test(url.pathname);
  if (mustBeFresh) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) caches.open(RUNTIME_CACHE).then(cache => cache.put(request,response.clone()));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) caches.open(RUNTIME_CACHE).then(cache => cache.put(request,response.clone()));
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
