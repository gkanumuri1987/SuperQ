import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Registry,run } from '../src/runner.js';
import { validateProject } from '../src/model.js';
const raw=JSON.parse(await readFile('examples/project.json','utf8'));
test('saved response variables chain steps, stay private and are scoped to each attempt',async()=>{
  const p=validateProject(raw);p.tests=[p.tests[0]!];p.tests[0]!.steps=[{action:'health-request',input:{path:'/create'},assertions:[{path:'status',operator:'equals',expected:201}],save:{createdId:'body.id'}},{action:'health-request',input:{path:'/entities/${createdId}'},assertions:[{path:'body.id',operator:'equals',expected:'${createdId}'}],save:{}}];
  const seen:string[]=[];const registry=new Registry().register('api:request',async input=>{seen.push(String(input.path));return input.path==='/create'?{status:201,body:{id:'private-entity-id'}}:{status:200,body:{id:'private-entity-id'}};});
  const r=await run(p,'local','smoke',registry);assert.equal(r[0]!.status,'passed');assert.deepEqual(seen,['/create','/entities/private-entity-id']);assert.ok(!JSON.stringify(r).includes('private-entity-id'));
  p.tests[0]!.steps[0]!.save={createdId:'body.missing'};assert.equal((await run(p,'local','smoke',registry))[0]!.status,'failed');
});
test('step timeout aborts cooperative handlers, prevents retries and stops queued work',async()=>{
  const p=validateProject(raw);p.tests=[p.tests[0]!,{...structuredClone(p.tests[0]!),id:'TC-queued'}];let calls=0,aborted=false;
  const registry=new Registry().register('api:request',async(_input,ctx)=>{calls++;ctx.signal!.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});});
  const r=await run(p,'local','smoke',registry,{workers:1,retries:3,stepTimeoutMs:20});assert.equal(calls,1);assert.equal(aborted,true);assert.equal(r[0]!.status,'failed');assert.equal(r[0]!.attempts![0]!.failureKind,'timeout');assert.equal(r[1]!.status,'skipped');
});
test('validation rejects reserved response variables, unknown criteria and credential-bearing URLs',()=>{
  const p=structuredClone(raw);p.tests[0].steps[0].save={'superq.runId':'body.id'};assert.throws(()=>validateProject(p),/Unsafe saved variable/);
  const q=structuredClone(raw);q.tests[0].covers={'REQ-HEALTH':['invented']};assert.throws(()=>validateProject(q),/Unknown criterion/);
  const r=structuredClone(raw);r.environments.local.baseURL='https://user:password@example.invalid';assert.throws(()=>validateProject(r),/embedded credentials/);
});
test('parallel tests receive isolated nested data instead of mutating shared fixtures',async()=>{
  const p=validateProject(raw);p.data={fixture:{counter:0}};p.tests=[p.tests[0]!,{...structuredClone(p.tests[0]!),id:'TC-independent'}];
  const seen:number[]=[];const registry=new Registry().register('api:request',async(_input,ctx)=>{const fixture=ctx.data.fixture as {counter:number};seen.push(fixture.counter);fixture.counter++;return {status:200,body:{status:'ok'}};});
  const r=await run(p,'local','smoke',registry,{workers:2});assert.ok(r.every(t=>t.status==='passed'));assert.deepEqual(seen,[0,0]);assert.equal((p.data.fixture as {counter:number}).counter,0);
});
