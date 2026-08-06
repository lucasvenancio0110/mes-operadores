import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  html, manifestText, wranglerText, serviceWorker, deployWorkflow, smokeDeployment,
  authWorker, secureMain, authShell, adminUi, authCss, adminCss,
  worker, operatorMain, core, turnAssistant, turnAssistantEngine, planningRuntime, measurementEngine,
  measurementFrequencyParser, measurementFrequencyFix, shiftPerformance,
  shiftTimeEngine, shiftTimeFix, exportsModule, settingsWorker,
  officialLogo, officialSymbol, offline
] = await Promise.all([
  read('index.html'), read('manifest.webmanifest'), read('wrangler.jsonc'), read('sw.js'),
  read('.github/workflows/deploy-cloudflare.yml'), read('scripts/smoke-deployment.mjs'),
  read('worker/auth.js'), read('worker/secure-main.js'),
  read('app/auth-shell.js'), read('app/admin-ui.js'), read('app/auth.css'), read('app/admin.css'),
  read('worker/main.js'), read('app/operator-main.js'), read('app/core.js'),
  read('app/turn-assistant.js'), read('app/turn-assistant-engine.js'), read('app/production-planning.js'), read('app/measurement-engine.js'),
  read('app/measurement-frequency-parser.js'), read('app/measurement-frequency-fix.js'),
  read('app/shift-performance.js'), read('app/shift-time-engine.js'), read('app/shift-time-fix.js'),
  read('app/exports.js'), read('worker/settings.js'), read('assets/brand/neomes-logo-horizontal.svg'),
  read('assets/brand/neomes-symbol.svg'), read('offline.html')
]);

const manifest = JSON.parse(manifestText);
const wrangler = JSON.parse(wranglerText);

// Entrada, marca e PWA.
assert(!html.includes('maximum-scale=1'), 'O zoom do navegador não pode ser bloqueado.');
assert(html.includes('viewport-fit=cover'), 'O layout deve respeitar safe areas.');
assert(html.includes('<title>NEOMES — Gestão Operacional</title>'), 'Título oficial NEOMES ausente.');
assert(html.includes('app/auth-shell.js?v=6.0.0'), 'Entrada segura 6.0.0 não foi publicada.');
assert(html.includes('app/auth.css?v=6.0.0') && html.includes('app/admin.css?v=4.0.0'), 'Estilos de autenticação ou administração ausentes.');
assert(!html.includes('NEODENT MES'), 'Identidade antiga permanece no ponto de entrada.');
assert.equal(manifest.name, 'NEOMES');
assert.equal(manifest.short_name, 'NEOMES');
assert.equal(manifest.display, 'standalone');
assert(manifest.start_url.includes('v=6.0.0'), 'Manifesto não aponta para o fluxo operacional 6.0.0.');
assert(serviceWorker.includes('neomes-v6.0.0-operator-flow'), 'Cache PWA 6.0.0 não foi ativado.');
for (const asset of ['./app/auth-shell.js','./app/auth.css','./app/admin-ui.js','./app/admin.css','./app/operator-main.js','./app/shift-performance.js']) {
  assert(serviceWorker.includes(asset), `Service Worker não inclui ${asset}.`);
}
assert(officialLogo.includes('#AF249D') && officialSymbol.includes('#AF249D'), 'Marca oficial NEOMES foi alterada.');
assert(!offline.includes('NEODENT MES'), 'Identidade antiga permanece no modo offline.');

