import { ensureAuthTables } from './auth.js';

const encoder = new TextEncoder();
const ITERATIONS = 160000;

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
function normalize(value){return String(value??'').trim();}
function bytesToHex(bytes){return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');}
function randomHex(length=16){const bytes=new Uint8Array(length);crypto.getRandomValues(bytes);return bytesToHex(bytes);}
function hexToBytes(hex){return new Uint8Array((hex.match(/.{1,2}/g)||[]).map(value=>Number.parseInt(value,16)));}
function constantTimeEqual(left,right){const a=encoder.encode(left);const b=encoder.encode(right);if(a.length!==b.length)return false;let difference=0;for(let index=0;index<a.length;index+=1)difference|=a[index]^b[index];return difference===0;}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:hexToBytes(salt),iterations:ITERATIONS},key,256);return bytesToHex(bits);}
function passwordProblem(password,registration){if(password.length<10)return 'A senha deve ter pelo menos 10 caracteres.';if(password.toLowerCase().includes(registration.toLowerCase()))return 'A senha não pode conter a matrícula.';if(!/[A-Za-zÀ-ÿ]/.test(password)||!/[0-9]/.test(password))return 'Use letras e números na senha.';return '';}

export async function handleBootstrap(request,env){
  await ensureAuthTables(env);
  const expected=normalize(env.NEOMES_ADMIN_BOOTSTRAP_TOKEN);
  const supplied=normalize(request.headers.get('X-Bootstrap-Token'));
  if(!expected||!supplied||!constantTimeEqual(expected,supplied))return json({error:'Inicialização administrativa indisponível.'},403);

  const activeAdmin=await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role_code='admin' AND status='active'").first();
  if(Number(activeAdmin?.total||0)>0)return json({error:'O administrador inicial já foi criado.'},409);

  const body=await request.json().catch(()=>null);
  const name=normalize(body?.name);const registration=normalize(body?.registration);const shift=normalize(body?.shift)||'1';const password=String(body?.password||'');
  const problem=passwordProblem(password,registration);
  if(!name||!registration||problem)return json({error:problem||'Nome e matrícula são obrigatórios.'},400);

  const salt=randomHex(16);const hash=await passwordHash(password,salt);const now=new Date().toISOString();
  const existing=await env.DB.prepare('SELECT id FROM users WHERE registration=? LIMIT 1').bind(registration).first();
  const id=existing?.id||`user-${crypto.randomUUID()}`;

  if(existing){
    await env.DB.prepare(`UPDATE users SET name=?,password_hash=?,password_salt=?,password_iterations=?,role_code='admin',default_shift=?,status='active',must_change_password=0,failed_login_attempts=0,locked_until=NULL,password_changed_at=?,updated_at=? WHERE id=?`)
      .bind(name,hash,salt,ITERATIONS,shift,now,now,id).run();
  }else{
    await env.DB.prepare(`INSERT INTO users (id,name,registration,password_hash,password_salt,password_iterations,role_code,default_shift,status,must_change_password,password_changed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'admin',?,'active',0,?,?,?)`).bind(id,name,registration,hash,salt,ITERATIONS,shift,now,now,now).run();
  }

  await env.DB.prepare(`INSERT INTO operators (id,name,registration,default_shift,active,created_at,updated_at)
    VALUES (?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,registration=excluded.registration,default_shift=excluded.default_shift,active=1,updated_at=CURRENT_TIMESTAMP`)
    .bind(`operator-${registration}`,name,registration,shift).run();

  await env.DB.prepare(`INSERT INTO audit_logs (id,user_id,user_name,action,entity_type,entity_id,description,ip_address,user_agent,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(`audit-${crypto.randomUUID()}`,id,name,'admin.bootstrap','user',id,'Administrador inicial criado preservando a matrícula existente.',request.headers.get('CF-Connecting-IP')||'',(request.headers.get('User-Agent')||'').slice(0,500),now).run();

  return json({ok:true,user:{id,name,registration,roleCode:'admin',defaultShift:shift,status:'active',mustChangePassword:false}},201);
}
