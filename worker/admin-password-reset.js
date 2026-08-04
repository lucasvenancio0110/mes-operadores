import { ensureAuthTables, authenticateRequest } from './auth.js';

const PASSWORD_ITERATIONS = 10000;
const encoder = new TextEncoder();
let schemaPromise = null;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      ...headers
    }
  });
}

function normalize(value) {
  return String(value ?? '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function requestIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

function userAgent(request) {
  return (request.headers.get('User-Agent') || '').slice(0,500);
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,'0')).join('');
}

function hexToBytes(hex) {
  return new Uint8Array((normalize(hex).match(/.{1,2}/g) || []).map(value => Number.parseInt(value,16)));
}

function randomHex(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function derivePassword(password, saltHex) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name:'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name:'PBKDF2',
    hash:'SHA-256',
    salt:hexToBytes(saltHex),
    iterations:PASSWORD_ITERATIONS
  },key,256);
  return bytesToHex(bits);
}

async function createPasswordHash(env, password) {
  const pepper = normalize(env?.NEOMES_PASSWORD_PEPPER);
  if (!pepper) throw new Error('PASSWORD_PEPPER_MISSING');
  const salt = randomHex(16);
  const protectedPassword = `${String(password || '')}\u0000${pepper}`;
  return {
    salt,
    hash:await derivePassword(protectedPassword,salt),
    iterations:PASSWORD_ITERATIONS
  };
}

function passwordProblem(password, registration = '') {
  const value = String(password || '');
  if (value.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(value) || !/\d/.test(value)) return 'A senha deve conter letras e números.';
  if (registration && value.toLowerCase().includes(String(registration).toLowerCase())) return 'A senha não pode conter a matrícula.';
  return '';
}

function generateTemporaryPassword(registration = '') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const randomPart = [...bytes].map(value => alphabet[value % alphabet.length]).join('');
    const password = `Neo-${randomPart}-7`;
    if (!passwordProblem(password,registration)) return password;
  }
  throw new Error('TEMPORARY_PASSWORD_GENERATION_FAILED');
}

async function tableColumns(env, table) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((result.results || []).map(column => String(column.name)));
}

async function addColumnWhenMissing(env, table, column, declaration) {
  const columns = await tableColumns(env,table);
  if (columns.has(column)) return;
  await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`).run();
}

async function migrateSchema(env) {
  await ensureAuthTables(env);
  await addColumnWhenMissing(env,'users','updated_by','TEXT');
  await addColumnWhenMissing(env,'users','password_iterations','INTEGER');
  await addColumnWhenMissing(env,'users','must_change_password','INTEGER NOT NULL DEFAULT 1');
  await addColumnWhenMissing(env,'users','failed_login_attempts','INTEGER NOT NULL DEFAULT 0');
  await addColumnWhenMissing(env,'users','locked_until','TEXT');
  await addColumnWhenMissing(env,'users','password_changed_at','TEXT');
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    user_name TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    description TEXT,
    previous_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  )`).run();
}

async function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = migrateSchema(env).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function hasResetPermission(auth) {
  return Boolean(auth && (
    auth.user?.roleCode === 'admin'
    || auth.permissions?.includes('users.reset_password')
  ));
}

