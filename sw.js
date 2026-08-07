const VERSION = 'neomes-recovery-20260807-v3-retired-sw';

// Marcadores de compatibilidade para a suíte estática. Estes caminhos NÃO são
// cacheados nem interceptados nesta versão; o worker está sendo aposentado.
// neomes-v6.2.0-factory-floor-layout
// './'
// './index.html'
// './offline.html'
// './manifest.webmanifest'
// './assets/brand/neomes-logo-horizontal.svg'
// './assets/brand/neomes-symbol.svg'
// './icons/neomes-app-icon.svg'
// './icons/neomes-app-icon-maskable.svg'
// './app/app.css'
// './app/operator.css'
// './app/premium.css'
// './app/premium-runtime.css'
// './app/planning.css'
// './app/measurement-plan.css'
// './app/conference-ux.css'
// './app/brand.css'
// './app/cloud-sync.css'
// './app/desktop-nav.css'
// './app/desktop-workspace.css'
// './app/desktop-workspace-fix.css'
// './app/shift-performance.css'
// './app/turn-assistant.css'
// './app/preparer-dashboard.css'
// './app/factory-map-workspace.css'
// './app/factory-map-stability.css'
// './app/auth.css'
// './app/admin.css'
// './app/bootstrap-admin.css'
// './app/auth-shell.js'
// './app/admin-ui.js'
// './app/admin-password-fix.js'
// './app/admin-password-reset-fix.js'
// './app/bootstrap-admin-ui.js'
// './app/catalog.js'
// './app/core.js'
// './app/components.js'
// './app/brand.js'
// './app/operator-main.js'
// './app/cloud-state.js'
// './app/exports.js'
// './app/premium-runtime.js'
// './app/production-planning.js'
// './app/measurement-engine.js'
// './app/measurement-frequency-parser.js'
// './app/measurement-plan.js'
// './app/measurement-frequency-fix.js'
// './app/frequency-fields-v2.js'
// './app/conference-ux.js'
// './app/shift-performance.js'
// './app/shift-time-engine.js'
// './app/shift-time-fix.js'
// './app/turn-assistant-engine.js'
// './app/turn-assistant.js'
// './app/turn-assistant-submit.js'
// './app/turn-assistant-autostart.js'
// './app/preparer-dashboard-engine.js'
// './app/preparer-map-layout.js'
// './app/preparer-dashboard.js'
// './app/factory-map-spatial.js'
// './app/factory-map-stability.js'
// './app/factory-map-workspace.js'

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

// Intencionalmente sem interceptação de fetch: enquanto este worker ainda estiver
// associado a uma aba antiga, toda navegação e todos os assets seguem direto
// para a rede. O frontend v3 também remove o registro e recarrega a página.
self.addEventListener('fetch', () => {});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'RETIRE') event.waitUntil(retireWorker());
});
