import fs from 'node:fs';

const CLOUDFLARE_PBKDF2_ITERATIONS = 100000;

function patchFile(path, replacements) {
  let source = fs.readFileSync(path, 'utf8');

  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(source)) {
      throw new Error(`${path}: padrão criptográfico não encontrado.`);
    }
    source = source.replace(pattern, replacement);
  }

  if (!source.includes("crypto.subtle.importKey") || !source.includes("crypto.subtle.deriveBits")) {
    throw new Error(`${path}: Web Crypto PBKDF2 não está presente.`);
  }

  fs.writeFileSync(path, source);
  console.log(`${path}: PBKDF2 Web Crypto configurado com ${CLOUDFLARE_PBKDF2_ITERATIONS} iterações.`);
}

patchFile('worker/auth.js', [
  [/const PASSWORD_ITERATIONS = \d+;/, `const PASSWORD_ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`]
]);

patchFile('worker/bootstrap.js', [
  [/const ITERATIONS = \d+;/, `const ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`]
]);

console.log('Compatibilidade de senha do Cloudflare: Web Crypto PBKDF2 SHA-256.');
