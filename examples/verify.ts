import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const server=spawn(process.execPath,['--import','tsx','examples/server.ts'],{stdio:['ignore','pipe','pipe']});
let exited=false; server.on('exit',()=>{exited=true;});
async function execute(args:string[]) {
  const child=spawn('npm',args,{stdio:'inherit'});
  await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Example command failed: ${args.join(' ')}`)));});
}
try {
  let ready=false;
  for(let i=0;i<50;i++) {
    if(exited) throw new Error('Reference server failed; port 4173 may already be in use');
    try {const response=await fetch('http://127.0.0.1:4173/health'); if(response.ok) {ready=true;break;}} catch{}
    await delay(100);
  }
  if(!ready||exited) throw new Error('Reference server did not become ready');
  await execute(['run','superq','--','run','examples/project.json','local','smoke']);
  await execute(['run','superq','--','run','examples/project.json','local','regression','--profiles',process.env.SUPERQ_TEST_PROFILES??'local','--workers','2']);
  await execute(['run','superq','--','plan','examples/project.json','local','regression','--tags','smoke']);
  await execute(['run','superq','--','doctor','examples/project.json']);
  await execute(['run','bdd']);
} finally {server.kill();}
