import fs from 'node:fs';

const auth = fs.readFileSync('worker/auth.js', 'utf8');
const bootstrap = fs.readFileSync('worker/bootstrap.js', 'utf8');

function requireToken(source, token, label) {
  if (!source.includes(token)) {
    throw new Error(`${label}: conteúdo obrigatório ausente: ${token}`);
  }
}

for (const token of [
  'const PASSWORD_ITERATIONS = 10000;',
  'const LEGACY_PASSWORD_ITERATIONS = new Set([100000, 160000]);',
  'NEOMES_PASSWORD_PEPPER',
  'migrateLegacyPasswordHash',
  'export async function verifyPassword(env, password, user)',
  'await createPasswordHash(env, password)',
  'await verifyPassword(env, password,user)'
]) {
  requireToken(auth, token, 'worker/auth.js');
}

for (const token of [
  'const ITERATIONS = 10000;',
  'NEOMES_PASSWORD_PEPPER',
  'passwordCryptoHealth(env)',
  "legacyMigration: 'automatic-on-login'"
]) {
  requireToken(bootstrap, token, 'worker/bootstrap.js');
}

if (auth.includes('async function createPasswordHash(password)')) {
  throw new Error('worker/auth.js ainda contém geração de hash sem o pepper do ambiente.');
}
if (auth.includes('async function verifyPassword(password, user)')) {
  throw new Error('worker/auth.js ainda contém verificação incompatível com o ambiente.');
}
if (bootstrap.includes('async function passwordHash(password, salt)')) {
  throw new Error('worker/bootstrap.js ainda contém hash sem o pepper do ambiente.');
}

console.log('Senha NEOMES: código-fonte validado com pepper e migração automática de hashes legados.');
