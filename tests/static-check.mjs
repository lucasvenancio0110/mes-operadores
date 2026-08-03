import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  html, css, operatorCss, premiumCss, premiumRuntimeCss, brandCss, planningCss, measurementCss,
  manifestText, worker, operatorMain, premiumRuntime, brandRuntime, planningRuntime, measurementRuntime,
  measurementEngine, settingsWorker, core, exportsModule, serviceWorker, officialLogo, officialSymbol,
  appIcon, maskableIcon, offline
] = await Promise.all([
  read('index.html'), read('app/app.css'), read('app/operator.css'), read('app/premium.css'),
  read('app/premium-runtime.css'), read('app/brand.css'), read('app/planning.css'), read('app/measurement-plan.css'),
  read('manifest.webmanifest'), read('worker/main.js'), read('app/operator-main.js'),
  read('app/premium-runtime.js'), read('app/brand.js'), read('app/production-planning.js'), read('app/measurement-plan.js'),
  read('app/measurement-engine.js'), read('worker/settings.js'), read('app/core.js'),
  read('app/exports.js'), read('sw.js'), read('assets/brand/neomes-logo-horizontal.svg'),
  read('assets/brand/neomes-symbol.svg'), read('icons/neomes-app-icon.svg'),
  read('icons/neomes-app-icon-maskable.svg'), read('offline.html')
]);
const manifest = JSON.parse(manifestText);

assert(!html.includes('maximum-scale=1'), 'O zoom do navegador não pode ser bloqueado.');
assert(html.includes('viewport-fit=cover'), 'O layout deve respeitar safe areas.');
for (const asset of ['manifest.webmanifest', 'operator-main.js', 'operator.css', 'premium.css', 'premium-runtime.js', 'production-planning.js', 'planning.css', 'measurement-plan.js', 'measurement-plan.css', 'brand.css']) {
  assert(html.includes(asset), `Arquivo não ligado ao HTML: ${asset}`);
}
assert(!html.includes('app/main.js'), 'A interface antiga não deve continuar carregada.');
assert(!html.includes('app/runtime.js'), 'A camada corretiva antiga não deve continuar carregada.');
assert(!html.includes('src="/app/') && !html.includes('href="/app/'), 'Caminhos absolutos quebram o GitHub Pages.');
assert(html.includes('<title>NEOMES — Gestão Operacional</title>'), 'Título oficial NEOMES ausente.');
assert(html.includes('assets/brand/neomes-symbol.svg'), 'Símbolo oficial ausente da splash.');
assert(!html.includes('NEODENT MES'), 'Identidade antiga permanece no ponto de entrada.');

for (const token of ['--color-background', '--color-surface', '--color-brand', '--color-success', '--color-warning', '--color-danger']) {
  assert(css.includes(token), `Token base ausente: ${token}`);
}
for (const token of ['--premium-bg', '--premium-surface', '--premium-brand', '--premium-radius-l', '--premium-shadow-2']) {
  assert(premiumCss.includes(token), `Token premium ausente: ${token}`);
}
for (const token of ['--brand-primary:#af249d', '--brand-primary-hover', '--brand-primary-active', '--brand-primary-soft', '--brand-primary-border']) {
  assert(brandCss.includes(token), `Token oficial da marca ausente: ${token}`);
}
assert(brandCss.includes('object-fit:contain'), 'A logo deve preservar a proporção.');
assert(brandCss.includes('@media(max-width:340px)'), 'Versão compacta do cabeçalho ausente.');
assert(operatorCss.includes('env(safe-area-inset-bottom)'), 'Safe area inferior ausente.');
assert(premiumCss.includes('@media(prefers-reduced-motion:reduce)'), 'Movimento reduzido não tratado na camada premium.');
assert(planningCss.includes('@media(prefers-reduced-motion:reduce)'), 'Movimento reduzido não tratado no planejamento.');
assert(measurementCss.includes('@media(prefers-reduced-motion:reduce)'), 'Movimento reduzido não tratado no plano de medições.');
assert(premiumRuntimeCss.includes('.ops-menu-brand'), 'Estrutura premium do menu ausente.');

for (const route of ['turn', 'history', 'more']) assert(operatorMain.includes(`'${route}'`), `Rota ausente: ${route}`);
for (const flow of ['openConference', 'openBatchClose', 'openCloseOrder', 'renderHistory', 'renderCellView']) assert(operatorMain.includes(flow), `Fluxo ausente: ${flow}`);
assert(operatorMain.includes('Fechamento manual do turno'), 'O fechamento deve ser declarado como manual.');
assert(operatorMain.includes('Última situação informada'), 'O status deve ser apresentado como informação manual.');
assert(!operatorMain.includes('progress-track'), 'Não deve existir progresso contínuo simulado.');
assert(!operatorMain.includes('Previsão ao final'), 'Não deve existir previsão automática falsa.');

