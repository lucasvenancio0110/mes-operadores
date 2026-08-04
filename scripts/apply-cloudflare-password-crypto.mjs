import fs from 'node:fs';

const CLOUDFLARE_PBKDF2_ITERATIONS = 10000;
const PEPPER_BINDING = 'NEOMES_PASSWORD_PEPPER';

function requireReplace(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Padrão não encontrado: ${label}`);
  return source.replace(pattern, replacement);
}

function writePatched(path, transform) {
  const current = fs.readFileSync(path, 'utf8');
  const next = transform(current);
  if (!next.includes('crypto.subtle.importKey') || !next.includes('crypto.subtle.deriveBits')) {
    throw new Error(`${path}: Web Crypto PBKDF2 ausente.`);
  }
  if (!next.includes(PEPPER_BINDING)) {
    throw new Error(`${path}: pepper do servidor ausente.`);
  }
  fs.writeFileSync(path, next);
  console.log(`${path}: PBKDF2 Web Crypto com pepper configurado.`);
}

writePatched('worker/auth.js', source => {
  let next = requireReplace(
    source,
    /const PASSWORD_ITERATIONS = \d+;/,
    `const PASSWORD_ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`,
    'PASSWORD_ITERATIONS'
  );

  next = requireReplace(
    next,
    /async function createPasswordHash\(password\) \{[\s\S]*?\n\}/,
    `async function createPasswordHash(env, password) {
  const pepper = normalize(env?.${PEPPER_BINDING});
  if (!pepper) throw new Error('${PEPPER_BINDING} não configurado.');
  const salt = randomHex(16);
  const protectedPassword = String(password || '') + '\\u0000' + pepper;
  return {
    salt,
    hash:await derivePassword(protectedPassword, salt),
    iterations:PASSWORD_ITERATIONS
  };
}`,
    'createPasswordHash'
  );

  next = requireReplace(
    next,
    /async function verifyPassword\(password, user\) \{[\s\S]*?\n\}/,
    `async function verifyPassword(env, password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const pepper = normalize(env?.${PEPPER_BINDING});
  if (!pepper) throw new Error('${PEPPER_BINDING} não configurado.');
  const protectedPassword = String(password || '') + '\\u0000' + pepper;
  const derived = await derivePassword(
    protectedPassword,
    user.passwordSalt,
    Number(user.passwordIterations || PASSWORD_ITERATIONS)
  );
  return constantTimeEqual(hexToBytes(derived), hexToBytes(user.passwordHash));
}`,
    'verifyPassword'
  );

  next = next.replace(/await createPasswordHash\(/g, 'await createPasswordHash(env, ');
  next = next.replace(/await verifyPassword\(/g, 'await verifyPassword(env, ');

  if (!next.includes(`const PASSWORD_ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`)) {
    throw new Error('Limite de iterações não aplicado em auth.js.');
  }
  return next;
});

writePatched('worker/bootstrap.js', source => {
  let next = requireReplace(
    source,
    /const ITERATIONS = \d+;/,
    `const ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`,
    'ITERATIONS'
  );

  next = requireReplace(
    next,
    /async function passwordHash\(password, salt\) \{[\s\S]*?\n\}\n\nexport async function passwordCryptoHealth/,
    `async function passwordHash(env, password, salt) {
  const pepper = normalize(env?.${PEPPER_BINDING});
  if (!pepper) throw new Error('${PEPPER_BINDING} não configurado.');
  const protectedPassword = String(password || '') + '\\u0000' + pepper;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(protectedPassword),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(salt),
      iterations: ITERATIONS
    },
    key,
    256
  );
  return bytesToHex(bits);
}

export async function passwordCryptoHealth`,
    'passwordHash'
  );

  next = requireReplace(
    next,
    /export async function passwordCryptoHealth\(\) \{[\s\S]*?\n\}/,
    `export async function passwordCryptoHealth(env) {
  const salt = '00112233445566778899aabbccddeeff';
  const hash = await passwordHash(env, 'NEOMES-Cloudflare-Self-Test-2026', salt);
  return {
    ok: /^[a-f0-9]{64}$/.test(hash),
    algorithm: 'PBKDF2-SHA256-WebCrypto-Peppered',
    iterations: ITERATIONS,
    pepperConfigured: Boolean(normalize(env?.${PEPPER_BINDING}))
  };
}`,
    'passwordCryptoHealth'
  );

  next = requireReplace(
    next,
    /const hash = await passwordHash\(password, salt\);/,
    'const hash = await passwordHash(env, password, salt);',
    'bootstrap passwordHash call'
  );

  if (!next.includes(`const ITERATIONS = ${CLOUDFLARE_PBKDF2_ITERATIONS};`)) {
    throw new Error('Limite de iterações não aplicado em bootstrap.js.');
  }
  return next;
});

console.log(`Senha NEOMES: PBKDF2-SHA256, ${CLOUDFLARE_PBKDF2_ITERATIONS} iterações, salt e pepper secreto.`);