// Cloudflare e deploy.
assert.equal(wrangler.name, 'mes-operadores');
assert.equal(wrangler.main, 'worker/secure-main.js');
assert.equal(wrangler.workers_dev, true);
assert(wrangler.assets?.run_worker_first?.includes('/api/*'), 'API não executa no Worker primeiro.');
assert(wrangler.d1_databases?.some(binding => binding.binding === 'DB' && binding.database_id === '31666c87-0970-44e1-9969-51458e7888b5'), 'Binding DB/D1 incorreto.');
assert(deployWorkflow.includes('CLOUDFLARE_API_TOKEN') && deployWorkflow.includes('CLOUDFLARE_ACCOUNT_ID'), 'Segredos do Cloudflare ausentes no workflow.');
assert(deployWorkflow.includes('scripts/smoke-deployment.mjs'), 'Workflow não executa o smoke test publicado.');
assert(deployWorkflow.includes('tests/password-migration.test.mjs'), 'Workflow não testa a migração de hashes legados.');
assert(smokeDeployment.includes("waitForJson('/health'") && smokeDeployment.includes('payload.database'), 'Deploy não valida Worker e D1.');
assert(smokeDeployment.includes('/api/v1/auth/turn-assistant-health') && smokeDeployment.includes('minuteLedger') && smokeDeployment.includes('stateAxes'), 'Deploy não valida o assistente de turno v6.');

// Senhas, sessões e autenticação.
for (const required of [
  "name:'PBKDF2'", "hash:'SHA-256'", 'password_hash TEXT', 'password_salt TEXT',
  'token_hash TEXT', 'auth_sessions', 'audit_logs', 'auth_login_attempts',
  'HttpOnly', 'Secure', 'SameSite=Lax', 'MAX_LOGIN_ATTEMPTS = 5',
  'NEOMES_ADMIN_BOOTSTRAP_TOKEN', 'NEOMES_PASSWORD_PEPPER',
  'LEGACY_PASSWORD_ITERATIONS', 'PASSWORD_HASH_SCHEME', 'migrateLegacyPasswordHash',
  'export async function verifyPassword(env, password, user)',
  'É necessário manter pelo menos um administrador ativo no sistema.'
]) assert(authWorker.includes(required), `Proteção de autenticação ausente: ${required}`);
assert(!authWorker.includes('MD5') && !authWorker.includes("SHA-1'"), 'Algoritmo inseguro encontrado.');
assert(authWorker.includes('/api/v1/auth/login') && authWorker.includes('/api/v1/auth/me') && authWorker.includes('/api/v1/auth/logout'), 'Rotas básicas de autenticação ausentes.');
assert(authWorker.includes('/api/v1/auth/change-password'), 'Troca segura de senha ausente.');
assert(authWorker.includes('users.reset_password') && authWorker.includes('sessions.manage') && authWorker.includes('audit.view'), 'Permissões administrativas incompletas.');
assert(secureMain.includes("url.pathname.startsWith('/api/')") && secureMain.includes('authenticateRequest'), 'API operacional não está protegida.');
assert(secureMain.includes('recordBelongsToUser') && secureMain.includes('canAccessMachine'), 'Restrição por usuário, linha ou máquina ausente.');

