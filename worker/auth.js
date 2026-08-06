import { detectOperationalContext } from '../app/turn-assistant-engine.js';

const COOKIE_NAME = 'neomes_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PASSWORD_ITERATIONS = 10000;
const LEGACY_PASSWORD_ITERATIONS = new Set([100000, 160000]);
const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256-peppered-v1';
const MAX_LOGIN_ATTEMPTS = 5;
const encoder = new TextEncoder();
let readyPromise = null;

const ROLE_SEEDS = [
  ['admin', 'Administrador', 'Acesso administrativo completo.', 1],
  ['leadership', 'Liderança', 'Gestão e consulta das linhas autorizadas.', 1],
  ['preparator', 'Preparador', 'Acompanhamento operacional e preparação.', 1],
  ['operator', 'Operador', 'Conferência e apontamento das máquinas vinculadas.', 1],
  ['technical', 'Técnico', 'Atuação técnica e manutenção.', 1]
];

const PERMISSION_SEEDS = [
  ['users.view', 'users', 'Visualizar usuários'],
  ['users.create', 'users', 'Criar usuários'],
  ['users.edit', 'users', 'Editar usuários'],
  ['users.disable', 'users', 'Ativar, desativar, bloquear e desbloquear usuários'],
  ['users.reset_password', 'users', 'Redefinir senhas'],
  ['users.manage_roles', 'users', 'Gerenciar perfis e permissões'],
  ['machines.view', 'machines', 'Visualizar máquinas'],
  ['machines.assign', 'machines', 'Vincular máquinas ao turno'],
  ['machines.update_status', 'machines', 'Atualizar situação operacional'],
  ['conference.create', 'conference', 'Realizar conferência'],
  ['conference.edit', 'conference', 'Editar conferência'],
  ['conference.view_all', 'conference', 'Visualizar conferências autorizadas'],
  ['production.create', 'production', 'Registrar produção'],
  ['production.edit', 'production', 'Corrigir produção'],
  ['production.close_shift', 'production', 'Fechar turno'],
  ['production.view_all', 'production', 'Visualizar produção autorizada'],
  ['settings.view', 'settings', 'Visualizar configurações'],
  ['settings.edit', 'settings', 'Editar configurações'],
  ['reports.view', 'reports', 'Visualizar relatórios'],
  ['reports.export', 'reports', 'Exportar relatórios'],
  ['audit.view', 'audit', 'Visualizar auditoria'],
  ['sessions.manage', 'sessions', 'Gerenciar sessões']
];

const ROLE_PERMISSIONS = {
  admin: PERMISSION_SEEDS.map(([code]) => code),
  leadership: ['machines.view','machines.assign','machines.update_status','conference.view_all','production.view_all','production.edit','settings.view','reports.view','reports.export','audit.view'],
  preparator: ['machines.view','machines.assign','machines.update_status','conference.view_all','production.view_all','settings.view','reports.view','reports.export'],
  operator: ['machines.view','machines.assign','machines.update_status','conference.create','conference.edit','production.create','production.close_shift','reports.view'],
  technical: ['machines.view','machines.update_status','conference.view_all','production.view_all','reports.view']
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers }
  });
}

function nowIso() { return new Date().toISOString(); }
function normalize(value) { return String(value ?? '').trim(); }
function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(hex) { return new Uint8Array((normalize(hex).match(/.{1,2}/g) || []).map(byte => Number.parseInt(byte, 16))); }
function randomHex(length = 32) { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return bytesToHex(bytes); }
function constantTimeEqual(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value));
}

async function derivePassword(password, saltHex, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt:hexToBytes(saltHex), iterations }, key, 256);
  return bytesToHex(bits);
}

export async function createPasswordHash(env, password) {
  const pepper = normalize(env?.NEOMES_PASSWORD_PEPPER);
  if (!pepper) throw new Error('NEOMES_PASSWORD_PEPPER não configurado.');
  const salt = randomHex(16);
  const protectedPassword = String(password || '') + '\u0000' + pepper;
  return {
    salt,
    hash:await derivePassword(protectedPassword, salt),
    iterations:PASSWORD_ITERATIONS,
    scheme:PASSWORD_HASH_SCHEME
  };
}

