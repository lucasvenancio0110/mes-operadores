import { ensureAuthTables } from './auth.js';

const encoder = new TextEncoder();
const ITERATIONS = 10000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function normalize(value) {
  return String(value ?? '').trim();
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function hexToBytes(hex) {
  return new Uint8Array(
    (String(hex || '').match(/.{1,2}/g) || [])
      .map(value => Number.parseInt(value, 16))
  );
}

async function digest(value) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')))
  );
}

async function secureTokenEqual(left, right) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

async function passwordHash(env, password, salt) {
  const pepper = normalize(env?.NEOMES_PASSWORD_PEPPER);
  if (!pepper) throw new Error('NEOMES_PASSWORD_PEPPER não configurado.');
  const protectedPassword = String(password || '') + '\u0000' + pepper;
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

export async function passwordCryptoHealth(env) {
  const salt = '00112233445566778899aabbccddeeff';
  const hash = await passwordHash(env, 'NEOMES-Cloudflare-Self-Test-2026', salt);
  return {
    ok: /^[a-f0-9]{64}$/.test(hash),
    algorithm: 'PBKDF2-SHA256-WebCrypto-Peppered',
    iterations: ITERATIONS,
    pepperConfigured: Boolean(normalize(env?.NEOMES_PASSWORD_PEPPER)),
    legacyMigration: 'automatic-on-login'
  };
}

function passwordProblem(password, registration) {
  if (password.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (password.toLowerCase().includes(registration.toLowerCase())) {
    return 'A senha não pode conter a matrícula.';
  }
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/[0-9]/.test(password)) {
    return 'Use letras e números na senha.';
  }
  return '';
}

async function mirrorLegacyOperator(env, { id, name, registration, shift }) {
  try {
    const existing = await env.DB.prepare(
      'SELECT id FROM operators WHERE registration = ? ORDER BY updated_at DESC LIMIT 1'
    ).bind(registration).first();

    if (existing?.id) {
      await env.DB.prepare(`UPDATE operators
        SET name = ?, default_shift = ?, active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`)
        .bind(name, shift, existing.id)
        .run();
      return;
    }

    await env.DB.prepare(`INSERT INTO operators (
      id, name, registration, default_shift, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(`operator-${registration}`, name, registration, shift)
      .run();
  } catch (error) {
    console.warn('NEOMES bootstrap: não foi possível espelhar operators.', {
      userId: id,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function writeBootstrapAudit(env, request, { id, name }) {
  try {
    await env.DB.prepare(`INSERT INTO audit_logs (
      id, user_id, user_name, action, entity_type, entity_id,
      description, ip_address, user_agent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        `audit-${crypto.randomUUID()}`,
        id,
        name,
        'admin.bootstrap',
        'user',
        id,
        'Administrador inicial criado preservando a matrícula existente.',
        request.headers.get('CF-Connecting-IP') || '',
        (request.headers.get('User-Agent') || '').slice(0, 500),
        new Date().toISOString()
      )
      .run();
  } catch (error) {
    console.warn('NEOMES bootstrap: auditoria inicial não pôde ser gravada.', {
      userId: id,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function handleBootstrap(request, env) {
  let stage = 'preparação do banco';

  try {
    await ensureAuthTables(env);

    stage = 'validação do segredo';
    const expected = normalize(env.NEOMES_ADMIN_BOOTSTRAP_TOKEN);
    const supplied = normalize(request.headers.get('X-Bootstrap-Token'));
    if (!expected || !supplied || !(await secureTokenEqual(expected, supplied))) {
      return json({
        error: 'Inicialização administrativa indisponível.',
        code: 'BOOTSTRAP_UNAVAILABLE'
      }, 403);
    }

    stage = 'leitura dos dados';
    const body = await request.json().catch(() => null);
    const name = normalize(body?.name);
    const registration = normalize(body?.registration);
    const shift = ['1', '2', '3'].includes(normalize(body?.shift))
      ? normalize(body.shift)
      : '1';
    const password = String(body?.password || '');
    const problem = passwordProblem(password, registration);

    if (!name || !registration || problem) {
      return json({
        error: problem || 'Nome e matrícula são obrigatórios.',
        code: 'INVALID_BOOTSTRAP_DATA'
      }, 400);
    }

    stage = 'verificação de administrador existente';
    const activeAdmin = await env.DB.prepare(`SELECT
        id, name, registration, default_shift AS defaultShift
      FROM users
      WHERE role_code = 'admin' AND status = 'active'
      ORDER BY created_at
      LIMIT 1`)
      .first();

    if (activeAdmin) {
      if (String(activeAdmin.registration) === registration) {
        return json({
          ok: true,
          alreadyCreated: true,
          message: 'Este administrador já foi criado. Entre pela tela de login.',
          user: {
            id: activeAdmin.id,
            name: activeAdmin.name,
            registration: String(activeAdmin.registration),
            roleCode: 'admin',
            defaultShift: String(activeAdmin.defaultShift || shift),
            status: 'active',
            mustChangePassword: false
          }
        }, 200);
      }

      return json({
        error: 'O administrador inicial já foi criado.',
        code: 'BOOTSTRAP_ALREADY_COMPLETED'
      }, 409);
    }

    stage = 'geração segura da senha';
    const salt = randomHex(16);
    const hash = await passwordHash(env, password, salt);
    const now = new Date().toISOString();

    stage = 'localização da matrícula existente';
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE registration = ? LIMIT 1'
    ).bind(registration).first();
    const id = existing?.id || `user-${crypto.randomUUID()}`;

    stage = 'gravação do administrador';
    if (existing?.id) {
      await env.DB.prepare(`UPDATE users SET
          name = ?,
          password_hash = ?,
          password_salt = ?,
          password_iterations = ?,
          role_code = 'admin',
          default_shift = ?,
          status = 'active',
          must_change_password = 0,
          failed_login_attempts = 0,
          locked_until = NULL,
          password_changed_at = ?,
          updated_at = ?
        WHERE id = ?`)
        .bind(name, hash, salt, ITERATIONS, shift, now, now, id)
        .run();
    } else {
      await env.DB.prepare(`INSERT INTO users (
          id, name, registration, password_hash, password_salt,
          password_iterations, role_code, default_shift, status,
          must_change_password, failed_login_attempts, locked_until,
          password_changed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'admin', ?, 'active', 0, 0, NULL, ?, ?, ?)`)
        .bind(
          id,
          name,
          registration,
          hash,
          salt,
          ITERATIONS,
          shift,
          now,
          now,
          now
        )
        .run();
    }

    const user = {
      id,
      name,
      registration,
      roleCode: 'admin',
      defaultShift: shift,
      status: 'active',
      mustChangePassword: false
    };

    stage = 'compatibilidade com cadastro anterior';
    await mirrorLegacyOperator(env, { id, name, registration, shift });

    stage = 'auditoria inicial';
    await writeBootstrapAudit(env, request, { id, name });

    return json({ ok: true, user }, 201);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('NEOMES bootstrap falhou.', { stage, message: detail });

    return json({
      error: `Não foi possível concluir a ${stage}.`,
      code: 'BOOTSTRAP_FAILED',
      technicalDetail: stage === 'geração segura da senha' ? detail : undefined
    }, 500);
  }
}
