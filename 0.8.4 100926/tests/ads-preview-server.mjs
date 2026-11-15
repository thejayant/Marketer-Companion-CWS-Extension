import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const route=url.pathname==='/'?(url.searchParams.get('surface')==='popup'?'popup.html':'panel.html'):decodeURIComponent(url.pathname).slice(1);
  const file=path.resolve(root,route);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{
    let content=fs.readFileSync(file);
    if(['popup.html','panel.html'].includes(route))content=Buffer.from(content.toString().replace('src="popup.js"',url.searchParams.has('full')?'src="tests/production-preview.js"':'src="tests/ads-preview.js"'));
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
  }catch{res.writeHead(404);res.end();}
});
server.listen(8765,'127.0.0.1',()=>console.log('Synthetic reporting preview: http://127.0.0.1:8765'));