async function migrateLegacyPasswordHash(env, password, user) {
  const originalHash = user.passwordHash;
  const originalIterations = Number(user.passwordIterations || 0);
  const upgraded = await createPasswordHash(env, password);
  await env.DB.prepare(
    'UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,updated_at=? WHERE id=? AND password_hash=?'
  ).bind(
    upgraded.hash,
    upgraded.salt,
    upgraded.iterations,
    nowIso(),
    user.id,
    originalHash
  ).run();
  user.passwordHash = upgraded.hash;
  user.passwordSalt = upgraded.salt;
  user.passwordIterations = upgraded.iterations;
  console.info('NEOMES auth: hash legado migrado.', {
    userId:user.id,
    fromIterations:originalIterations,
    toIterations:upgraded.iterations,
    scheme:upgraded.scheme
  });
}

export async function verifyPassword(env, password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const iterations = Number(user.passwordIterations || PASSWORD_ITERATIONS);

  if (LEGACY_PASSWORD_ITERATIONS.has(iterations)) {
    const legacyDerived = await derivePassword(
      String(password || ''),
      user.passwordSalt,
      iterations
    );
    const legacyValid = constantTimeEqual(
      hexToBytes(legacyDerived),
      hexToBytes(user.passwordHash)
    );
    if (!legacyValid) return false;
    await migrateLegacyPasswordHash(env, password, user);
    return true;
  }

  const pepper = normalize(env?.NEOMES_PASSWORD_PEPPER);
  if (!pepper) throw new Error('NEOMES_PASSWORD_PEPPER não configurado.');
  const protectedPassword = String(password || '') + '\u0000' + pepper;
  const derived = await derivePassword(
    protectedPassword,
    user.passwordSalt,
    iterations
  );
  return constantTimeEqual(hexToBytes(derived), hexToBytes(user.passwordHash));
}

function parseCookies(request) {
  const result = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return result;
}

function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function requestIp(request) { return request.headers.get('CF-Connecting-IP') || ''; }
function userAgent(request) { return (request.headers.get('User-Agent') || '').slice(0, 500); }
function deviceName(request) {
  const agent = userAgent(request);
  if (/iphone|ipad/i.test(agent)) return 'iPhone/iPad';
  if (/android/i.test(agent)) return 'Android';
  if (/windows/i.test(agent)) return 'Windows';
  if (/macintosh/i.test(agent)) return 'Mac';
  return 'Navegador';
}

