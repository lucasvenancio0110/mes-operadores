import { factoryMapMachineIds } from '../app/preparer-map-layout.js';

const MUTATING_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
const ALLOWED_AUTH_MUTATIONS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/logout'
]);

const BETA_REGISTRATION = '9999';
const BETA_PASSWORD = 'senha123456';
const BETA_COOKIE_NAME = 'neomes_beta_session';
const BETA_SESSION_TOKEN = 'pixi-beta-9999-v1';
const BETA_SESSION_TTL_SECONDS = 12 * 60 * 60;
const BETA_USER = Object.freeze({
  id:'beta-user-9999',
  name:'Teste Pixi',
  registration:BETA_REGISTRATION,
  roleCode:'preparator',
  defaultShift:'1',
  email:'',
  status:'active',
  mustChangePassword:false,
  permissions:['machines.view'],
  lineAccess:['linha-5'],
  machineAccess:[]
});

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      ...headers
    }
  });
}

function parseCookies(request) {
  const cookies={};
  for(const part of (request.headers.get('Cookie') || '').split(';')){
    const separator=part.indexOf('=');
    if(separator<0)continue;
    cookies[part.slice(0,separator).trim()]=decodeURIComponent(part.slice(separator+1).trim());
  }
  return cookies;
}

function hasBetaSession(request) {
  return parseCookies(request)[BETA_COOKIE_NAME] === BETA_SESSION_TOKEN;
}

