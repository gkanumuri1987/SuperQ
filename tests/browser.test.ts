import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { validateProject } from '../src/model.js';
import { createAdapters } from '../src/adapters.js';
import { run } from '../src/runner.js';
for(const browser of (process.env.SUPERQ_TEST_BROWSERS??'chromium').split(',')) test(`${browser} journey uses centralized locator and catches incorrect visible content`,async()=>{
  let text='Service healthy';
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(`<p data-testid="health-status">${text}</p>`);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); const address=server.address(); assert.ok(address&&typeof address!=='string');
  const p=validateProject(JSON.parse(await readFile('examples/project.json','utf8'))); p.environments.local!.baseURL=`http://127.0.0.1:${address.port}`;
  const adapters=createAdapters({provider:'local',browser});
  try {
    assert.equal((await run(p,'local','browser',adapters.registry))[0]!.status,'passed');
    text='Service unavailable'; assert.equal((await run(p,'local','browser',adapters.registry))[0]!.status,'failed');
  } finally {await adapters.close(); await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
