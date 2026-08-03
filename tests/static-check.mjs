import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  html, css, operatorCss, premiumCss, premiumRuntimeCss, planningCss, measurementCss,
  manifestText, worker, operatorMain, premiumRuntime, planningRuntime, measurementRuntime,
  measurementEngine, settingsWorker, core, exportsModule, serviceWorker, brandMark, appIcon
] = await Promise.all([
  read('index.html'), read('app/app.css'), read('app/operator.css'), read('app/premium.css'),
  read('app/premium-runtime.css'), read('app/planning.css'), read('app/measurement-plan.css'),
  read('manifest.webmanifest'), read('worker/main.js'), read('app/operator-main.js'),
  read('app/premium-runtime.js'), read('app/production-planning.js'), read('app/measurement-plan.js'),
  read('app/measurement-engine.js'), read('worker/settings.js'), read('app/core.js'),
  read('app/exports.js'), read('sw.js'), read('icons/neomes-mark.svg'), read('icons/mes-icon.svg')
]);
const manifest = JSON.parse(manifestText);

assert(!html.includes('maximum-scale=1'), 'O zoom do navegador não pode ser bloqueado.');
assert(html.includes('viewport-fit=cover'), 'O layout deve respeitar safe areas.');
for (const asset of ['manifest.webmanifest', 'operator-main.js', 'operator.css', 'premium.css', 'premium-runtime.js', 'production-planning.js', 'planning.css', 'measurement-plan.js', 'measurement-plan.css']) {
  assert(html.includes(asset), `Arquivo não ligado ao HTML: ${asset}`);
}
assert(!html.includes('app/main.js'), 'A interface antiga não deve continuar carregada.');
assert(!html.includes('app/runtime.js'), 'A camada corretiva antiga não deve continuar carregada.');
assert(!html.includes('src="/app/') && !html.includes('href="/app/'), 'Caminhos absolutos quebram o GitHub Pages.');

for (const token of ['--color-background', '--color-surface', '--color-brand', '--color-success', '--color-warning', '--color-danger']) {
  assert(css.includes(token), `Token base ausente: ${token}`);
}
for (const token of ['--premium-bg', '--premium-surface', '--premium-brand', '--premium-radius-l', '--premium-shadow-2']) {
  assert(premiumCss.includes(token), `Token premium ausente: ${token}`);
}
assert(operatorCss.includes('env(safe-area-inset-bottom)'), 'Safe area inferior ausente.');
assert(premiumCss.includes('@media(prefers-reduced-motion:reduce)'), 'Movimento reduzido não tratado na camada premium.');
assert(planningCss.includes('@media(prefers-reduced-motion:reduce)'), 'Movimento reduzido não tratado no planejamento.');
assert(measurementCss.includes('@media(prefers-reduced-motion:reduce)'), 'Movimento reduzido não tratado no plano de medições.');
assert(premiumRuntimeCss.includes('.ops-menu-brand'), 'Branding premium do menu ausente.');

for (const route of ['turn', 'history', 'more']) assert(operatorMain.includes(`'${route}'`), `Rota ausente: ${route}`);
for (const flow of ['openConference', 'openBatchClose', 'openCloseOrder', 'renderHistory', 'renderCellView']) assert(operatorMain.includes(flow), `Fluxo ausente: ${flow}`);
assert(operatorMain.includes('Fechamento manual do turno'), 'O fechamento deve ser declarado como manual.');
assert(operatorMain.includes('Última situação informada'), 'O status deve ser apresentado como informação manual.');
assert(!operatorMain.includes('progress-track'), 'Não deve existir progresso contínuo simulado.');
assert(!operatorMain.includes('Previsão ao final'), 'Não deve existir previsão automática falsa.');
assert(premiumRuntime.includes('Apontamento manual') && premiumRuntime.includes('NeoMES'), 'Identidade manual/premium incompleta.');

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
assert(brandMark.includes('<svg') && appIcon.includes('<svg'), 'Marca ou ícone inválido.');
assert.equal(manifest.display, 'standalone', 'PWA deve abrir em modo standalone.');
assert(String(manifest.start_url).startsWith('./') && manifest.scope === './', 'Escopo PWA deve ser relativo.');

for (const asset of [
  './app/operator-main.js', './app/operator.css', './app/premium.css', './app/planning.css',
  './app/production-planning.js', './app/measurement-engine.js', './app/measurement-plan.js',
  './app/measurement-plan.css', './icons/neomes-mark.svg'
]) assert(serviceWorker.includes(asset), `Service Worker não inclui ${asset}.`);

for (const route of ['/api/v1/machine-states', '/api/v1/events', '/api/v1/records', '/api/v1/assignments', '/api/v1/settings']) {
  assert(worker.includes(route), `Rota do Worker ausente: ${route}`);
}
for (const feature of ['exportPdf', 'exportImage', 'shareSummary']) assert(exportsModule.includes(feature), `Exportação ausente: ${feature}`);
assert(core.includes('mes-operadores:v2') && core.includes('syncQueue'), 'Migração ou fila offline ausente.');

const piecesPerBar = Math.floor(3600 / (10 + 1));
assert.equal(piecesPerBar, 327);
assert.equal(25 + 3 * piecesPerBar, 1006);

console.log('Static premium measurement planning checks passed.');
