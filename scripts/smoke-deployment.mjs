import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const deploymentUrl = String(process.argv[2] || '').replace(/\/$/, '');
assert(deploymentUrl.startsWith('https://'), 'Informe o endereço HTTPS do Worker publicado.');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function request(path, options = {}) {
  return fetch(`${deploymentUrl}${path}`, {
    redirect:'follow',
    headers:{ Accept:'application/json,text/html,*/*', ...(options.headers || {}) },
    ...options
  });
}

async function waitForJson(path, label, validate, attempts = 20) {
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(path, { cache:'no-store' });
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.ok) {
        const payload = JSON.parse(lastBody);
        validate(payload);
        console.log(`✓ ${label}`);
        return payload;
      }
    } catch (error) {
      lastBody = error instanceof Error ? error.message : String(error);
    }
    console.log(`… ${label}: tentativa ${attempt}/${attempts}, HTTP ${lastStatus || 'indisponível'}`);
    await sleep(5000);
  }
  throw new Error(`${label} falhou. HTTP ${lastStatus || 'indisponível'}: ${lastBody.slice(0, 800)}`);
}

function requireIncludes(content, tokens, label) {
  for (const token of tokens) {
    assert(content.includes(token), `${label}: conteúdo obrigatório ausente: ${token}`);
  }
}

async function fetchText(path, label) {
  const response = await request(path, { cache:'no-store' });
  const text = await response.text();
  assert(response.ok, `${label}: HTTP ${response.status}: ${text.slice(0, 500)}`);
  assert(text.length > 0, `${label}: resposta vazia.`);
  return text;
}

const health = await waitForJson('/health', 'Worker e D1', payload => {
  assert(payload.ok && payload.database, 'Health check não confirmou o banco.');
}, 12);
assert(health.database, 'D1 não confirmado.');

console.log('Aguardando propagação do Worker e dos secrets…');
await sleep(12000);

await waitForJson('/api/v1/auth/crypto-health', 'PBKDF2 com pepper', payload => {
  assert(payload.ok, payload.error || 'PBKDF2 indisponível.');
  assert.equal(payload.algorithm, 'PBKDF2-SHA256-WebCrypto-Peppered');
  assert.equal(Number(payload.iterations), 10000);
  assert(payload.pepperConfigured, 'Pepper ausente.');
});

await waitForJson('/api/v1/auth/admin-user-create-health', 'Cadastro administrativo', payload => {
  assert(payload.ok && payload.schemaReady, payload.error || 'Migração administrativa incompleta.');
  assert.equal(payload.missingColumns?.length || 0, 0);
  assert(payload.passwordHashReady, 'Hash do cadastro indisponível.');
  assert.equal(payload.transaction, 'd1-batch');
});

await waitForJson('/api/v1/auth/admin-password-reset-health', 'Redefinição de senha', payload => {
  assert(payload.ok && payload.schemaReady, payload.error || 'Redefinição indisponível.');
  assert(payload.passwordHashReady && payload.temporaryPasswordPolicy);
  assert.equal(payload.transaction, 'd1-batch');
});

await waitForJson('/api/v1/auth/turn-assistant-health', 'Assistente de turno', payload => {
  assert(payload.ok && payload.schemaReady, payload.error || 'Assistente indisponível.');
  assert.equal(payload.version, '6.0.0', 'Versão do fluxo operacional incorreta.');
  assert(payload.periodCalculationReady, 'Cálculo dos períodos indisponível.');
  assert.equal(Number(payload.rolloverMinutes), 1375, 'Virada 14:30–13:25 incorreta.');
  assert.equal(payload.pointingValidation, 'advisory-only', 'A estimativa ainda pode bloquear apontamentos.');
  assert.equal(Number(payload.shiftMinutes), 480);
  assert.equal(payload.transaction, 'd1-batch');
  assert.equal(payload.minuteLedger, 'logical-accounted-per-machine-shift', 'Relógio lógico do turno indisponível.');
  assert.deepEqual(payload.stateAxes, ['physicalStatus','opStatus','workflowStatus'], 'Estados físico, da OP e do operador não estão separados.');
  assert.equal(payload.automaticShift?.shift, '3', 'Detecção automática do terceiro turno falhou.');
  assert.equal(payload.automaticShift?.productionDate, '2026-08-05', 'Data operacional do terceiro turno incorreta.');
  assert(Array.isArray(payload.tables) && payload.tables.length === 6, 'Tabelas do turno incompletas.');
});

const localIndex = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const remoteIndex = await fetchText('/', 'Página inicial');
requireIncludes(remoteIndex, ['NEOMES — Gestão Operacional'], 'Página inicial');

