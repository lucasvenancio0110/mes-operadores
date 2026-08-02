import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [html,css,manifestText,worker,main,core,components,exportsModule,serviceWorker] = await Promise.all([
  read('index.html'),read('app/app.css'),read('manifest.webmanifest'),read('worker/main.js'),
  read('app/main.js'),read('app/core.js'),read('app/components.js'),read('app/exports.js'),read('sw.js')
]);
const manifest = JSON.parse(manifestText);

assert(!html.includes('maximum-scale=1'),'O zoom do navegador não pode ser bloqueado.');
assert(html.includes('viewport-fit=cover'),'O layout deve respeitar safe areas.');
assert(html.includes('manifest.webmanifest'),'O manifesto PWA deve estar ligado ao HTML.');
assert(!html.includes('src="/app/'),'Scripts absolutos quebram a publicação em subdiretório.');
assert(!html.includes('href="/app/'),'Estilos absolutos quebram a publicação em subdiretório.');
for (const moduleName of ['main.js','cloud-state.js','exports.js','runtime.js']) assert(html.includes(moduleName),`Módulo ${moduleName} ausente.`);

for (const token of ['--color-background','--color-surface','--color-brand','--color-success','--color-warning','--color-danger','--space-4','--radius-lg','--duration-normal']) {
  assert(css.includes(token),`Token de design ausente: ${token}`);
}
assert(css.includes('env(safe-area-inset-bottom)'),'Safe area inferior ausente.');
assert(css.includes('@media(prefers-reduced-motion:reduce)'),'Preferência de movimento reduzido não tratada.');
assert(css.includes('@media(min-width:1024px)'),'Layout desktop não definido.');

assert.equal(manifest.display,'standalone','PWA deve abrir em modo standalone.');
assert(String(manifest.start_url).startsWith('./'),'O start_url deve funcionar em subdiretórios.');
assert.equal(manifest.scope,'./','O escopo PWA deve ser relativo.');
assert(manifest.icons?.length,'Manifesto sem ícones.');
assert(serviceWorker.includes('/app/cloud-state.js'),'Service Worker não inclui o estado compartilhado.');
assert(serviceWorker.includes('/app/exports.js'),'Service Worker não inclui as exportações.');

for (const route of ['/api/v1/machine-states','/api/v1/events','/api/v1/records','/api/v1/assignments']) {
  assert(worker.includes(route),`Rota do Worker ausente: ${route}`);
}
for (const feature of ['openConference','openPointing','renderAndon','renderAlerts','saveAssignments']) {
  assert(main.includes(feature) || components.includes(feature),`Fluxo essencial ausente: ${feature}`);
}
for (const exportFeature of ['exportPdf','exportImage','shareSummary']) {
  assert(exportsModule.includes(exportFeature),`Exportação ausente: ${exportFeature}`);
}
assert(core.includes('mes-operadores:v2'),'Migração dos dados anteriores ausente.');
assert(core.includes('syncQueue'),'Fila offline ausente.');

console.log('Static MES checks passed.');
