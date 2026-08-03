import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [html, script, css, serviceWorker] = await Promise.all([
  read('index.html'),
  read('app/shift-performance.js'),
  read('app/shift-performance.css'),
  read('sw.js')
]);

assert(html.includes('app/shift-performance.css?v=3.7.2'), 'CSS do desempenho do turno não está carregado.');
assert(html.includes('app/shift-performance.js?v=3.7.2'), 'Módulo do desempenho do turno não está carregado.');
assert(serviceWorker.includes("'./app/shift-performance.css'"), 'CSS do desempenho não está no cache offline.');
assert(serviceWorker.includes("'./app/shift-performance.js'"), 'JavaScript do desempenho não está no cache offline.');

for (const required of [
  'const productiveSeconds = produced * cycle',
  'const availableSeconds = available * 60',
  'Math.max(0, availableSeconds - productiveSeconds)',
  'const targetReached = produced >= plannedTarget',
  "status: targetReached ? 'above-target' : 'below-target'",
  'productiveTimeSeconds',
  'stoppageTimeSeconds',
  'performancePercent',
  'differenceToTarget',
  "api.post('/api/v1/records', record)"
]) {
  assert(script.includes(required), `Regra do desempenho ausente: ${required}`);
}

assert(css.includes('.shift-performance-card[data-tone=success]'), 'Resultado acima da meta precisa usar estado verde.');
assert(css.includes('.shift-performance-card[data-tone=danger]'), 'Resultado abaixo da meta precisa usar estado vermelho.');
assert(css.includes('.shift-performance-card__stoppage'), 'Tempo de parada precisa ter destaque visual.');

const calculate = ({ pieces, cycleSeconds, availableMinutes, target }) => {
  const productiveSeconds = pieces * cycleSeconds;
  const availableSeconds = availableMinutes * 60;
  return {
    productiveSeconds,
    stoppageSeconds: Math.max(0, availableSeconds - productiveSeconds),
    targetReached: pieces >= target,
    status: pieces >= target ? 'above-target' : 'below-target'
  };
};

const above = calculate({ pieces: 105, cycleSeconds: 240, availableMinutes: 480, target: 100 });
assert.equal(above.productiveSeconds, 25200);
assert.equal(above.stoppageSeconds, 3600);
assert.equal(above.targetReached, true);
assert.equal(above.status, 'above-target');

const below = calculate({ pieces: 80, cycleSeconds: 240, availableMinutes: 480, target: 100 });
assert.equal(below.productiveSeconds, 19200);
assert.equal(below.stoppageSeconds, 9600);
assert.equal(below.targetReached, false);
assert.equal(below.status, 'below-target');

const overCapacity = calculate({ pieces: 130, cycleSeconds: 240, availableMinutes: 480, target: 100 });
assert.equal(overCapacity.stoppageSeconds, 0, 'Tempo de parada nunca pode ser negativo.');

console.log('Shift performance and stoppage checks passed.');
