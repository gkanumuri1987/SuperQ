import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function cli(args:string[],env:NodeJS.ProcessEnv=process.env){return spawnSync(process.execPath,['--import','tsx','src/cli.ts',...args],{encoding:'utf8',env});}
test('init creates a valid starter without overwriting user work',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'superq-init-'));const file=join(dir,'project.json');
  try{assert.equal(cli(['init',file]).status,0);const content=await readFile(file,'utf8');assert.equal(cli(['init',file]).status,1);assert.equal(await readFile(file,'utf8'),content);assert.equal(cli(['validate',file]).status,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test('plan resolves matrix and selections without launching cloud or exposing credentials',()=>{
  const result=cli(['plan','examples/project.cloud.json','local','regression','--profiles','bs-chrome,lt-edge','--workers','2']);assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);assert.equal(plan.profiles.length,2);assert.equal(plan.workers,2);assert.ok(plan.estimatedMaximumBrowserSessions>0);assert.ok(!result.stdout.includes('accessKey'));
  assert.equal(cli(['plan','examples/project.cloud.json','local','browser','--profiles','bs-chrome','--workers','3']).status,1);
  assert.equal(cli(['plan','examples/project.json','local','browser','--workers','0']).status,1);
  assert.equal(cli(['plan','examples/project.json','local','browser','--tags','does-not-exist']).status,1);
});
test('doctor reports credential names without secrets and does not start a paid session',()=>{
  const env={...process.env};delete env.BROWSERSTACK_USERNAME;delete env.BROWSERSTACK_ACCESS_KEY;
  const result=cli(['doctor','examples/project.cloud.json','--profiles','bs-chrome'],env);assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout).checks[0].missingCredentialNames,['BROWSERSTACK_USERNAME','BROWSERSTACK_ACCESS_KEY']);
});
test('audit exposes review drift and promotion exits nonzero without a policy',async()=>{
  const {writeFile}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'superq-readiness-'));const project=join(dir,'project.json');
  try{
    assert.equal(cli(['init',project]).status,0);
    assert.equal(cli(['review-test',project,'TC-API','--reviewer','Fixture reviewer']).status,0);
    let result=cli(['audit',project]);assert.equal(result.status,1);let findings=JSON.parse(result.stdout).findings;assert.ok(!findings.some((f:{id:string;subject:string})=>f.id==='review-integrity'&&f.subject==='TC-API'));
    const changed=JSON.parse(await readFile(project,'utf8'));changed.tests[0].steps[0].assertions[0].expected=500;await writeFile(project,JSON.stringify(changed));
    result=cli(['audit',project]);findings=JSON.parse(result.stdout).findings;assert.ok(findings.some((f:{id:string;subject:string})=>f.id==='review-integrity'&&f.subject==='TC-API'));
    await writeFile(join(dir,'report.json'),'{}');await writeFile(join(dir,'manifest.json'),JSON.stringify({applicationRevision:'a'.repeat(40),artifactDigest:`sha256:${'b'.repeat(64)}`,reports:['report.json'],checks:[],approvals:[]}));
    result=cli(['promote',project,join(dir,'manifest.json'),'--output',join(dir,'results')]);assert.equal(result.status,1);const decision=JSON.parse(result.stdout);assert.equal(decision.decision,'blocked');assert.equal(decision.certified,false);assert.ok(decision.reasons.includes('No release policy configured'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