function betaSessionCookie(maxAge = BETA_SESSION_TTL_SECONDS) {
  return `${BETA_COOKIE_NAME}=${encodeURIComponent(BETA_SESSION_TOKEN)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearBetaSessionCookie() {
  return `${BETA_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function expiresAt() {
  return new Date(Date.now()+BETA_SESSION_TTL_SECONDS*1000).toISOString();
}

function machineName(id) {
  if(id==='milltap')return 'MILLTAP';
  if(id==='discovery')return 'DISCOVERY';
  return `TNL ${String(Number(id.match(/\d+/)?.[0]||0)).padStart(3,'0')}`;
}

function dashboardSnapshot(url) {
  const machineIds=factoryMapMachineIds();
  const machines=machineIds.map((machineId,index)=>{
    const mod=index%13;
    const physicalStatus=mod===1?'setup':mod===2?'maintenance':mod===3?'stopped':'producing';
    return {
      machineId,
      machineName:machineName(machineId),
      lineId:'linha-5',
      lineName:'Linha 5',
      assignedOperator:{ name:`Operador Demo ${String(index+1).padStart(3,'0')}`,registration:String(9000+index) },
      activeOrder:{
        op:`BETA-${String(index+1).padStart(3,'0')}`,
        item:`DEMO-${String(index+1).padStart(3,'0')}`,
        description:'Dados fictícios para teste visual do mapa Pixi',
        opTarget:1000,
        producedSoFar:100+index,
        cycleSeconds:60,
        frequency1:100,
        frequency2:null,
        pieceLengthMm:10,
        currentBarPieces:100,
        feederBars:2,
        barLengthMm:3600,
        kerfMm:1
      },
      turnClock:{ totalMinutes:480,usedMinutes:60,remainingMinutes:420 },
      turnState:{ workflowStatus:'ready',goodPieces:20,rejects:0,stopMinutes:0,lastPointingAt:null },
      runtimeState:{ physicalStatus,reason:'',note:'Ambiente BETA - dado fictício' },
      flowAxes:{ physicalStatus,opStatus:'active',workflowStatus:'ready' },
      forecast:{
        reason:'op',
        estimatedAt:new Date(Date.now()+3*60*60*1000).toISOString(),
        materialEstimatedAt:new Date(Date.now()+4*60*60*1000).toISOString(),
        opRemaining:Math.max(0,900-index),
        availablePieces:1200
      }
    };
  });
  const requestedDate=url.searchParams.get('productionDate') || new Date().toISOString().slice(0,10);
  const requestedShift=url.searchParams.get('shift') || '1';
  return {
    ok:true,
    beta:true,
    demoData:true,
    serverTime:new Date().toISOString(),
    productionDate:requestedDate,
    shift:requestedShift,
    lines:[{ id:'linha-5',name:'Linha 5 · DEMO' }],
    machines,
    summary:{
      total:machines.length,
      producing:machines.filter(machine=>machine.runtimeState.physicalStatus==='producing').length,
      setup:machines.filter(machine=>machine.runtimeState.physicalStatus==='setup').length,
      stopped:machines.filter(machine=>['stopped','maintenance'].includes(machine.runtimeState.physicalStatus)).length,
      pending:0,
      materialRisks:0
    }
  };
}

function productionUrl(requestUrl, origin) {
  const source = new URL(requestUrl);
  const target = new URL(origin);
  target.pathname = source.pathname;
  target.search = source.search;
  return target;
}

function stripBetaCookie(headers) {
  const cookie=headers.get('Cookie') || '';
  if(!cookie)return;
  const filtered=cookie.split(';').map(part=>part.trim()).filter(Boolean).filter(part=>!part.startsWith(`${BETA_COOKIE_NAME}=`));
  if(filtered.length)headers.set('Cookie',filtered.join('; '));
  else headers.delete('Cookie');
}

async function handleBetaAuth(request) {
  const url=new URL(request.url);
  if(url.pathname==='/api/v1/auth/login'&&request.method==='POST'){
    const body=await request.clone().json().catch(()=>null);
    if(String(body?.registration || '').trim()!==BETA_REGISTRATION)return null;
    if(String(body?.password || '')!==BETA_PASSWORD){
      return json({ error:'Matrícula ou senha inválida.',code:'INVALID_CREDENTIALS',beta:true },401);
    }
    return json({ ok:true,user:BETA_USER,expiresAt:expiresAt(),beta:true,demoData:true },200,{
      'Set-Cookie':betaSessionCookie(),
      'X-NEOMES-Preview':'pixi-beta-demo'
    });
  }

  if(url.pathname==='/api/v1/auth/me'&&request.method==='GET'&&hasBetaSession(request)){
    return json({ user:BETA_USER,expiresAt:expiresAt(),beta:true,demoData:true },200,{
      'X-NEOMES-Preview':'pixi-beta-demo'
    });
  }

  if(url.pathname==='/api/v1/auth/logout'&&request.method==='POST'&&hasBetaSession(request)){
    return json({ ok:true,beta:true },200,{
      'Set-Cookie':clearBetaSessionCookie(),
      'X-NEOMES-Preview':'pixi-beta-demo'
    });
  }

  if(url.pathname==='/api/v1/turn-assistant/line-dashboard'&&request.method==='GET'&&hasBetaSession(request)){
    return json(dashboardSnapshot(url),200,{
      'X-NEOMES-Preview':'pixi-beta-demo'
    });
  }

  return null;
}

async function proxyApi(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  const betaResponse=await handleBetaAuth(request);
  if(betaResponse)return betaResponse;

  if (MUTATING_METHODS.has(method) && !ALLOWED_AUTH_MUTATIONS.has(url.pathname)) {
    return json({
      error:'Preview Pixi em modo somente leitura. Esta operação foi bloqueada antes de chegar à produção.',
      code:'BETA_READ_ONLY',
      beta:true
    },423,{
      'X-NEOMES-Preview':'pixi-beta-read-only'
    });
  }

  const target = productionUrl(request.url, env.NEOMES_PRODUCTION_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('host');
  stripBetaCookie(headers);
  headers.set('X-NEOMES-Preview','pixi-beta');

  const upstreamRequest = new Request(target.toString(), {
    method:request.method,
    headers,
    body:['GET','HEAD'].includes(method) ? undefined : request.body,
    redirect:'manual'
  });

  const response = await fetch(upstreamRequest);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('X-NEOMES-Preview','pixi-beta');
  responseHeaders.set('Cache-Control','no-store');
  return new Response(response.body, {
    status:response.status,
    statusText:response.statusText,
    headers:responseHeaders
  });
}

function injectBetaShell(html) {
  const marker = `
<style id="neomes-pixi-beta-style">
  #neomes-pixi-beta-banner{position:fixed;z-index:2147483647;left:50%;bottom:max(12px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:9px 14px;border:1px solid rgba(251,72,215,.65);border-radius:999px;background:rgba(25,8,31,.94);box-shadow:0 8px 30px rgba(0,0,0,.35);backdrop-filter:blur(12px);color:#fff;font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.05em;white-space:nowrap;pointer-events:none}
  #neomes-pixi-beta-banner i{width:8px;height:8px;border-radius:50%;background:#fb48d7;box-shadow:0 0 14px #fb48d7}
  @media(max-width:520px){#neomes-pixi-beta-banner{font-size:10px;padding:8px 11px;max-width:calc(100vw - 24px)}}
</style>
<script id="neomes-pixi-beta-bootstrap">try{sessionStorage.setItem('neomes:factory-map-renderer:v1','pixi')}catch{}</script>
<div id="neomes-pixi-beta-banner" role="status" aria-label="Preview Pixi somente leitura"><i></i> PIXI BETA · DEMO · OPERAÇÕES BLOQUEADAS</div>
`;
  if (html.includes('</body>')) return html.replace('</body>',`${marker}</body>`);
  return `${html}${marker}`;
}

async function serveAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('text/html') || !response.ok) return response;

  const headers = new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('X-NEOMES-Preview','pixi-beta');
  return new Response(injectBetaShell(await response.text()), {
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        ok:true,
        service:'neomes-pixi-beta',
        mode:'read-only-preview',
        renderer:'pixi',
        demoLogin:true,
        productionOrigin:env.NEOMES_PRODUCTION_ORIGIN
      },200,{
        'X-NEOMES-Preview':'pixi-beta'
      });
    }

    if (url.pathname.startsWith('/api/')) return proxyApi(request, env);
    return serveAsset(request, env);
  }
};
