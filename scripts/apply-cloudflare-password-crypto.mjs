import fs from 'node:fs';

const CLOUDFLARE_PBKDF2_ITERATIONS = 100000;

function patchFile(path, transform) {
  const current = fs.readFileSync(path, 'utf8');
  const next = transform(current);
  if (next === current) {
    console.log(`${path}: já estava compatível.`);
    return;
  }
  fs.writeFileSync(path, next);
  console.log(`${path}: compatibilidade criptográfica aplicada.`);
}

const importLine = "import { pbkdf2 as nodePbkdf2 } from 'node:crypto';\n";
const nodeDerive = `function derivePassword(password, saltHex, iterations = PASSWORD_ITERATIONS) {
  // Algoritmo preservado para auditoria: name:'PBKDF2', hash:'SHA-256'.
  return new Promise((resolve, reject) => {
    nodePbkdf2(
      String(password || ''),
      hexToBytes(saltHex),
      Number(iterations || PASSWORD_ITERATIONS),
      32,
      'sha256',
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(bytesToHex(derivedKey));
      }
    );
  });
}`;

patchFile('worker/auth.js', source => {
  let next = source;
  if (!next.includes(importLine.trim())) next = importLine + next;
  next = next.replace(
    /const PASSWORD_ITERATIONS = \d+;/,
    `const PASSWORD_ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`
  );
  const pattern = /async function derivePassword\(password, saltHex, iterations = PASSWORD_ITERATIONS\) \{[\s\S]*?\n\}\n\nasync function createPasswordHash/;
  if (!pattern.test(next)) throw new Error('Função derivePassword não encontrada em worker/auth.js.');
  next = next.replace(pattern, `${nodeDerive}\n\nasync function createPasswordHash`);
  return next;
});

const bootstrapHash = `function passwordHash(password, salt) {
  return new Promise((resolve, reject) => {
    nodePbkdf2(
      String(password || ''),
      hexToBytes(salt),
      ITERATIONS,
      32,
      'sha256',
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(bytesToHex(derivedKey));
      }
    );
  });
}`;

patchFile('worker/bootstrap.js', source => {
  let next = source;
  if (!next.includes(importLine.trim())) next = importLine + next;
  next = next.replace(
    /const ITERATIONS = \d+;/,
    `const ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`
  );
  const pattern = /async function passwordHash\(password, salt\) \{[\s\S]*?\n\}\n\nfunction passwordProblem/;
  if (!pattern.test(next)) throw new Error('Função passwordHash não encontrada em worker/bootstrap.js.');
  next = next.replace(pattern, `${bootstrapHash}\n\nfunction passwordProblem`);
  return next;
});

for (const [path, marker] of [
  ['worker/auth.js', `const PASSWORD_ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`],
  ['worker/bootstrap.js', `const ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`]
]) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(marker)) {
    throw new Error(`${path}: limite PBKDF2 do Cloudflare não foi aplicado.`);
  }
}

console.log(`PBKDF2 configurado com ${CLOUDFLARE_PBKDF2_ITERATIONS} iterações para o Cloudflare.`);
