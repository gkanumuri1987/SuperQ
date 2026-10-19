import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { validateProject } from '../src/model.js';
import { Registry,run,selectTests } from '../src/runner.js';
import { Execution } from '../src/config.js';
const raw=JSON.parse(await readFile('examples/project.json','utf8'));
function fixture(){const p=validateProject(structuredClone(raw));const base=p.tests[0]!;p.tests=Array.from({length:6},(_,i)=>({...structuredClone(base),id:`TC-${i}`,retrySafe:false,tags:[i%2?'slow':'smoke']}));return p;}
test('parallel execution respects worker cap, starts independent work concurrently, and returns stable ordering',async()=>{
  const p=fixture();let active=0,maximum=0;const registry=new Registry().register('api:request',async()=>{active++;maximum=Math.max(maximum,active);await delay(20);active--;return {status:200,body:{status:'ok'}};});
  const results=await run(p,'local','smoke',registry,{workers:3});assert.equal(maximum,3);assert.ok(results.every(r=>r.status==='passed'));assert.deepEqual(results.map(r=>r.id),p.tests.map(t=>t.id));
});
test('shared prerequisites execute once and children wait without occupying worker slots',async()=>{
  const p=fixture();p.tests[0]!.dependsOn=['TC-5'];p.tests[1]!.dependsOn=['TC-5'];let prerequisites=0;let complete=false;
  const registry=new Registry().register('api:request',async(_i,ctx)=>{if(ctx.testId==='TC-5'){prerequisites++;await delay(10);complete=true;}else if(['TC-0','TC-1'].includes(ctx.testId!)){assert.ok(complete);}return {status:200,body:{status:'ok'}};});
  const results=await run(p,'local','smoke',registry,{workers:2,testIds:['TC-0','TC-1']});assert.equal(prerequisites,1);assert.equal(results.length,3);assert.ok(results.every(r=>r.status==='passed'));assert.equal(results.find(r=>r.id==='TC-5')!.dependency,true);
});
test('retries preserve original assertion failure and require per-test retry safety',async()=>{
  const p=fixture();p.tests=[p.tests[0]!];let calls=0;const registry=new Registry().register('api:request',async()=>({status:++calls===1?500:200,body:{status:'ok'}}));
  let result=(await run(p,'local','smoke',registry,{retries:1}))[0]!;assert.equal(result.status,'failed');assert.equal(calls,1);
  p.tests[0]!.retrySafe=true;calls=0;result=(await run(p,'local','smoke',registry,{retries:1}))[0]!;assert.equal(result.status,'passed');assert.equal(result.flaky,true);assert.deepEqual(result.attempts!.map(a=>a.status),['failed','passed']);assert.equal(result.attempts![0]!.failureKind,'assertion');
});
test('max failure gate stops queued work and handles reversed prerequisite order',async()=>{
  const p=fixture();p.tests[1]!.dependsOn=['TC-5'];let calls=0;const registry=new Registry().register('api:request',async()=>{calls++;throw new Error('fixture failure');});
  const results=await run(p,'local','smoke',registry,{workers:1,maxFailures:1});assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='skipped').length,5);
});
test('tag filters and shards partition roots while always including prerequisites',()=>{
  const p=fixture();const opts=Execution.parse({includeTags:['smoke']});assert.equal(selectTests(p,'smoke',opts).roots.length,3);
  const a=selectTests(p,'smoke',Execution.parse({shard:{index:1,total:2}})).roots;
  const b=selectTests(p,'smoke',Execution.parse({shard:{index:2,total:2}})).roots;
  assert.equal(a.filter(x=>b.includes(x)).length,0);assert.equal(new Set([...a,...b]).size,6);
  p.tests[0]!.dependsOn=['TC-1'];const selected=selectTests(p,'smoke',Execution.parse({testIds:['TC-0'],excludeTags:['slow']}));assert.deepEqual(selected.tests.map(t=>t.id),['TC-0','TC-1']);
  assert.throws(()=>Execution.parse({shard:{index:3,total:2}}));assert.throws(()=>selectTests(p,'smoke',Execution.parse({testIds:['unknown']})));
});
