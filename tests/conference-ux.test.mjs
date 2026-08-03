import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, script, css, serviceWorker] = await Promise.all([
  read('index.html'),
  read('app/conference-ux.js'),
  read('app/conference-ux.css'),
  read('sw.js')
]);

assert(html.includes('conference-ux.css?v=3.5.0'), 'Estilo da conferência compacta não está carregado.');
assert(html.includes('conference-ux.js?v=3.5.0'), 'Módulo da conferência compacta não está carregado.');
assert(serviceWorker.includes("'./app/conference-ux.css'"), 'CSS da conferência não está no cache offline.');
assert(serviceWorker.includes("'./app/conference-ux.js'"), 'JavaScript da conferência não está no cache offline.');

for (const feature of [
  'Produção atual na máquina',
  'Dados herdados do turno anterior',
  'Corrigir dados da OP',
  'Atualize apenas o que muda no turno',
  'data-step-value',
  'conference-stepper',
  'conference-status-buttons',
  'Ver detalhes do plano',
  'reconciledProduction'
]) {
  assert(script.includes(feature), `Funcionalidade da conferência ausente: ${feature}`);
}

assert(script.includes("['null', 'undefined', 'nan']"), 'Valores nulos de Frequência II devem ser normalizados.');
assert(script.includes("input.readOnly = true"), 'Quantidade de barras deve usar controle de menos/mais.');
assert(script.includes("event.target.id === 'confReconciledProduction'"), 'Reconciliação da produção não atualiza os cálculos.');
assert(script.includes("reason === 'conference-save'"), 'Reconciliação não está ligada ao salvamento da conferência.');
assert(script.includes("state.sharedMachineStates"), 'Continuidade não consulta o estado compartilhado da máquina.');

for (const selector of [
  '.conference-fields-grid',
  '.conference-live-grid',
  '.conference-stepper',
  '.conference-status-buttons',
  '.conference-planning-compact',
  '.conference-measurements-compact'
]) {
  assert(css.includes(selector), `Estilo ausente: ${selector}`);
}

assert(css.includes('env(safe-area-inset-bottom)'), 'Ações da conferência devem respeitar a safe area.');
assert(css.includes('@media (max-width: 370px)'), 'Layout compacto precisa tratar telas pequenas.');
assert(!script.includes('contador automático'), 'A conferência não deve simular produção automática.');

console.log('Compact conference UX checks passed.');
