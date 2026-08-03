import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  html, baseCss, operatorCss, premiumCss, brandCss, cloudSyncCss, manifestText,
  worker, operatorMain, premiumRuntime, brandRuntime, planningRuntime,
  measurementRuntime, measurementEngine, settingsWorker, core, exportsModule,
  serviceWorker, officialLogo, officialSymbol, appIcon, maskableIcon, offline,
  wranglerText, deployWorkflow
] = await Promise.all([
  read('index.html'), read('app/app.css'), read('app/operator.css'), read('app/premium.css'),
  read('app/brand.css'), read('app/cloud-sync.css'), read('manifest.webmanifest'),
  read('worker/main.js'), read('app/operator-main.js'), read('app/premium-runtime.js'),
  read('app/brand.js'), read('app/production-planning.js'), read('app/measurement-plan.js'),
  read('app/measurement-engine.js'), read('worker/settings.js'), read('app/core.js'),
  read('app/exports.js'), read('sw.js'), read('assets/brand/neomes-logo-horizontal.svg'),
  read('assets/brand/neomes-symbol.svg'), read('icons/neomes-app-icon.svg'),
  read('icons/neomes-app-icon-maskable.svg'), read('offline.html'), read('wrangler.jsonc'),
  read('.github/workflows/deploy-cloudflare.yml')
]);
const manifest = JSON.parse(manifestText);
const wrangler = JSON.parse(wranglerText);

// App shell, acessibilidade e publicação em subdiretório.
assert(!html.includes('maximum-scale=1'), 'O zoom do navegador não pode ser bloqueado.');
assert(html.includes('viewport-fit=cover'), 'O layout deve respeitar safe areas.');
assert(!html.includes('src="/app/') && !html.includes('href="/app/'), 'Caminhos absolutos quebram o GitHub Pages.');
assert(html.includes('<title>NEOMES — Gestão Operacional</title>'), 'Título oficial NEOMES ausente.');
assert(html.includes('v=3.7.0'), 'Versão 3.7.0 não foi publicada no ponto de entrada.');
assert(html.includes('app/cloud-sync.css'), 'Camada de sincronização discreta não foi carregada.');
assert(!html.includes('NEODENT MES'), 'Identidade antiga permanece no ponto de entrada.');