// Front-end seguro e administração.
assert(authShell.includes('/api/v1/auth/login') && authShell.includes('/api/v1/auth/me'), 'Cliente não valida a sessão no servidor.');
assert(authShell.includes('JSON.stringify({ registration,password })') && authShell.includes('operationalContext'), 'Login não usa matrícula, senha e turno automático.');
assert(!authShell.includes('id="secureShift"'), 'Login ainda permite escolher o turno manualmente.');
assert(authShell.includes('current-password') && authShell.includes('new-password'), 'Autocompletes seguros de senha ausentes.');
assert(authShell.includes('offlineUntil') && authShell.includes("!navigator.onLine"), 'Credencial offline limitada ausente.');
assert(!/localStorage\.setItem\([^\n]*password/i.test(authShell), 'Senha não pode ser gravada no localStorage.');
assert(authCss.includes('env(safe-area-inset-top)') && authCss.includes('env(safe-area-inset-bottom)'), 'Login não respeita safe areas.');
for (const route of ['/api/v1/admin/users','/api/v1/admin/roles','/api/v1/admin/sessions','/api/v1/admin/audit']) assert(adminUi.includes(route), `Painel não usa ${route}.`);
for (const action of ['reset-password','revoke-sessions','block','unblock','disable','enable']) assert(adminUi.includes(action), `Ação administrativa ausente: ${action}`);
assert(adminUi.includes('Senha temporária') && adminUi.includes('mostrada somente agora'), 'Senha temporária não possui exibição única.');
assert(adminCss.includes('@media(min-width:760px)') && adminCss.includes('@media(max-width:390px)'), 'Painel administrativo não é responsivo.');

// Fluxos operacionais preservados.
for (const route of ['turn','history','more']) assert(operatorMain.includes(`'${route}'`), `Rota operacional ausente: ${route}`);
for (const flow of ['openConference','openBatchClose','openCloseOrder','renderHistory','renderCellView']) assert(operatorMain.includes(flow), `Fluxo operacional ausente: ${flow}`);
assert(operatorMain.includes('Encerrar meu turno'), 'O fechamento do turno deve continuar explícito e manual.');
assert(operatorMain.includes('data-assignment-machine') && operatorMain.includes('aria-pressed'), 'Seleção múltipla de máquinas ausente.');
assert(!operatorMain.includes('assignmentStage'), 'Fluxo antigo de seleção máquina por máquina permanece ativo.');
assert(core.includes('detectFactoryOperationalContext') && core.includes('session.productionDate'), 'Turno e data operacional automáticos ausentes.');
assert(turnAssistant.includes('taPointingForm') && turnAssistant.includes('pointedGoodPieces'), 'Apontamento consultivo v6 ausente.');
assert(turnAssistant.includes('A quantidade digitada será salva normalmente.'), 'Quantidade ainda pode ser tratada como bloqueio.');
assert(turnAssistantEngine.includes('calculatePointingAccounting') && turnAssistantEngine.includes('advisory:overrunMinutes > 0'), 'Cálculo consultivo do apontamento ausente.');
assert(operatorMain.includes('Última situação informada'), 'A situação deve continuar identificada como informação manual.');
assert(core.includes('syncQueue') && core.includes('mes-operadores:v2'), 'Fila offline ou migração anterior foi removida.');

// Planejamento, medições, tempo e exportações preservados.
for (const field of ['confOpTarget','confCurrentBarPieces','confFeederBars','confPieceLengthMm']) assert(planningRuntime.includes(field), `Campo ausente: ${field}`);
assert(planningRuntime.includes('barLengthMm: 3600') && planningRuntime.includes('kerfMm: 1'), 'Padrões da matéria-prima foram alterados.');
assert(planningRuntime.includes('barLengthMm / (pieceLengthMm + kerfMm)'), 'Fórmula de peças por barra incorreta.');
assert(measurementEngine.includes('totalMeasurements - previousMeasurements - measurementsThisShift'), 'Depois do turno não fecha o total de medições.');
assert(measurementFrequencyParser.includes('parseFrequencyPair'), 'Compatibilidade com dados antigos de frequência foi removida.');
assert(measurementFrequencyFix.includes('Adicionar segunda frequência'), 'Frequência II opcional foi removida.');
assert(shiftTimeEngine.includes('FULL_SHIFT_MINUTES = 480') && shiftTimeEngine.includes('cycle / 60'), 'Cálculo do turno ou fração do ciclo incorreto.');
assert(shiftTimeFix.includes('availableMinutes: FULL_SHIFT_MINUTES'), 'Conferência ainda pode usar minutos restantes.');
assert(shiftPerformance.includes('stoppageSeconds') && shiftPerformance.includes('targetReached'), 'Tempo de parada ou comparação com a meta ausente.');
for (const feature of ['exportPdf','exportImage','shareSummary']) assert(exportsModule.includes(feature), `Exportação ausente: ${feature}`);
assert(settingsWorker.includes('CREATE TABLE IF NOT EXISTS app_settings'), 'Ajustes globais ausentes.');
for (const route of ['/api/v1/machine-states','/api/v1/events','/api/v1/records','/api/v1/assignments','/api/v1/settings']) assert(worker.includes(route), `Rota operacional ausente: ${route}`);

console.log('NEOMES 6.0.0: autenticação segura, turno automático e fluxo consultivo validados.');
