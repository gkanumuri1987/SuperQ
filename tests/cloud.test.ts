import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserProfile } from '../src/config.js';
import { cloudEndpoint } from '../src/browser.js';
test('BrowserStack capabilities use documented browser mapping and environment credentials',()=>{
  const p=BrowserProfile.parse({provider:'browserstack',browser:'firefox',os:'Windows',osVersion:'11',localIdentifier:'tunnel-1'});
  const url=new URL(cloudEndpoint(p,'TC-1',{BROWSERSTACK_USERNAME:'fixture-user',BROWSERSTACK_ACCESS_KEY:'fixture-key'}));
  assert.equal(url.hostname,'cdp.browserstack.com');const caps=JSON.parse(url.searchParams.get('caps')!);assert.equal(caps.browser,'playwright-firefox');assert.equal(caps['browserstack.accessKey'],'fixture-key');assert.equal(caps['browserstack.localIdentifier'],'tunnel-1');assert.equal(caps.browser_version,undefined);assert.equal(caps['browserstack.video'],false);
});
test('LambdaTest capabilities and tunnel configuration use the provider endpoint',()=>{
  const p=BrowserProfile.parse({provider:'lambdatest',browser:'edge',platform:'Windows 11',tunnelName:'qe-tunnel'});
  const url=new URL(cloudEndpoint(p,'TC-2',{LT_USERNAME:'fixture-user',LT_ACCESS_KEY:'fixture-key'}));const caps=JSON.parse(url.searchParams.get('capabilities')!);
  assert.equal(url.hostname,'cdp.lambdatest.com');assert.equal(caps.browserName,'MicrosoftEdge');assert.equal(caps['LT:Options'].tunnel,true);assert.equal(caps['LT:Options'].accessKey,'fixture-key');assert.equal(caps['LT:Options'].video,false);
  assert.throws(()=>cloudEndpoint(p,'TC-2',{}),/Missing cloud credential/);
});
test('unknown capabilities and inline credentials are rejected',()=>{
  assert.throws(()=>BrowserProfile.parse({provider:'browserstack',os:'Windows',osVersion:'11',accessKey:'do-not-save'}));assert.throws(()=>BrowserProfile.parse({provider:'local',browser:'safari'}));
});
test('remote connection failures do not expose credential-bearing endpoint errors in test results',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {validateProject}=await import('../src/model.js');
  const {createAdapters}=await import('../src/adapters.js');
  const {run}=await import('../src/runner.js');
  const p=validateProject(JSON.parse(await readFile('examples/project.json','utf8')));
  const adapters=createAdapters({provider:'browserstack',os:'Windows',osVersion:'11'},async()=>{throw new Error('wss://fixture.invalid?accessKey=NEVER-REPORT-THIS');});
  try{const results=await run(p,'local','browser',adapters.registry);assert.equal(results[0]!.status,'failed');assert.ok(!JSON.stringify(results).includes('NEVER-REPORT-THIS'));}finally{await adapters.close();}
});