function passwordProblem(password, registration = '') {
  const value = String(password || '');
  if (value.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (registration && value.toLowerCase().includes(String(registration).toLowerCase())) return 'A senha não pode conter a matrícula.';
  if (!/[A-Za-zÀ-ÿ]/.test(value) || !/\d/.test(value)) return 'Use letras e números na senha.';
  return '';
}

async function initialize(env) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS roles (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', is_system_role INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS permissions (
      code TEXT PRIMARY KEY, module TEXT NOT NULL, description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS role_permissions (
      role_code TEXT NOT NULL, permission_code TEXT NOT NULL,
      PRIMARY KEY (role_code, permission_code)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, registration TEXT NOT NULL UNIQUE,
      password_hash TEXT, password_salt TEXT, password_iterations INTEGER,
      role_code TEXT NOT NULL DEFAULT 'operator', default_shift TEXT NOT NULL DEFAULT '1', email TEXT,
      status TEXT NOT NULL DEFAULT 'active', must_change_password INTEGER NOT NULL DEFAULT 1,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_login_at TEXT, password_changed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT, updated_by TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_line_access (
      user_id TEXT NOT NULL, line_id TEXT NOT NULL, PRIMARY KEY (user_id, line_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_machine_access (
      user_id TEXT NOT NULL, machine_id TEXT NOT NULL, PRIMARY KEY (user_id, machine_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      device_name TEXT, user_agent TEXT, ip_address TEXT,
      created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_login_attempts (
      attempt_key TEXT PRIMARY KEY, failed_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT, action TEXT NOT NULL,
      entity_type TEXT, entity_id TEXT, description TEXT, previous_value TEXT, new_value TEXT,
      ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_users_registration ON users (registration)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_users_role_status ON users (role_code, status)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id, revoked_at, expires_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions (token_hash)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id, created_at DESC)')
  ]);

  await env.DB.batch(ROLE_SEEDS.map(role => env.DB.prepare(`INSERT INTO roles (code,name,description,is_system_role,updated_at)
    VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=CURRENT_TIMESTAMP`).bind(...role)));
  await env.DB.batch(PERMISSION_SEEDS.map(permission => env.DB.prepare(`INSERT INTO permissions (code,module,description)
    VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET module=excluded.module,description=excluded.description`).bind(...permission)));
  const rolePermissionStatements = [];
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of permissions) rolePermissionStatements.push(env.DB.prepare(`INSERT OR IGNORE INTO role_permissions (role_code,permission_code) VALUES (?,?)`).bind(role, permission));
  }
  if (rolePermissionStatements.length) await env.DB.batch(rolePermissionStatements);

  await env.DB.prepare(`INSERT OR IGNORE INTO users (
      id,name,registration,role_code,default_shift,status,must_change_password,created_at,updated_at
    ) SELECT 'user-' || lower(replace(registration,' ','')), name, registration, 'operator', COALESCE(default_shift,'1'), 'pending', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM operators WHERE registration IS NOT NULL AND trim(registration) <> ''`).run();
}

export async function ensureAuthTables(env) {
  if (!env.DB) return;
  if (!readyPromise) readyPromise = initialize(env).catch(error => { readyPromise = null; throw error; });
  await readyPromise;
}

async function permissionCodes(env, roleCode) {
  const result = await env.DB.prepare(`SELECT permission_code AS code FROM role_permissions WHERE role_code = ? ORDER BY permission_code`).bind(roleCode).all();
  return (result.results || []).map(item => item.code);
}

async function accessForUser(env, userId) {
  const [lines, machines] = await Promise.all([
    env.DB.prepare('SELECT line_id AS lineId FROM user_line_access WHERE user_id = ? ORDER BY line_id').bind(userId).all(),
    env.DB.prepare('SELECT machine_id AS machineId FROM user_machine_access WHERE user_id = ? ORDER BY machine_id').bind(userId).all()
  ]);
  return { lineAccess:(lines.results || []).map(item => item.lineId), machineAccess:(machines.results || []).map(item => item.machineId) };
}

function mapUser(row) {
  if (!row) return null;
  return {
    id:row.id, name:row.name, registration:String(row.registration), roleCode:row.roleCode,
    defaultShift:String(row.defaultShift || '1'), email:row.email || '', status:row.status,
    mustChangePassword:Boolean(row.mustChangePassword), lastLoginAt:row.lastLoginAt || null,
    createdAt:row.createdAt, updatedAt:row.updatedAt,
    passwordHash:row.passwordHash, passwordSalt:row.passwordSalt, passwordIterations:row.passwordIterations,
    lockedUntil:row.lockedUntil || null
  };
}

async function getUserByRegistration(env, registration) {
  return mapUser(await env.DB.prepare(`SELECT id,name,registration,password_hash AS passwordHash,password_salt AS passwordSalt,
      password_iterations AS passwordIterations,role_code AS roleCode,default_shift AS defaultShift,email,status,
      must_change_password AS mustChangePassword,last_login_at AS lastLoginAt,locked_until AS lockedUntil,created_at AS createdAt,updated_at AS updatedAt
    FROM users WHERE registration = ? LIMIT 1`).bind(registration).first());
}

async function getUserById(env, id) {
  return mapUser(await env.DB.prepare(`SELECT id,name,registration,password_hash AS passwordHash,password_salt AS passwordSalt,
      password_iterations AS passwordIterations,role_code AS roleCode,default_shift AS defaultShift,email,status,
      must_change_password AS mustChangePassword,last_login_at AS lastLoginAt,locked_until AS lockedUntil,created_at AS createdAt,updated_at AS updatedAt
    FROM users WHERE id = ? LIMIT 1`).bind(id).first());
}

async function publicUser(env, user) {
  const access = await accessForUser(env, user.id);
  return {
    id:user.id, name:user.name, registration:user.registration, roleCode:user.roleCode,
    defaultShift:user.defaultShift, email:user.email, status:user.status,
    mustChangePassword:user.mustChangePassword, lastLoginAt:user.lastLoginAt,
    operationalContext:detectOperationalContext(),
    permissions:await permissionCodes(env, user.roleCode), ...access
  };
}

async function writeAudit(env, request, actor, action, entityType = '', entityId = '', description = '', previousValue = null, newValue = null) {
  await env.DB.prepare(`INSERT INTO audit_logs (
      id,user_id,user_name,action,entity_type,entity_id,description,previous_value,new_value,ip_address,user_agent,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      `audit-${crypto.randomUUID()}`, actor?.id || null, actor?.name || '', action, entityType, entityId, description,
      previousValue === null ? null : JSON.stringify(previousValue), newValue === null ? null : JSON.stringify(newValue),
      requestIp(request), userAgent(request), nowIso()
    ).run();
}

async function createSession(env, request, user) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const id = `session-${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO auth_sessions (
      id,user_id,token_hash,device_name,user_agent,ip_address,created_at,last_activity_at,expires_at
    ) VALUES (?,?,?,?,?,?,?,?,?)`).bind(
      id,user.id,tokenHash,deviceName(request),userAgent(request),requestIp(request),now.toISOString(),now.toISOString(),expires.toISOString()
    ).run();
  return { id, token, expiresAt:expires.toISOString() };
}

export async function authenticateRequest(request, env) {
  await ensureAuthTables(env);
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT
      s.id AS sessionId,s.expires_at AS expiresAt,s.last_activity_at AS lastActivityAt,
      u.id,u.name,u.registration,u.password_hash AS passwordHash,u.password_salt AS passwordSalt,
      u.password_iterations AS passwordIterations,u.role_code AS roleCode,u.default_shift AS defaultShift,u.email,u.status,
      u.must_change_password AS mustChangePassword,u.last_login_at AS lastLoginAt,u.locked_until AS lockedUntil,
      u.created_at AS createdAt,u.updated_at AS updatedAt
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? LIMIT 1`).bind(tokenHash, nowIso()).first();
  if (!row || row.status !== 'active') return null;
  const user = mapUser(row);
  const permissions = await permissionCodes(env, user.roleCode);
  const access = await accessForUser(env, user.id);
  const lastActivity = new Date(row.lastActivityAt || 0).getTime();
  if (Date.now() - lastActivity > 5 * 60 * 1000) {
    await env.DB.prepare('UPDATE auth_sessions SET last_activity_at = ? WHERE id = ?').bind(nowIso(), row.sessionId).run();
  }
  return { sessionId:row.sessionId, user, permissions, ...access };
}

function hasPermission(auth, permission) {
  return Boolean(auth && (auth.user.roleCode === 'admin' || auth.permissions.includes(permission)));
}

async function attemptState(env, registration, ip) {
  const key = `${registration.toLowerCase()}|${ip || 'unknown'}`;
  const row = await env.DB.prepare('SELECT failed_count AS failedCount,locked_until AS lockedUntil FROM auth_login_attempts WHERE attempt_key = ?').bind(key).first();
  return { key, failedCount:Number(row?.failedCount || 0), lockedUntil:row?.lockedUntil || null };
}

async function recordFailedAttempt(env, state, user) {
  const next = state.failedCount + 1;
  const lockMinutes = next >= MAX_LOGIN_ATTEMPTS ? Math.min(60, 5 * (2 ** Math.min(next - MAX_LOGIN_ATTEMPTS, 3))) : 0;
  const lockedUntil = lockMinutes ? new Date(Date.now() + lockMinutes * 60000).toISOString() : null;
  await env.DB.prepare(`INSERT INTO auth_login_attempts (attempt_key,failed_count,locked_until,updated_at)
    VALUES (?,?,?,?) ON CONFLICT(attempt_key) DO UPDATE SET failed_count=excluded.failed_count,locked_until=excluded.locked_until,updated_at=excluded.updated_at`)
    .bind(state.key,next,lockedUntil,nowIso()).run();
  if (user) await env.DB.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?').bind(next,lockedUntil,nowIso(),user.id).run();
}

async function clearAttempts(env, state, user) {
  await env.DB.prepare('DELETE FROM auth_login_attempts WHERE attempt_key = ?').bind(state.key).run();
  if (user) await env.DB.prepare('UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=?').bind(user.id).run();
}

async function replaceAccess(env, userId, lineAccess = [], machineAccess = []) {
  await env.DB.prepare('DELETE FROM user_line_access WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM user_machine_access WHERE user_id = ?').bind(userId).run();
  const statements = [];
  for (const lineId of [...new Set(lineAccess.map(normalize).filter(Boolean))]) statements.push(env.DB.prepare('INSERT INTO user_line_access (user_id,line_id) VALUES (?,?)').bind(userId,lineId));
  for (const machineId of [...new Set(machineAccess.map(normalize).filter(Boolean))]) statements.push(env.DB.prepare('INSERT INTO user_machine_access (user_id,machine_id) VALUES (?,?)').bind(userId,machineId));
  if (statements.length) await env.DB.batch(statements);
}

async function mirrorOperator(env, user) {
  await env.DB.prepare(`INSERT INTO operators (id,name,registration,default_shift,active,created_at,updated_at)
    VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,registration=excluded.registration,default_shift=excluded.default_shift,active=excluded.active,updated_at=CURRENT_TIMESTAMP`)
    .bind(`operator-${user.registration}`,user.name,user.registration,user.defaultShift,user.status === 'active' ? 1 : 0).run();
}

function generateTemporaryPassword() {
  return `Neo-${randomHex(5)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function requireAdminPermission(request, env, permission) {
  const auth = await authenticateRequest(request, env);
  if (!auth) return { response:json({ error:'Não autenticado.', code:'UNAUTHENTICATED' }, 401, { 'Set-Cookie':clearSessionCookie() }) };
  if (auth.user.mustChangePassword) return { response:json({ error:'Troca de senha obrigatória.', code:'PASSWORD_CHANGE_REQUIRED' }, 403) };
  if (!hasPermission(auth, permission)) return { response:json({ error:'Acesso não autorizado.', code:'FORBIDDEN' }, 403) };
  return { auth };
}

async function countOtherActiveAdmins(env, userId) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users WHERE role_code='admin' AND status='active' AND id <> ?`).bind(userId).first();
  return Number(row?.total || 0);
}

async function routeAuth(request, env, url) {
  if (url.pathname === '/api/v1/auth/bootstrap' && request.method === 'POST') {
    const expected = normalize(env.NEOMES_ADMIN_BOOTSTRAP_TOKEN);
    const supplied = normalize(request.headers.get('X-Bootstrap-Token'));
    if (!expected || !supplied || !constantTimeEqual(encoder.encode(expected), encoder.encode(supplied))) return json({ error:'Inicialização administrativa indisponível.' }, 403);
    const existing = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users WHERE role_code='admin' AND status='active'`).first();
    if (Number(existing?.total || 0) > 0) return json({ error:'O administrador inicial já foi criado.' }, 409);
    const body = await request.json().catch(() => null);
    const registration = normalize(body?.registration);
    const name = normalize(body?.name);
    const password = String(body?.password || '');
    const shift = normalize(body?.shift) || '1';
    const problem = passwordProblem(password, registration);
    if (!registration || !name || problem) return json({ error:problem || 'Nome e matrícula são obrigatórios.' }, 400);
    const credentials = await createPasswordHash(env, password);
    const id = `user-${crypto.randomUUID()}`;
    await env.DB.prepare(`INSERT INTO users (
      id,name,registration,password_hash,password_salt,password_iterations,role_code,default_shift,status,must_change_password,password_changed_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,'admin',?,'active',0,?,?,?)`).bind(id,name,registration,credentials.hash,credentials.salt,credentials.iterations,shift,nowIso(),nowIso(),nowIso()).run();
    const user = await getUserById(env,id);
    await mirrorOperator(env,user);
    await writeAudit(env,request,user,'admin.bootstrap','user',id,'Administrador inicial criado.');
    return json({ ok:true, user:await publicUser(env,user) }, 201);
  }

  if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const registration = normalize(body?.registration);
    const password = String(body?.password || '');
    const attempts = await attemptState(env, registration, requestIp(request));
    if (attempts.lockedUntil && new Date(attempts.lockedUntil) > new Date()) return json({ error:'Muitas tentativas. Aguarde alguns minutos.', code:'LOGIN_LOCKED' }, 429);
    const user = registration ? await getUserByRegistration(env,registration) : null;
    const valid = user ? await verifyPassword(env, password,user) : false;
    if (!user || !valid) {
      await recordFailedAttempt(env,attempts,user);
      await writeAudit(env,request,user,'auth.login_failed','user',user?.id || '','Tentativa de login rejeitada.');
      return json({ error:'Matrícula ou senha inválida.', code:'INVALID_CREDENTIALS' }, 401);
    }
    if (user.status === 'blocked') return json({ error:'Conta bloqueada. Procure o administrador.', code:'ACCOUNT_BLOCKED' }, 403);
    if (user.status !== 'active') return json({ error:'Conta inativa ou pendente. Procure o administrador.', code:'ACCOUNT_INACTIVE' }, 403);
    await clearAttempts(env,attempts,user);
    await env.DB.prepare('UPDATE users SET last_login_at=?,updated_at=? WHERE id=?').bind(nowIso(),nowIso(),user.id).run();
    const session = await createSession(env,request,user);
    await writeAudit(env,request,user,'auth.login','session',session.id,'Login realizado.');
    const refreshed = await getUserById(env,user.id);
    return json({ ok:true, user:await publicUser(env,refreshed), expiresAt:session.expiresAt }, 200, { 'Set-Cookie':sessionCookie(session.token) });
  }

  if (url.pathname === '/api/v1/auth/me' && request.method === 'GET') {
    const auth = await authenticateRequest(request,env);
    if (!auth) return json({ error:'Sessão inválida ou expirada.', code:'UNAUTHENTICATED' }, 401, { 'Set-Cookie':clearSessionCookie() });
    return json({ user:{ ...(await publicUser(env,auth.user)), permissions:auth.permissions, lineAccess:auth.lineAccess, machineAccess:auth.machineAccess } });
  }

  if (url.pathname === '/api/v1/auth/logout' && request.method === 'POST') {
    const auth = await authenticateRequest(request,env);
    if (auth) {
      await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE id=?').bind(nowIso(),auth.sessionId).run();
      await writeAudit(env,request,auth.user,'auth.logout','session',auth.sessionId,'Sessão encerrada.');
    }
    return json({ ok:true }, 200, { 'Set-Cookie':clearSessionCookie() });
  }

  if (url.pathname === '/api/v1/auth/change-password' && request.method === 'POST') {
    const auth = await authenticateRequest(request,env);
    if (!auth) return json({ error:'Não autenticado.', code:'UNAUTHENTICATED' }, 401);
    const body = await request.json().catch(() => null);
    const currentPassword = String(body?.currentPassword || '');
    const newPassword = String(body?.newPassword || '');
    if (!(await verifyPassword(env, currentPassword,auth.user))) return json({ error:'Senha atual incorreta.' }, 400);
    const problem = passwordProblem(newPassword,auth.user.registration);
    if (problem) return json({ error:problem }, 400);
    if (await verifyPassword(env, newPassword,auth.user)) return json({ error:'A nova senha deve ser diferente da atual.' }, 400);
    const credentials = await createPasswordHash(env, newPassword);
    await env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,must_change_password=0,password_changed_at=?,updated_at=? WHERE id=?`)
      .bind(credentials.hash,credentials.salt,credentials.iterations,nowIso(),nowIso(),auth.user.id).run();
    await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=?').bind(nowIso(),auth.user.id).run();
    const updated = await getUserById(env,auth.user.id);
    const session = await createSession(env,request,updated);
    await writeAudit(env,request,updated,'auth.password_changed','user',updated.id,'Senha alterada pelo usuário.');
    return json({ ok:true,user:await publicUser(env,updated) },200,{ 'Set-Cookie':sessionCookie(session.token) });
  }

  return null;
}

async function routeAdmin(request, env, url) {
  if (!url.pathname.startsWith('/api/v1/admin/')) return null;

  if (url.pathname === '/api/v1/admin/summary' && request.method === 'GET') {
    const access = await requireAdminPermission(request,env,'users.view'); if (access.response) return access.response;
    const row = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE status='active') AS activeUsers,
      (SELECT COUNT(*) FROM users WHERE status='blocked') AS blockedUsers,
      (SELECT COUNT(*) FROM users WHERE status='pending') AS pendingUsers,
      (SELECT COUNT(*) FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > ?) AS activeSessions`).bind(nowIso()).first();
    return json({ summary:row || {} });
  }

  if (url.pathname === '/api/v1/admin/users' && request.method === 'GET') {
    const access = await requireAdminPermission(request,env,'users.view'); if (access.response) return access.response;
    const search = `%${normalize(url.searchParams.get('search'))}%`;
    const role = normalize(url.searchParams.get('role'));
    const status = normalize(url.searchParams.get('status'));
    const result = await env.DB.prepare(`SELECT id,name,registration,role_code AS roleCode,default_shift AS defaultShift,email,status,
      must_change_password AS mustChangePassword,last_login_at AS lastLoginAt,created_at AS createdAt,updated_at AS updatedAt
      FROM users WHERE (name LIKE ? OR registration LIKE ?) AND (?='' OR role_code=?) AND (?='' OR status=?) ORDER BY name LIMIT 500`)
      .bind(search,search,role,role,status,status).all();
    const users = [];
    for (const row of result.results || []) users.push({ ...row, mustChangePassword:Boolean(row.mustChangePassword), ...(await accessForUser(env,row.id)) });
    return json({ users });
  }

  if (url.pathname === '/api/v1/admin/users' && request.method === 'POST') {
    const access = await requireAdminPermission(request,env,'users.create'); if (access.response) return access.response;
    const body = await request.json().catch(() => null);
    const registration = normalize(body?.registration); const name = normalize(body?.name); const roleCode = normalize(body?.roleCode) || 'operator';
    const password = String(body?.password || generateTemporaryPassword());
    const problem = passwordProblem(password,registration);
    if (!registration || !name || problem) return json({ error:problem || 'Nome e matrícula são obrigatórios.' },400);
    if (!(await env.DB.prepare('SELECT code FROM roles WHERE code=?').bind(roleCode).first())) return json({ error:'Perfil inválido.' },400);
    const credentials = await createPasswordHash(env, password); const id=`user-${crypto.randomUUID()}`; const now=nowIso();
    try {
      await env.DB.prepare(`INSERT INTO users (
        id,name,registration,password_hash,password_salt,password_iterations,role_code,default_shift,email,status,must_change_password,password_changed_at,created_at,updated_at,created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,'active',1,?,?,?,?)`).bind(id,name,registration,credentials.hash,credentials.salt,credentials.iterations,roleCode,normalize(body?.defaultShift)||'1',normalize(body?.email),now,now,now,access.auth.user.id).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(error.message)) return json({ error:'Já existe um usuário com esta matrícula.' },409);
      throw error;
    }
    await replaceAccess(env,id,body?.lineAccess || [],body?.machineAccess || []);
    const user=await getUserById(env,id); await mirrorOperator(env,user);
    await writeAudit(env,request,access.auth.user,'users.create','user',id,'Usuário criado.',null,{ name,registration,roleCode });
    return json({ user:await publicUser(env,user), temporaryPassword:password },201);
  }

  const userMatch = url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)$/);
  if (userMatch && request.method === 'GET') {
    const access=await requireAdminPermission(request,env,'users.view'); if(access.response)return access.response;
    const user=await getUserById(env,decodeURIComponent(userMatch[1]));
    return user ? json({ user:await publicUser(env,user) }) : json({ error:'Usuário não encontrado.' },404);
  }
  if (userMatch && request.method === 'PUT') {
    const access=await requireAdminPermission(request,env,'users.edit'); if(access.response)return access.response;
    const id=decodeURIComponent(userMatch[1]); const current=await getUserById(env,id); if(!current)return json({ error:'Usuário não encontrado.' },404);
    const body=await request.json().catch(()=>null); const nextRole=normalize(body?.roleCode)||current.roleCode; const nextStatus=normalize(body?.status)||current.status;
    if (current.roleCode==='admin' && (nextRole!=='admin' || nextStatus!=='active') && await countOtherActiveAdmins(env,id)===0) return json({ error:'É necessário manter pelo menos um administrador ativo no sistema.' },409);
    await env.DB.prepare(`UPDATE users SET name=?,role_code=?,default_shift=?,email=?,status=?,updated_at=?,updated_by=? WHERE id=?`).bind(
      normalize(body?.name)||current.name,nextRole,normalize(body?.defaultShift)||current.defaultShift,normalize(body?.email),nextStatus,nowIso(),access.auth.user.id,id).run();
    await replaceAccess(env,id,body?.lineAccess || [],body?.machineAccess || []);
    const updated=await getUserById(env,id); await mirrorOperator(env,updated);
    await writeAudit(env,request,access.auth.user,'users.edit','user',id,'Usuário atualizado.',{ roleCode:current.roleCode,status:current.status },{ roleCode:nextRole,status:nextStatus });
    return json({ user:await publicUser(env,updated) });
  }

  const actionMatch=url.pathname.match(/^\/api\/v1\/admin\/users\/([^/]+)\/(reset-password|block|unblock|disable|enable|revoke-sessions)$/);
  if(actionMatch && request.method==='POST'){
    const id=decodeURIComponent(actionMatch[1]); const action=actionMatch[2];
    const permission=action==='reset-password'?'users.reset_password':action==='revoke-sessions'?'sessions.manage':'users.disable';
    const access=await requireAdminPermission(request,env,permission); if(access.response)return access.response;
    const user=await getUserById(env,id); if(!user)return json({ error:'Usuário não encontrado.' },404);
    if(['block','disable'].includes(action) && user.roleCode==='admin' && await countOtherActiveAdmins(env,id)===0) return json({ error:'É necessário manter pelo menos um administrador ativo no sistema.' },409);
    if(action==='reset-password'){
      const body=await request.json().catch(()=>({})); const password=String(body?.password||generateTemporaryPassword()); const problem=passwordProblem(password,user.registration); if(problem)return json({ error:problem },400);
      const credentials=await createPasswordHash(env, password);
      await env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,must_change_password=1,password_changed_at=?,updated_at=?,updated_by=? WHERE id=?`)
        .bind(credentials.hash,credentials.salt,credentials.iterations,nowIso(),nowIso(),access.auth.user.id,id).run();
      await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(nowIso(),id).run();
      await writeAudit(env,request,access.auth.user,'users.reset_password','user',id,'Senha redefinida e sessões encerradas.');
      return json({ ok:true,temporaryPassword:password });
    }
    if(action==='revoke-sessions'){
      await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(nowIso(),id).run();
      await writeAudit(env,request,access.auth.user,'sessions.revoke_user','user',id,'Todas as sessões do usuário foram encerradas.');
      return json({ ok:true });
    }
    const statuses={ block:'blocked',unblock:'active',disable:'inactive',enable:'active' };
    await env.DB.prepare('UPDATE users SET status=?,updated_at=?,updated_by=? WHERE id=?').bind(statuses[action],nowIso(),access.auth.user.id,id).run();
    if(['block','disable'].includes(action)) await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(nowIso(),id).run();
    await writeAudit(env,request,access.auth.user,`users.${action}`,'user',id,`Conta ${statuses[action]}.`);
    return json({ user:await publicUser(env,await getUserById(env,id)) });
  }

  if(url.pathname==='/api/v1/admin/roles' && request.method==='GET'){
    const access=await requireAdminPermission(request,env,'users.view'); if(access.response)return access.response;
    const roles=(await env.DB.prepare('SELECT code,name,description,is_system_role AS isSystemRole FROM roles ORDER BY name').all()).results||[];
    for(const role of roles) role.permissions=await permissionCodes(env,role.code);
    return json({ roles });
  }
  if(url.pathname==='/api/v1/admin/permissions' && request.method==='GET'){
    const access=await requireAdminPermission(request,env,'users.manage_roles'); if(access.response)return access.response;
    return json({ permissions:(await env.DB.prepare('SELECT code,module,description FROM permissions ORDER BY module,code').all()).results||[] });
  }
  if(url.pathname==='/api/v1/admin/sessions' && request.method==='GET'){
    const access=await requireAdminPermission(request,env,'sessions.manage'); if(access.response)return access.response;
    const sessions=(await env.DB.prepare(`SELECT s.id,s.user_id AS userId,u.name,u.registration,s.device_name AS deviceName,s.ip_address AS ipAddress,
      s.created_at AS createdAt,s.last_activity_at AS lastActivityAt,s.expires_at AS expiresAt FROM auth_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_activity_at DESC LIMIT 500`).bind(nowIso()).all()).results||[];
    return json({ sessions });
  }
  const sessionMatch=url.pathname.match(/^\/api\/v1\/admin\/sessions\/([^/]+)\/revoke$/);
  if(sessionMatch && request.method==='POST'){
    const access=await requireAdminPermission(request,env,'sessions.manage'); if(access.response)return access.response;
    const id=decodeURIComponent(sessionMatch[1]); await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE id=?').bind(nowIso(),id).run();
    await writeAudit(env,request,access.auth.user,'sessions.revoke','session',id,'Sessão encerrada remotamente.'); return json({ ok:true });
  }
  if(url.pathname==='/api/v1/admin/audit' && request.method==='GET'){
    const access=await requireAdminPermission(request,env,'audit.view'); if(access.response)return access.response;
    const logs=(await env.DB.prepare(`SELECT id,user_id AS userId,user_name AS userName,action,entity_type AS entityType,entity_id AS entityId,
      description,previous_value AS previousValue,new_value AS newValue,ip_address AS ipAddress,created_at AS createdAt
      FROM audit_logs ORDER BY created_at DESC LIMIT 500`).all()).results||[];
    return json({ logs });
  }
  return json({ error:'Rota administrativa não encontrada.' },404);
}

export async function handleSecurityRoute(request, env) {
  await ensureAuthTables(env);
  const url=new URL(request.url);
  const authResponse=await routeAuth(request,env,url); if(authResponse)return authResponse;
  return routeAdmin(request,env,url);
}

export function authorizationError(auth, permission = '') {
  if (!auth) return json({ error:'Não autenticado.', code:'UNAUTHENTICATED' },401,{ 'Set-Cookie':clearSessionCookie() });
  if (auth.user.mustChangePassword) return json({ error:'Troca de senha obrigatória.', code:'PASSWORD_CHANGE_REQUIRED' },403);
  if (permission && !hasPermission(auth,permission)) return json({ error:'Acesso não autorizado.', code:'FORBIDDEN' },403);
  return null;
}

export function canAccessMachine(auth, lineId = '', machineId = '') {
  if (!auth || auth.user.roleCode === 'admin') return Boolean(auth);
  if (auth.machineAccess.length && machineId && !auth.machineAccess.includes(machineId)) return false;
  if (auth.lineAccess.length && lineId && !auth.lineAccess.includes(lineId)) return false;
  return true;
}
