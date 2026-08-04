import { authenticateRequest, ensureAuthTables } from './auth.js';

const PASSWORD_ITERATIONS = 10000;
const encoder = new TextEncoder();
let schemaPromise = null;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store'
    }
  });
}

function normalize(value) {
  return String(value ?? '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,'0')).join('');
}

function hexToBytes(hex) {
  return new Uint8Array((normalize(hex).match(/.{1,2}/g) || []).map(byte => Number.parseInt(byte,16)));
}

function randomHex(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function requestIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

function userAgent(request) {
  return (request.headers.get('User-Agent') || '').slice(0,500);
}

function passwordProblem(password, registration = '') {
  const value = String(password || '');
  if (value.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (registration && value.toLowerCase().includes(String(registration).toLowerCase())) return 'A senha não pode conter a matrícula.';
  if (!/[A-Za-zÀ-ÿ]/.test(value) || !/\d/.test(value)) return 'Use letras e números na senha.';
  return '';
}

function generateTemporaryPassword() {
  const letters = randomHex(6);
  const digits = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6,'0');
  return `Neo-${letters}-${digits}`;
}

async function derivePassword(password, saltHex, iterations = PASSWORD_ITERATIONS) {
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
    iterations
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

async function tableColumns(env, table) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((result.results || []).map(column => String(column.name)));
}

async function addColumnWhenMissing(env, table, column, declaration) {
  const columns = await tableColumns(env,table);
  if (columns.has(column)) return false;
  await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`).run();
  return true;
}

async function migrateSchema(env) {
  await ensureAuthTables(env);

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    registration TEXT,
    default_shift TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();

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

  await addColumnWhenMissing(env,'users','created_by','TEXT');
  await addColumnWhenMissing(env,'users','updated_by','TEXT');
  await addColumnWhenMissing(env,'users','email','TEXT');
  await addColumnWhenMissing(env,'users','password_iterations','INTEGER');
  await addColumnWhenMissing(env,'users','must_change_password','INTEGER NOT NULL DEFAULT 1');
  await addColumnWhenMissing(env,'users','last_login_at','TEXT');
  await addColumnWhenMissing(env,'users','password_changed_at','TEXT');
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

function hasCreatePermission(auth) {
  return Boolean(auth && (auth.user?.roleCode === 'admin' || auth.permissions?.includes('users.create')));
}

function sameOriginAllowed(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

function uniqueNormalized(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalize).filter(Boolean))];
}

async function validateCatalogAccess(env, lineAccess, machineAccess) {
  if (lineAccess.length) {
    const placeholders = lineAccess.map(() => '?').join(',');
    const result = await env.DB.prepare(`SELECT id FROM production_lines WHERE active=1 AND id IN (${placeholders})`).bind(...lineAccess).all();
    if ((result.results || []).length !== lineAccess.length) return 'Uma ou mais linhas selecionadas não existem.';
  }
  if (machineAccess.length) {
    const placeholders = machineAccess.map(() => '?').join(',');
    const result = await env.DB.prepare(`SELECT id FROM machines WHERE active=1 AND id IN (${placeholders})`).bind(...machineAccess).all();
    if ((result.results || []).length !== machineAccess.length) return 'Uma ou mais máquinas selecionadas não existem.';
  }
  return '';
}

async function publicCreatedUser(env, id) {
  const user = await env.DB.prepare(`SELECT
      id,name,registration,role_code AS roleCode,default_shift AS defaultShift,email,status,
      must_change_password AS mustChangePassword,last_login_at AS lastLoginAt,
      created_at AS createdAt,updated_at AS updatedAt
    FROM users WHERE id=? LIMIT 1`).bind(id).first();
  if (!user) return null;

  const [lines,machines,permissions] = await Promise.all([
    env.DB.prepare('SELECT line_id AS lineId FROM user_line_access WHERE user_id=? ORDER BY line_id').bind(id).all(),
    env.DB.prepare('SELECT machine_id AS machineId FROM user_machine_access WHERE user_id=? ORDER BY machine_id').bind(id).all(),
    env.DB.prepare('SELECT permission_code AS code FROM role_permissions WHERE role_code=? ORDER BY permission_code').bind(user.roleCode).all()
  ]);

  return {
    ...user,
    mustChangePassword:Boolean(user.mustChangePassword),
    lineAccess:(lines.results || []).map(item => item.lineId),
    machineAccess:(machines.results || []).map(item => item.machineId),
    permissions:(permissions.results || []).map(item => item.code)
  };
}

function safeFailure(error, stage) {
  console.error(`Falha ao criar usuário NEOMES [${stage}]`,error);
  const message = String(error?.message || error || '');
  if (/UNIQUE|constraint/i.test(message)) {
    return json({ error:'Já existe um usuário com esta matrícula.',code:'REGISTRATION_EXISTS' },409);
  }
  if (message === 'PASSWORD_PEPPER_MISSING') {
    return json({ error:'A segurança de senhas do servidor não está configurada.',code:'PASSWORD_SECURITY_UNAVAILABLE',stage },503);
  }
  return json({
    error:'Não foi possível concluir o cadastro. A operação foi cancelada sem deixar dados incompletos.',
    code:'USER_CREATE_FAILED',
    stage
  },500);
}

export async function handleAdminUserCreate(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/admin/users' || request.method !== 'POST') return null;

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
  if (!hasCreatePermission(auth)) return json({ error:'Você não possui permissão para criar usuários.',code:'FORBIDDEN' },403);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error:'Os dados enviados são inválidos.',code:'INVALID_JSON' },400);

  const name = normalize(body.name);
  const registration = normalize(body.registration);
  const roleCode = normalize(body.roleCode) || 'operator';
  const defaultShift = normalize(body.defaultShift) || '1';
  const email = normalize(body.email);
  const lineAccess = uniqueNormalized(body.lineAccess);
  const machineAccess = uniqueNormalized(body.machineAccess);
  const password = body.password ? String(body.password) : generateTemporaryPassword();

  if (!name) return json({ error:'Informe o nome completo.',code:'NAME_REQUIRED' },400);
  if (!/^\d+$/.test(registration)) return json({ error:'A matrícula deve conter somente números.',code:'INVALID_REGISTRATION' },400);
  if (!['1','2','3'].includes(defaultShift)) return json({ error:'Selecione um turno válido.',code:'INVALID_SHIFT' },400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error:'Informe um e-mail válido.',code:'INVALID_EMAIL' },400);

  const passwordError = passwordProblem(password,registration);
  if (passwordError) return json({ error:passwordError,code:'INVALID_PASSWORD' },400);

  const role = await env.DB.prepare('SELECT code FROM roles WHERE code=? LIMIT 1').bind(roleCode).first();
  if (!role) return json({ error:'O perfil selecionado não existe.',code:'INVALID_ROLE' },400);

  const catalogError = await validateCatalogAccess(env,lineAccess,machineAccess);
  if (catalogError) return json({ error:catalogError,code:'INVALID_ACCESS_SCOPE' },400);

  let credentials;
  try {
    credentials = await createPasswordHash(env,password);
  } catch (error) {
    return safeFailure(error,'password');
  }

  const now = nowIso();
  const existing = await env.DB.prepare(`SELECT
      id,status,password_hash AS passwordHash,must_change_password AS mustChangePassword,
      last_login_at AS lastLoginAt,created_by AS createdBy
    FROM users WHERE registration=? LIMIT 1`).bind(registration).first();

  const recoverable = Boolean(existing && (
    existing.status === 'pending'
    || !existing.passwordHash
    || (String(existing.createdBy || '') === String(auth.user.id)
      && Boolean(existing.mustChangePassword)
      && !existing.lastLoginAt)
  ));

  if (existing && !recoverable) {
    return json({ error:'Já existe um usuário com esta matrícula.',code:'REGISTRATION_EXISTS' },409);
  }

  const id = existing?.id || `user-${crypto.randomUUID()}`;
  const statements = [];

  if (existing) {
    statements.push(env.DB.prepare(`UPDATE users SET
      name=?,password_hash=?,password_salt=?,password_iterations=?,role_code=?,default_shift=?,email=?,
      status='active',must_change_password=1,password_changed_at=?,updated_at=?,updated_by=?,created_by=COALESCE(created_by,?)
      WHERE id=?`).bind(
        name,credentials.hash,credentials.salt,credentials.iterations,roleCode,defaultShift,email,
        now,now,auth.user.id,auth.user.id,id
      ));
  } else {
    statements.push(env.DB.prepare(`INSERT INTO users (
      id,name,registration,password_hash,password_salt,password_iterations,role_code,default_shift,email,
      status,must_change_password,password_changed_at,created_at,updated_at,created_by,updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,'active',1,?,?,?,?,?)`).bind(
      id,name,registration,credentials.hash,credentials.salt,credentials.iterations,roleCode,defaultShift,email,
      now,now,now,auth.user.id,auth.user.id
    ));
  }

  statements.push(env.DB.prepare('DELETE FROM user_line_access WHERE user_id=?').bind(id));
  statements.push(env.DB.prepare('DELETE FROM user_machine_access WHERE user_id=?').bind(id));

  for (const lineId of lineAccess) {
    statements.push(env.DB.prepare('INSERT INTO user_line_access (user_id,line_id) VALUES (?,?)').bind(id,lineId));
  }
  for (const machineId of machineAccess) {
    statements.push(env.DB.prepare('INSERT INTO user_machine_access (user_id,machine_id) VALUES (?,?)').bind(id,machineId));
  }

  statements.push(env.DB.prepare(`INSERT INTO operators (
      id,name,registration,default_shift,active,created_at,updated_at
    ) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,registration=excluded.registration,default_shift=excluded.default_shift,
      active=1,updated_at=CURRENT_TIMESTAMP`).bind(`operator-${registration}`,name,registration,defaultShift));

  statements.push(env.DB.prepare(`INSERT INTO audit_logs (
      id,user_id,user_name,action,entity_type,entity_id,description,previous_value,new_value,ip_address,user_agent,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      `audit-${crypto.randomUUID()}`,auth.user.id,auth.user.name,'users.create','user',id,
      existing ? 'Cadastro incompleto recuperado e concluído.' : 'Usuário criado.',
      existing ? JSON.stringify({ status:existing.status }) : null,
      JSON.stringify({ name,registration,roleCode,defaultShift,lineAccess,machineAccess }),
      requestIp(request),userAgent(request),now
    ));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    return safeFailure(error,'persist');
  }

  try {
    const user = await publicCreatedUser(env,id);
    if (!user) throw new Error('USER_READBACK_FAILED');
    return json({
      ok:true,
      recovered:Boolean(existing),
      user,
      temporaryPassword:password
    },existing ? 200 : 201);
  } catch (error) {
    return safeFailure(error,'readback');
  }
}

export async function adminUserCreateHealth(env) {
  await ensureSchema(env);
  const columns = await tableColumns(env,'users');
  const required = ['created_by','updated_by','email','password_iterations','must_change_password'];
  const missing = required.filter(column => !columns.has(column));
  const credentials = await createPasswordHash(env,'NEOMES-Admin-Create-Self-Test-2026');
  return {
    ok:missing.length === 0 && /^[a-f0-9]{64}$/.test(credentials.hash),
    schemaReady:missing.length === 0,
    missingColumns:missing,
    passwordHashReady:/^[a-f0-9]{64}$/.test(credentials.hash),
    transaction:'d1-batch'
  };
}