const assetPattern = /(?:href|src)=["']((?:app\/)(?:auth-shell|operator|desktop-workspace|turn-assistant)[^"']*\.(?:css|js)(?:\?v=[^"']+)?)['"]/g;
const expectedAssets = [...localIndex.matchAll(assetPattern)].map(match => match[1]);
assert(expectedAssets.length >= 6, 'Não foi possível identificar os assets críticos no index local.');
for (const asset of expectedAssets) {
  assert(remoteIndex.includes(asset), `O Cloudflare não está servindo a referência atual: ${asset}`);
}
console.log(`✓ Index publicado com ${expectedAssets.length} assets críticos atuais`);

const uniqueAssets = [...new Set(expectedAssets)];
for (const asset of uniqueAssets) {
  const content = await fetchText(`/${asset}`, asset);
  if (asset.includes('turn-assistant.js')) {
    requireIncludes(content, ['Confirmar e iniciar turno', 'Peças boas produzidas', 'Minutos de parada', 'Fazer apontamento', 'Encerrar meu turno', 'bindAssistantSubmit(document,submitAssistantForm)', 'A matéria-prima consegue produzir até', 'A quantidade digitada será salva normalmente.', 'data-ta-reconfirm', 'clearLocalMachineSession', 'Meta do turno', 'LIBERAÇÕES DO TURNO', 'listMeasurementReleases', 'releaseSequenceLabel', 'A próxima liberação', 'peças produzidas neste turno.', 'pointedGoodPieces'], asset);
    assert(!content.includes('480 min ÷ ciclo'), `${asset}: a fórmula técnica da meta ainda está exposta.`);
    assert(!content.includes('peças possíveis nesta OP durante o turno.'), `${asset}: o resumo técnico antigo ainda está exposto.`);
  } else if (asset.includes('auth-shell.js')) {
    requireIncludes(content, ['operationalContext', 'O turno é identificado automaticamente', 'JSON.stringify({ registration,password })'], asset);
    assert(!content.includes('id="secureShift"'), `${asset}: seletor manual de turno ainda está no login.`);
  } else if (asset.includes('turn-assistant.css')) {
    requireIncludes(content, ['ta-material-block', 'ta-forecast-time', 'ta-submit-feedback'], asset);
  }
}
const operatorMain = await fetchText('/app/operator-main.js', 'Fluxo do operador');
requireIncludes(operatorMain, ['data-assignment-machine', 'aria-pressed', 'Confirmar ${assignmentDraft.length', 'operationalDateKey', 'Encerrar meu turno'], 'Fluxo do operador');
assert(!operatorMain.includes('assignmentStage'), 'Fluxo do operador: seleção antiga de uma máquina por vez ainda está ativa.');
const submitBridge = await fetchText('/app/turn-assistant-submit.js', 'Ponte de salvamento móvel');
requireIncludes(submitBridge, ['data-ta-submit-form', 'onSubmit(form,button)'], 'Ponte de salvamento móvel');
assert(!submitBridge.includes('SubmitEvent'), 'A versão publicada ainda sintetiza eventos de submit.');
console.log('✓ Assets críticos acessíveis e íntegros');

const engine = await fetchText('/app/turn-assistant-engine.js', 'Motor do assistente');
requireIncludes(engine, [
  'Vai fechar neste horário por falta de matéria-prima.',
  'Vai fechar por atingir a meta da OP.',
  'materialEstimatedAt',
  'continuousMinutesBetween',
  'DEFAULT_SHIFT_MINUTES = 480',
  'detectOperationalContext',
  'calculatePointingAccounting',
  "workflowStatus:'conference_pending'",
  'calculateFullShiftTarget',
  'listMeasurementReleases'
], 'Motor do assistente');
console.log('✓ Motor do assistente publicado');

for (const [path, label] of [
  ['/api/v1/auth/me', 'Sessão protegida'],
  ['/api/v1/turn-assistant/context?machineId=tnl-091&lineId=linha-05&productionDate=2026-08-05&shift=2', 'Contexto protegido'],
  ['/api/v1/turn-assistant/line-dashboard?productionDate=2026-08-05&shift=2', 'Cockpit da linha protegido']
]) {
  const response = await request(path, { cache:'no-store' });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.status, 401, `${label}: esperado HTTP 401, recebido ${response.status}.`);
  assert.equal(payload.code, 'UNAUTHENTICATED', `${label}: código de proteção incorreto.`);
  console.log(`✓ ${label}`);
}

console.log('NEOMES: deploy publicado, propagado e validado com versões dinâmicas.');
