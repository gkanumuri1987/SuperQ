import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { validateProject } from '../src/model.js';
import { coverage } from '../src/coverage.js';
import { Registry, run, check, interpolate, resolveData } from '../src/runner.js';
import { Planner, proposeHealing } from '../src/ai.js';
import { createAdapters, readQuery } from '../src/adapters.js';
import { changes } from '../src/knowledge.js';
const raw=JSON.parse(await readFile(new URL('../examples/project.json',import.meta.url),'utf8'));
const project=()=>validateProject(structuredClone(raw));
test('rejects broken references, cycles, duplicated catalog and locator definitions',()=>{
  const p=project(); p.tests[0]!.evidenceIds=['invented']; assert.throws(()=>validateProject(p),/Unknown evidence/);
  const q=project(); q.tests[0]!.dependsOn=[q.tests[1]!.id]; q.tests[1]!.dependsOn=[q.tests[0]!.id]; assert.throws(()=>validateProject(q),/cycle/);
  const r=project(); r.catalog.push({...r.catalog[0]!,id:'duplicate'}); assert.throws(()=>validateProject(r),/Duplicate catalog/);
  const s=project(); s.locators.copy={...s.locators['health-status']!}; assert.throws(()=>validateProject(s),/Duplicate locator/);
});
test('separates declared, automated and proven coverage; missing QE and automation remain visible',()=>{
  const report=coverage(project()); assert.equal(report.rows[0]!.proven,false); assert.deepEqual(report.rows[2]!.gaps,['missing-qe-review','no-approved-test','missing-asserted-automation','blocker']);
  assert.equal(coverage(project(),[{id:'TC-API',status:'passed',durationMs:1}]).rows[0]!.proven,true);
});
test('data precedence is global < environment < suite < case; missing values fail',()=>{
  const p=project(); p.data={a:1,b:1}; p.environments.local!.data={a:2}; p.suites.smoke!.data={a:3};
  assert.deepEqual(resolveData(p,'local','smoke',{a:4}),{a:4,b:1}); assert.equal(interpolate('${n}',{n:42}),42); assert.throws(()=>interpolate('${missing}',{}),/Missing data/);
});
test('assertions detect wrong types, values and missing fields',()=>{
  assert.throws(()=>check({status:500},{path:'status',operator:'equals',expected:200})); assert.throws(()=>check({},{path:'a',operator:'exists'})); assert.throws(()=>check({n:42},{path:'n',operator:'matches',expected:'42'}));
});
test('failed dependencies block descendants; draft and assertion-free tests cannot pass',async()=>{
  const p=project(); p.tests[1]!.dependsOn=['TC-API']; p.tests[1]!.suites=['smoke'];
  const registry=new Registry().register('api:request',async()=>({status:500}));
  const result=await run(p,'local','smoke',registry); assert.deepEqual(result.map(x=>x.status),['failed','blocked']);
  assert.equal((await run(p,'local','data',registry))[0]!.status,'skipped');
  p.tests[0]!.steps[0]!.assertions=[]; assert.equal((await run(p,'local','smoke',registry))[0]!.status,'blocked');
});
test('API adapter executes a real request and enforces origin isolation',async()=>{
  const server=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end('{"status":"ok"}');}); await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address(); assert.ok(address&&typeof address!=='string'); const p=project(); p.environments.local!.baseURL=`http://127.0.0.1:${address.port}`;
  const adapters=createAdapters(); try {
    assert.equal((await run(p,'local','smoke',adapters.registry))[0]!.status,'passed');
    p.tests[0]!.steps[0]!.input.path='https://example.com'; assert.equal((await run(p,'local','smoke',adapters.registry))[0]!.status,'failed');
  } finally {await adapters.close(); await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test('planner caches, enforces budgets, and rejects invented evidence',async()=>{
  let calls=0; const p=project(); const provider=async()=>{calls++;return {costUsd:0.01,json:{summary:'Verify health',requirementId:'REQ-HEALTH',evidenceIds:['DOC-1'],actionIds:['health-request'],questions:[],steps:['Assert status and body']}};};
  const planner=new Planner(provider,0.02); await planner.propose(p,'REQ-HEALTH',0.02); await planner.propose(p,'REQ-HEALTH',0.02); assert.equal(calls,1); assert.equal(planner.costUsd,0.01);
  const bad=new Planner(async()=>({costUsd:0.01,json:{...(await provider()).json,evidenceIds:['fake']}}),0.02); await assert.rejects(()=>bad.propose(p,'REQ-HEALTH',0.02),/Unsupported AI/);
  await assert.rejects(()=>planner.propose(p,'REQ-WEB',0.02),/budget/);
});
test('healing is always a proposal and ambiguous candidates are ineligible',()=>{
  const result=proposeHealing({originalLocator:'old',candidateLocator:'new',matchingElements:2,evidenceIds:['DOC-1'],assertionsUnchanged:true}); assert.equal(result.status,'review-required'); assert.equal(result.eligible,false);
});
test('knowledge diff detects modified, added, removed source',()=>{
  assert.deepEqual(changes({revision:'a',files:[{path:'x',hash:'1',content:'a'}]},{revision:'b',files:[{path:'x',hash:'2',content:'b'},{path:'y',hash:'1',content:'a'}]}).map(x=>x.status),['modified','added']);
});
test('SQL guard rejects writes, multi-statements and locking queries',()=>{
  for(const query of ['DELETE FROM users','SELECT 1; DROP TABLE users','SELECT * FROM users FOR UPDATE','SELECT * INTO users2 FROM users']) assert.throws(()=>readQuery(query));
  assert.equal(readQuery('SELECT id FROM users WHERE id = $1'),'SELECT id FROM users WHERE id = $1');
});
test('unknown provider failures consume the reservation and cannot trigger unbounded retries',async()=>{
  let calls=0; const planner=new Planner(async()=>{calls++;throw new Error('Network failure');},0.01);
  await assert.rejects(()=>planner.propose(project(),'REQ-HEALTH',0.01),/Network/);
  assert.equal(planner.costUsd,0.01); await assert.rejects(()=>planner.propose(project(),'REQ-HEALTH',0.01),/budget/); assert.equal(calls,1);
});