// Marca oficial: magenta, transparente e sem resíduos brancos.
for (const [name, svg] of Object.entries({ officialLogo, officialSymbol, appIcon, maskableIcon })) {
  assert(svg.includes('<svg'), `${name} não é um SVG válido.`);
  assert(svg.includes('#AF249D'), `${name} não usa o magenta oficial.`);
  assert(!/fill=["'](?:#fff(?:fff)?|white)["']/i.test(svg), `${name} ainda contém preenchimento branco residual.`);
}
assert(officialLogo.includes('NEOMES'), 'Logo horizontal oficial incompleta.');
assert(brandRuntime.includes('neomes-logo-horizontal.svg') && brandRuntime.includes('neomes-symbol.svg'), 'Componente de marca incompleto.');
assert(brandRuntime.includes('width') && brandRuntime.includes('height') && brandRuntime.includes('draggable="false"'), 'Componente sem prevenção de layout shift ou arrasto.');
assert(premiumRuntime.includes('brandHeader') && premiumRuntime.includes('brandMenuHeader') && premiumRuntime.includes('enhanceLogin'), 'Marca não integrada ao cabeçalho, menu e login.');

// Design system e responsividade real.
for (const token of ['--color-background', '--color-surface', '--color-brand']) assert(baseCss.includes(token), `Token base ausente: ${token}`);
for (const token of ['--premium-bg', '--premium-surface', '--premium-brand']) assert(premiumCss.includes(token), `Token premium ausente: ${token}`);
for (const token of ['--brand-primary:#af249d', '--header-action-size', '--page-gutter']) assert(brandCss.includes(token), `Token da marca ausente: ${token}`);
assert(brandCss.includes('object-fit:contain'), 'A logo deve preservar a proporção.');
assert(brandCss.includes('grid-template-columns:minmax(0,1fr) auto'), 'Cabeçalho não possui composição responsiva.');
assert(brandCss.includes('env(safe-area-inset-top)') && brandCss.includes('env(safe-area-inset-bottom)'), 'Safe areas incompletas.');
for (const breakpoint of ['@media(max-width:430px)', '@media(max-width:389px)', '@media(max-width:359px)', '@media(min-width:720px)', 'orientation:landscape']) {
  assert(brandCss.includes(breakpoint), `Breakpoint ausente: ${breakpoint}`);
}
assert(brandCss.includes('width:min(calc(100% - 24px),620px)'), 'Navegação inferior não possui largura responsiva controlada.');
assert(brandCss.includes('overflow-x:hidden'), 'Proteção contra rolagem horizontal ausente.');
assert(operatorCss.includes('env(safe-area-inset-bottom)'), 'Safe area inferior ausente na interface operacional.');

// Sincronização discreta: só aparece quando existe problema real.
assert(cloudSyncCss.includes('.ops-sync[data-state="synced"]'), 'Indicador sincronizado não foi ocultado.');
assert(cloudSyncCss.includes('.ops-sync[data-state="local"]'), 'Indicador local não foi ocultado.');
assert(cloudSyncCss.includes('.ops-connection[data-state="local"]'), 'Banner local permanente não foi ocultado.');
for (const state of ['offline', 'pending', 'error']) {
  assert(cloudSyncCss.includes(`.ops-connection[data-state="${state}"]`), `Aviso acionável ausente para ${state}.`);
}
assert(cloudSyncCss.includes('.ops-page-head .ops-eyebrow'), 'Rótulo explicativo da home não foi simplificado.');

// PWA e cache.
assert.equal(manifest.name, 'NEOMES');
assert.equal(manifest.short_name, 'NEOMES');
assert.equal(manifest.display, 'standalone');
assert(manifest.start_url.includes('v=3.7.0'), 'Manifesto não aponta para a versão 3.7.0.');
assert(manifest.icons.some(icon => icon.purpose === 'any'), 'Ícone principal ausente.');
assert(manifest.icons.some(icon => icon.purpose === 'maskable'), 'Ícone maskable ausente.');
assert(serviceWorker.includes("neomes-v3.7.0"), 'Cache PWA não foi renovado.');
for (const asset of [
  './assets/brand/neomes-logo-horizontal.svg', './assets/brand/neomes-symbol.svg',
  './icons/neomes-app-icon.svg', './icons/neomes-app-icon-maskable.svg',
  './app/brand.js', './app/brand.css', './app/cloud-sync.css'
]) assert(serviceWorker.includes(asset), `Service Worker não inclui ${asset}.`);
assert(!manifestText.includes('NEODENT MES') && !offline.includes('NEODENT MES') && !offline.includes('>NM<'), 'Identidade antiga permanece no PWA ou modo offline.');

// Cloudflare Workers + D1 + assets no mesmo domínio.
assert.equal(wrangler.name, 'mes-operadores');
assert.equal(wrangler.main, 'worker/main.js');
assert.equal(wrangler.workers_dev, true);
assert.equal(wrangler.assets?.directory, '.');
assert(wrangler.assets?.run_worker_first?.includes('/api/*'), 'API não está configurada para executar no Worker primeiro.');
assert(wrangler.d1_databases?.some(binding => binding.binding === 'DB' && binding.database_id === '31666c87-0970-44e1-9969-51458e7888b5'), 'Binding DB/D1 incorreto.');
assert(deployWorkflow.includes('cloudflare/wrangler-action@v3'), 'Workflow oficial de deploy ausente.');
assert(deployWorkflow.includes('CLOUDFLARE_API_TOKEN') && deployWorkflow.includes('CLOUDFLARE_ACCOUNT_ID'), 'Segredos do Cloudflare não estão configurados no workflow.');
assert(deployWorkflow.includes('/health') && deployWorkflow.includes('health.database'), 'Deploy não valida Worker e D1.');

// Fluxos operacionais preservados.
for (const route of ['turn', 'history', 'more']) assert(operatorMain.includes(`'${route}'`), `Rota ausente: ${route}`);
for (const flow of ['openConference', 'openBatchClose', 'openCloseOrder', 'renderHistory', 'renderCellView']) assert(operatorMain.includes(flow), `Fluxo ausente: ${flow}`);
assert(operatorMain.includes('Fechamento manual do turno'), 'O fechamento deve continuar manual.');
assert(operatorMain.includes('Última situação informada'), 'O status deve continuar identificado como informação manual.');
assert(!operatorMain.includes('progress-track') && !operatorMain.includes('Previsão ao final'), 'A interface não pode simular telemetria.');

// Planejamento, medições e integrações preservados.
for (const field of ['confOpTarget', 'confCurrentBarPieces', 'confFeederBars', 'confPieceLengthMm']) assert(planningRuntime.includes(field), `Campo ausente: ${field}`);
assert(planningRuntime.includes('barLengthMm: 3600') && planningRuntime.includes('kerfMm: 1'), 'Ajustes padrão de matéria-prima foram alterados.');
assert(planningRuntime.includes('barLengthMm / (pieceLengthMm + kerfMm)'), 'Fórmula de peças por barra incorreta.');
assert(planningRuntime.includes('currentBarPieces + feederBars * piecesPerFullBar'), 'Potencial de matéria-prima incorreto.');
assert(measurementEngine.includes('totalMeasurements') && measurementEngine.includes('previousMeasurements'), 'Plano total de medições ausente.');
assert(measurementRuntime.includes('Faça a medição') && measurementRuntime.includes('peças no turno'), 'Orientação de medição ausente.');
assert(measurementRuntime.includes('/api/v1/machine-states'), 'Plano não é compartilhado com a linha.');
assert(settingsWorker.includes('CREATE TABLE IF NOT EXISTS app_settings'), 'Ajustes globais ausentes.');
for (const route of ['/api/v1/machine-states', '/api/v1/events', '/api/v1/records', '/api/v1/assignments', '/api/v1/settings']) assert(worker.includes(route), `Rota do Worker ausente: ${route}`);
for (const feature of ['exportPdf', 'exportImage', 'shareSummary']) assert(exportsModule.includes(feature), `Exportação ausente: ${feature}`);
assert(core.includes('mes-operadores:v2') && core.includes('syncQueue'), 'Migração ou fila offline ausente.');

console.log('NEOMES Cloudflare, D1, sync UX and operational checks passed.');
