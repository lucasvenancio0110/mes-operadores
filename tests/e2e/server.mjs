import { createServer } from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import { extname,join,normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const types={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon'
};

function safePath(urlPath){
  const requested=decodeURIComponent(urlPath.split('?')[0]);
  const relative=requested==='/'?'index.html':requested.replace(/^\/+/, '');
  const resolved=normalize(join(root,relative));
  return resolved.startsWith(normalize(root))?resolved:null;
}

const server=createServer(async(request,response)=>{
  try{
    const path=safePath(request.url||'/');
    if(!path)return void response.writeHead(403).end('Forbidden');
    const info=await stat(path);
    const file=info.isDirectory()?join(path,'index.html'):path;
    const body=await readFile(file);
    response.writeHead(200,{
      'Content-Type':types[extname(file).toLowerCase()]||'application/octet-stream',
      'Cache-Control':'no-store',
      'Service-Worker-Allowed':'/'
    });
    response.end(body);
  }catch{
    response.writeHead(404,{ 'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store' });
    response.end('Not found');
  }
});

server.listen(4173,'127.0.0.1',()=>console.log('NEOMES e2e server: http://127.0.0.1:4173'));
