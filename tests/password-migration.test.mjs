import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { verifyPassword } from '../worker/auth.js';

const password = 'Senha-Legada-2026';
const pepper = 'pepper-de-teste-neomes';
const salt = '00112233445566778899aabbccddeeff';
const updates = [];

const env = {
  NEOMES_PASSWORD_PEPPER: pepper,
  DB: {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              updates.push({ sql, values });
              return { success:true, meta:{ changes:1 } };
            }
          };
        }
      };
    }
  }
};

function legacyHash(iterations) {
  return pbkdf2Sync(
    password,
    Buffer.from(salt, 'hex'),
    iterations,
    32,
    'sha256'
  ).toString('hex');
}

function currentHash(passwordValue, saltHex) {
  return pbkdf2Sync(
    passwordValue + String.fromCharCode(0) + pepper,
    Buffer.from(saltHex, 'hex'),
    10000,
    32,
    'sha256'
  ).toString('hex');
}

for (const iterations of [100000, 160000]) {
  const before = updates.length;
  const user = {
    id:`legacy-${iterations}`,
    passwordHash:legacyHash(iterations),
    passwordSalt:salt,
    passwordIterations:iterations
  };

  assert.equal(
    await verifyPassword(env, password, user),
    true,
    `A senha legada de ${iterations} iterações deve ser aceita.`
  );
  assert.equal(updates.length, before + 1, 'O hash legado deve ser atualizado uma única vez.');
  assert.equal(user.passwordIterations, 10000, 'A conta deve migrar para 10.000 iterações com pepper.');
  assert.notEqual(user.passwordHash, legacyHash(iterations), 'O hash migrado deve ser diferente do legado.');
  assert.equal(
    user.passwordHash,
    currentHash(password, user.passwordSalt),
    'O hash migrado deve usar o mesmo separador nulo dos cadastros atuais.'
  );
  assert(updates.at(-1).sql.includes('WHERE id=? AND password_hash=?'), 'A migração deve usar atualização otimista.');

  assert.equal(
    await verifyPassword(env, password, user),
    true,
    'A mesma senha deve continuar válida no padrão novo.'
  );
  assert.equal(updates.length, before + 1, 'O hash atual não deve ser regravado a cada login.');
  assert.equal(
    await verifyPassword(env, 'Senha-Incorreta-2026', user),
    false,
    'Uma senha incorreta deve continuar sendo rejeitada.'
  );
}

const rejectedLegacy = {
  id:'legacy-rejected',
  passwordHash:legacyHash(160000),
  passwordSalt:salt,
  passwordIterations:160000
};
const beforeRejected = updates.length;
assert.equal(await verifyPassword(env, 'Senha-Incorreta-2026', rejectedLegacy), false);
assert.equal(updates.length, beforeRejected, 'Senha legada incorreta não pode provocar migração.');

console.log('NEOMES auth: hashes legados de 100k/160k migram para 10k com pepper no primeiro login.');
