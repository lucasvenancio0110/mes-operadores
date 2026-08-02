import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, css, operatorCss, manifestText, worker, operatorMain, core, exportsModule, serviceWorker] = await Promise.all([
  read('index.html'),
  read('app/app.css'),
  read('app/operator.css'),
  read('manifest.webmanifest'),
  read('worker/main.js'),
  read('app/operator-main.js'),
  read('app/core.js'),
  read('app/exports.js'),
  read('sw.js')
]);
const manifest = JSON.parse(manifestText);

assert(!html.includes('maximum-scale=1'), 'O zoom do navegador não pode ser bloqueado.');
assert(html.includes('viewport-fit=cover'), 'O layout deve respeitar safe areas.');
assert(html.includes('manifest.webmanifest'), 'O manifesto PWA deve estar ligado ao HTML.');
assert(html.includes('operator-main.js'), 'A experiência simplificada deve ser o ponto de entrada.');
assert(html.includes('operator.css'), 'Os estilos da experiência simplificada devem estar ligados ao HTML.');
assert(!html.includes('app/main.js'), 'A interface antiga não deve continuar carregada.');
assert(!html.includes('app/runtime.js'), 'A camada corretiva antiga não deve continuar carregada.');
assert(!html.includes('src="/app/'), 'Scripts absolutos quebram a publicação em subdiretório.');
assert(!html.includes('href="/app/'), 'Estilos absolutos quebram a publicação em subdiretório.');

for (const token of ['--color-background', '--color-surface', '--color-brand', '--color-success', '--color-warning', '--color-danger', '--space-4', '--radius-lg', '--duration-normal']) {
  assert(css.includes(token), `Token de design ausente: ${token}`);
}
assert(operatorCss.includes('env(safe-area-inset-bottom)'), 'Safe area inferior ausente na nova experiência.');
assert(operatorCss.includes('@media(prefers-reduced-motion:reduce)'), 'Preferência de movimento reduzido não tratada.');
assert(operatorCss.includes('@media(min-width:1100px)'), 'Layout para telas amplas não definido.');

for (const route of ['turn', 'history', 'more']) {
  assert(operatorMain.includes(`'${route}'`), `Rota simplificada ausente: ${route}`);
}
for (const flow of ['openConference', 'openBatchClose', 'openCloseOrder', 'renderHistory', 'renderCellView']) {
  assert(operatorMain.includes(flow), `Fluxo essencial ausente: ${flow}`);
}
assert(operatorMain.includes('Fechamento manual do turno'), 'O sistema deve declarar que o fechamento é manual.');
assert(operatorMain.includes('Última situação informada'), 'O status deve ser apresentado como informação manual.');
assert(!operatorMain.includes('progress-track'), 'A nova experiência não deve simular progresso contínuo.');
assert(!operatorMain.includes('Previsão ao final'), 'A nova experiência não deve apresentar previsão automática de produção.');
assert(!operatorMain.includes('Informação desatualizada'), 'Não deve existir alerta baseado em ausência de telemetria.');

assert.equal(manifest.display, 'standalone', 'PWA deve abrir em modo standalone.');
assert(String(manifest.start_url).startsWith('./'), 'O start_url deve funcionar em subdiretórios.');
assert.equal(manifest.scope, './', 'O escopo PWA deve ser relativo.');
assert(manifest.icons?.length, 'Manifesto sem ícones.');
assert(serviceWorker.includes('./app/operator-main.js'), 'Service Worker não inclui a experiência simplificada.');
assert(serviceWorker.includes('./app/operator.css'), 'Service Worker não inclui os novos estilos.');

for (const route of ['/api/v1/machine-states', '/api/v1/events', '/api/v1/records', '/api/v1/assignments']) {
  assert(worker.includes(route), `Rota do Worker ausente: ${route}`);
}
for (const exportFeature of ['exportPdf', 'exportImage', 'shareSummary']) {
  assert(exportsModule.includes(exportFeature), `Exportação ausente: ${exportFeature}`);
}
assert(core.includes('mes-operadores:v2'), 'Migração dos dados anteriores ausente.');
assert(core.includes('syncQueue'), 'Fila offline ausente.');

console.log('Static simplified MES checks passed.');
