const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
http.createServer((req,res)=>{let p;try{p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
 const base=p.startsWith('/vendor/')?path.join(root,'node_modules/three/build'):path.join(root,'renderer');
 const file=path.join(base,p.startsWith('/vendor/')?p.slice(8):p==='/'?'preview.html':p);
 if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);});
}).listen(4178,'127.0.0.1',()=>console.log('Parkjuim preview: http://127.0.0.1:4178'));
