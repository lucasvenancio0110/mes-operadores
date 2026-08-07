import http from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import { extname,join,normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const port=4174;
const types={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.webmanifest':'application/manifest+json; charset=utf-8'
};

const server=http.createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://127.0.0.1');
    const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const clean=normalize(pathname).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/,'');
    const file=join(root,clean);
    if(!file.startsWith(root))throw new Error('invalid path');
    const info=await stat(file);
    if(!info.isFile())throw new Error('not a file');
    const body=await readFile(file);
    response.writeHead(200,{
      'Content-Type':types[extname(file)]||'application/octet-stream',
      'Cache-Control':'no-store, max-age=0',
      'Access-Control-Allow-Origin':'*'
    });
    response.end(body);
  }catch{
    response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
    response.end('Not found');
  }
});

server.listen(port,'127.0.0.1',()=>console.log(`Factory map test server: http://127.0.0.1:${port}`));
