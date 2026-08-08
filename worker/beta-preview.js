const MUTATING_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
const ALLOWED_AUTH_MUTATIONS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/logout'
]);

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

function productionUrl(requestUrl, origin) {
  const source = new URL(requestUrl);
  const target = new URL(origin);
  target.pathname = source.pathname;
  target.search = source.search;
  return target;
}

async function proxyApi(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

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
<div id="neomes-pixi-beta-banner" role="status" aria-label="Preview Pixi somente leitura"><i></i> PIXI BETA · SOMENTE TESTE · OPERAÇÕES BLOQUEADAS</div>
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
        productionOrigin:env.NEOMES_PRODUCTION_ORIGIN
      },200,{
        'X-NEOMES-Preview':'pixi-beta'
      });
    }

    if (url.pathname.startsWith('/api/')) return proxyApi(request, env);
    return serveAsset(request, env);
  }
};
