import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  html, css, operatorCss, premiumCss, premiumRuntimeCss, manifestText, worker,
  operatorMain, premiumRuntime, core, exportsModule, serviceWorker, brandMark, appIcon
] = await Promise.all([
  read('index.html'),
  read('app/app.css'),
  read('app/operator.css'),
  read('app/premium.css'),
  read('app/premium-runtime.css'),
  read('manifest.webmanifest'),
  read('worker/main.js'),
  read('app/operator-main.js'),
  read('app/premium-runtime.js'),
  read('app/core.js'),
  read('app/exports.js'),
  read('sw.js'),
  read('icons/neomes-mark.svg'),
  read('icons/mes-icon.svg')
]);
const manifest = JSON.parse(manifestText);

assert(!html.includes('maximum-scale=1'), 'O zoom do navegador não pode ser bloqueado.');
assert(html.includes('viewport-fit=cover'), 'O layout deve respeitar safe areas.');
assert(html.includes('manifest.webmanifest'), 'O manifesto PWA deve estar ligado ao HTML.');
assert(html.includes('operator-main.js'), 'A experiência simplificada deve ser o ponto de entrada.');
assert(html.includes('operator.css'), 'Os estilos operacionais devem estar ligados ao HTML.');
assert(html.includes('premium.css'), 'O design system premium deve estar ligado ao HTML.');
assert(html.includes('premium-runtime.js'), 'A camada premium de branding deve estar ligada ao HTML.');
assert(html.includes('neomes-mark.svg'), 'A splash deve utilizar a marca vetorial.');
assert(!html.includes('app/main.js'), 'A interface antiga não deve continuar carregada.');
assert(!html.includes('app/runtime.js'), 'A camada corretiva antiga não deve continuar carregada.');
assert(!html.includes('src="/app/'), 'Scripts absolutos quebram a publicação em subdiretório.');
assert(!html.includes('href="/app/'), 'Estilos absolutos quebram a publicação em subdiretório.');

for (const token of ['--color-background', '--color-surface', '--color-brand', '--color-success', '--color-warning', '--color-danger', '--space-4', '--radius-lg', '--duration-normal']) {
  assert(css.includes(token), `Token de design base ausente: ${token}`);
}
for (const token of ['--premium-bg', '--premium-surface', '--premium-brand', '--premium-radius-l', '--premium-shadow-2', '--premium-ease']) {
  assert(premiumCss.includes(token), `Token premium ausente: ${token}`);
}
assert(operatorCss.includes('env(safe-area-inset-bottom)'), 'Safe area inferior ausente na experiência operacional.');
assert(premiumCss.includes('env(safe-area-inset-bottom)'), 'Safe area inferior ausente na camada premium.');
assert(premiumCss.includes('@media(prefers-reduced-motion:reduce)'), 'Preferência de movimento reduzido não tratada.');
assert(premiumCss.includes('@media(display-mode:standalone)'), 'Modo PWA standalone não refinado.');
assert(premiumRuntimeCss.includes('.ops-menu-brand'), 'Branding premium do menu ausente.');

for (const route of ['turn', 'history', 'more']) {
  assert(operatorMain.includes(`'${route}'`), `Rota simplificada ausente: ${route}`);
}
for (const flow of ['openConference', 'openBatchClose', 'openCloseOrder', 'renderHistory', 'renderCellView']) {
  assert(operatorMain.includes(flow), `Fluxo essencial ausente: ${flow}`);
}
assert(operatorMain.includes('Fechamento manual do turno'), 'O sistema deve declarar que o fechamento é manual.');
assert(operatorMain.includes('Última situação informada'), 'O status deve ser apresentado como informação manual.');
assert(!operatorMain.includes('progress-track'), 'A experiência não deve simular progresso contínuo.');
assert(!operatorMain.includes('Previsão ao final'), 'A experiência não deve apresentar previsão automática de produção.');
assert(!operatorMain.includes('Informação desatualizada'), 'Não deve existir alerta baseado em ausência de telemetria.');
assert(premiumRuntime.includes('Apontamento manual'), 'A identidade deve deixar claro o modelo de apontamento manual.');
assert(premiumRuntime.includes('NeoMES'), 'A assinatura visual NeoMES deve estar presente.');

assert(brandMark.includes('<svg') && brandMark.includes('Símbolo NEODENT MES'), 'Marca vetorial inválida.');
assert(appIcon.includes('<svg') && appIcon.includes('NEOMES'), 'Ícone da PWA inválido.');
assert.equal(manifest.display, 'standalone', 'PWA deve abrir em modo standalone.');
assert(String(manifest.start_url).startsWith('./'), 'O start_url deve funcionar em subdiretórios.');
assert.equal(manifest.scope, './', 'O escopo PWA deve ser relativo.');
assert(manifest.icons?.length, 'Manifesto sem ícones.');
assert(manifest.shortcuts?.some(item => item.url.includes('route=turn')), 'Atalho para o turno ausente.');
assert(manifest.shortcuts?.some(item => item.url.includes('route=history')), 'Atalho para o histórico ausente.');

for (const asset of ['./app/operator-main.js', './app/operator.css', './app/premium.css', './app/premium-runtime.css', './app/premium-runtime.js', './icons/neomes-mark.svg']) {
  assert(serviceWorker.includes(asset), `Service Worker não inclui ${asset}.`);
}

for (const route of ['/api/v1/machine-states', '/api/v1/events', '/api/v1/records', '/api/v1/assignments']) {
  assert(worker.includes(route), `Rota do Worker ausente: ${route}`);
}
for (const exportFeature of ['exportPdf', 'exportImage', 'shareSummary']) {
  assert(exportsModule.includes(exportFeature), `Exportação ausente: ${exportFeature}`);
}
assert(core.includes('mes-operadores:v2'), 'Migração dos dados anteriores ausente.');
assert(core.includes('syncQueue'), 'Fila offline ausente.');

console.log('Static premium NEODENT MES checks passed.');