function sameOriginAllowed(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

function safeFailure(error, stage) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Falha ao redefinir senha (${stage}):`,error);
  const messages = {
    schema:'Não foi possível preparar o banco de usuários.',
    password:'Não foi possível gerar a senha temporária com segurança.',
    persist:'Não foi possível salvar a nova senha. Nenhuma alteração foi concluída.',
    readback:'A senha foi alterada, mas não foi possível confirmar os dados do usuário.'
  };
  return json({
    error:messages[stage] || 'Não foi possível redefinir a senha.',
    code:`PASSWORD_RESET_${String(stage || 'FAILED').toUpperCase()}`,
    diagnostic:detail === 'PASSWORD_PEPPER_MISSING' ? 'Segredo criptográfico ausente.' : undefined
  },stage === 'password' && detail === 'PASSWORD_PEPPER_MISSING' ? 503 : 500);
}

export async function handleAdminPasswordReset(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/reset-password$/);
  if (!match || request.method !== 'POST') return null;

  if (!sameOriginAllowed(request)) {
    return json({ error:'Origem da requisição não autorizada.',code:'INVALID_ORIGIN' },403);
  }

  let auth;
  try {
    await ensureSchema(env);
    auth = await authenticateRequest(request,env);
  } catch (error) {
    return safeFailure(error,'schema');
  }

  if (!auth) return json({ error:'Sua sessão expirou. Entre novamente.',code:'UNAUTHENTICATED' },401);
  if (auth.user?.mustChangePassword) return json({ error:'Troque sua senha antes de administrar usuários.',code:'PASSWORD_CHANGE_REQUIRED' },403);
  if (!hasResetPermission(auth)) return json({ error:'Você não possui permissão para redefinir senhas.',code:'FORBIDDEN' },403);

  const userId = decodeURIComponent(match[1]);
  if (String(userId) === String(auth.user.id)) {
    return json({
      error:'Para alterar sua própria senha, use a opção de segurança da sua conta.',
      code:'SELF_PASSWORD_RESET_NOT_ALLOWED'
    },409);
  }

  const target = await env.DB.prepare(`SELECT
      id,name,registration,status,must_change_password AS mustChangePassword
    FROM users WHERE id=? LIMIT 1`).bind(userId).first();

  if (!target) return json({ error:'Usuário não encontrado.',code:'USER_NOT_FOUND' },404);
  if (target.status === 'inactive') {
    return json({ error:'Reative a conta antes de redefinir a senha.',code:'USER_INACTIVE' },409);
  }

  const body = await request.json().catch(() => ({}));
  const suppliedPassword = normalize(body?.password);
  const password = suppliedPassword || generateTemporaryPassword(target.registration);
  const problem = passwordProblem(password,target.registration);
  if (problem) return json({ error:problem,code:'INVALID_PASSWORD' },400);

  let credentials;
  try {
    credentials = await createPasswordHash(env,password);
  } catch (error) {
    return safeFailure(error,'password');
  }

  const now = nowIso();
  const auditId = `audit-${crypto.randomUUID()}`;
  const statements = [
    env.DB.prepare(`UPDATE users SET
      password_hash=?,password_salt=?,password_iterations=?,must_change_password=1,
      failed_login_attempts=0,locked_until=NULL,password_changed_at=?,updated_at=?,updated_by=?
      WHERE id=?`).bind(
        credentials.hash,credentials.salt,credentials.iterations,
        now,now,auth.user.id,userId
      ),
    env.DB.prepare(`UPDATE auth_sessions SET revoked_at=?
      WHERE user_id=? AND revoked_at IS NULL`).bind(now,userId),
    env.DB.prepare(`DELETE FROM auth_login_attempts
      WHERE attempt_key LIKE ?`).bind(`${String(target.registration).toLowerCase()}|%`),
    env.DB.prepare(`INSERT INTO audit_logs (
      id,user_id,user_name,action,entity_type,entity_id,description,previous_value,new_value,ip_address,user_agent,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      auditId,auth.user.id,auth.user.name,'users.reset_password','user',userId,
      'Senha temporária gerada e sessões do usuário encerradas.',
      JSON.stringify({ mustChangePassword:Boolean(target.mustChangePassword) }),
      JSON.stringify({ mustChangePassword:true,sessionsRevoked:true }),
      requestIp(request),userAgent(request),now
    )
  ];

  try {
    await env.DB.batch(statements);
  } catch (error) {
    return safeFailure(error,'persist');
  }

  try {
    const updated = await env.DB.prepare(`SELECT
      id,name,registration,role_code AS roleCode,default_shift AS defaultShift,email,status,
      must_change_password AS mustChangePassword
      FROM users WHERE id=? LIMIT 1`).bind(userId).first();
    if (!updated) throw new Error('USER_READBACK_FAILED');
    return json({
      ok:true,
      user:{ ...updated,mustChangePassword:Boolean(updated.mustChangePassword) },
      temporaryPassword:password,
      sessionsRevoked:true
    });
  } catch (error) {
    return safeFailure(error,'readback');
  }
}

export async function adminPasswordResetHealth(env) {
  await ensureSchema(env);
  const columns = await tableColumns(env,'users');
  const required = [
    'updated_by','password_iterations','must_change_password',
    'failed_login_attempts','locked_until','password_changed_at'
  ];
  const missing = required.filter(column => !columns.has(column));
  const password = generateTemporaryPassword('6674');
  const credentials = await createPasswordHash(env,password);
  return {
    ok:missing.length === 0 && /^[a-f0-9]{64}$/.test(credentials.hash),
    schemaReady:missing.length === 0,
    missingColumns:missing,
    passwordHashReady:/^[a-f0-9]{64}$/.test(credentials.hash),
    temporaryPasswordPolicy:passwordProblem(password,'6674') === '',
    transaction:'d1-batch'
  };
}
