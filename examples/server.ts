import { createServer } from 'node:http';
const server=createServer((req,res)=>{
  if(req.url==='/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok'}));}
  else if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="en"><title>SuperQ reference app</title><h1>SuperQ reference app</h1><p data-testid="health-status">Service healthy</p></html>');}
  else {res.statusCode=404;res.end('Not found');}
});
server.listen(4173,'127.0.0.1',()=>console.log('Reference application: http://127.0.0.1:4173'));