assert(brandRuntime.includes('neomes-logo-horizontal.svg') && brandRuntime.includes('neomes-symbol.svg'), 'Componente oficial de marca incompleto.');
assert(brandRuntime.includes('width') && brandRuntime.includes('height') && brandRuntime.includes('draggable="false"'), 'Componente de marca sem proteção contra layout shift ou arrasto.');
assert(premiumRuntime.includes('brandHeader') && premiumRuntime.includes('brandMenuHeader') && premiumRuntime.includes('enhanceLogin'), 'Marca não integrada em cabeçalho, menu e login.');
assert(!premiumRuntime.includes('NEODENT MES') && !premiumRuntime.includes('Símbolo NEODENT'), 'Runtime ainda utiliza identidade antiga.');

for (const field of ['confOpTarget', 'confCurrentBarPieces', 'confFeederBars', 'confPieceLengthMm']) {
  assert(planningRuntime.includes(field), `Campo de planejamento ausente: ${field}`);
}
assert(planningRuntime.includes('barLengthMm: 3600'), 'Barra padrão deve ter 3600 mm.');
assert(planningRuntime.includes('kerfMm: 1'), 'Sangrador padrão deve ter 1 mm.');
assert(planningRuntime.includes('barLengthMm / (pieceLengthMm + kerfMm)'), 'Fórmula de peças por barra incorreta.');
assert(planningRuntime.includes('currentBarPieces + feederBars * piecesPerFullBar'), 'Potencial de matéria-prima incorreto.');
assert(planningRuntime.includes('Adicionar Frequência II'), 'Frequência II opcional ausente.');

assert(measurementEngine.includes('totalMeasurements'), 'Total de medições da OP ausente.');
assert(measurementEngine.includes('previousMeasurements'), 'Medições anteriores da OP ausentes.');
assert(measurementEngine.includes('measurementNumber * frequency'), 'Pontos acumulados das medições ausentes.');
assert(measurementEngine.includes('accumulatedPiece - producedSoFar'), 'Conversão para peças do turno ausente.');
assert(measurementRuntime.includes('Faça a medição'), 'Orientação direta ao operador ausente.');
assert(measurementRuntime.includes('peças no turno'), 'Gatilho em peças do turno ausente.');
assert(measurementRuntime.includes('Total da OP'), 'Resumo de medições da OP ausente.');
assert(measurementRuntime.includes('/api/v1/machine-states'), 'Plano não é compartilhado com a visão da linha.');

assert(settingsWorker.includes('CREATE TABLE IF NOT EXISTS app_settings'), 'Tabela de ajustes globais ausente.');
assert(settingsWorker.includes('barLengthMm') && settingsWorker.includes('kerfMm'), 'Ajustes de barra e sangrador ausentes.');
for (const svg of [officialLogo, officialSymbol, appIcon, maskableIcon]) {
  assert(svg.includes('<svg') && svg.includes('#AF249D'), 'Asset oficial NEOMES inválido ou com cor incorreta.');
}
assert(officialLogo.includes('NEOMES') && officialLogo.includes('fill="#fff"'), 'Logo horizontal oficial incompleta.');
assert.equal(manifest.name, 'NEOMES');
assert.equal(manifest.short_name, 'NEOMES');
assert.equal(manifest.display, 'standalone', 'PWA deve abrir em modo standalone.');
assert(String(manifest.start_url).startsWith('./') && manifest.scope === './', 'Escopo PWA deve ser relativo.');
assert(manifest.icons.some(icon => icon.src.includes('neomes-app-icon.svg') && icon.purpose === 'any'), 'Ícone principal NEOMES ausente.');
assert(manifest.icons.some(icon => icon.src.includes('neomes-app-icon-maskable.svg') && icon.purpose === 'maskable'), 'Ícone maskable NEOMES ausente.');
assert(!manifestText.includes('NEODENT MES') && !offline.includes('NEODENT MES') && !offline.includes('>NM<'), 'Identidade antiga permanece no manifesto ou modo offline.');

for (const asset of [
  './assets/brand/neomes-logo-horizontal.svg', './assets/brand/neomes-symbol.svg',
  './icons/neomes-app-icon.svg', './icons/neomes-app-icon-maskable.svg',
  './app/brand.js', './app/brand.css', './app/operator-main.js', './app/operator.css',
  './app/premium.css', './app/planning.css', './app/production-planning.js',
  './app/measurement-engine.js', './app/measurement-plan.js', './app/measurement-plan.css'
]) assert(serviceWorker.includes(asset), `Service Worker não inclui ${asset}.`);

for (const route of ['/api/v1/machine-states', '/api/v1/events', '/api/v1/records', '/api/v1/assignments', '/api/v1/settings']) {
  assert(worker.includes(route), `Rota do Worker ausente: ${route}`);
}
for (const feature of ['exportPdf', 'exportImage', 'shareSummary']) assert(exportsModule.includes(feature), `Exportação ausente: ${feature}`);
assert(core.includes('mes-operadores:v2') && core.includes('syncQueue'), 'Migração ou fila offline ausente.');

const piecesPerBar = Math.floor(3600 / (10 + 1));
assert.equal(piecesPerBar, 327);
assert.equal(25 + 3 * piecesPerBar, 1006);

console.log('Static NEOMES official branding and operational checks passed.');
