import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { snapshot } from '../src/knowledge.js';
test('snapshot reads committed evidence, rejects untracked secrets and does not modify source',async()=>{
  const repo=await mkdtemp(join(tmpdir(),'superq-'));
  const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{stdio:'pipe'});
  try {
    git('init'); git('config','user.name','SuperQ test'); git('config','user.email','test@example.invalid');
    await writeFile(join(repo,'contract.md'),'committed'); git('add','contract.md'); git('commit','-m','fixture');
    await writeFile(join(repo,'contract.md'),'uncommitted');
    const result=await snapshot(repo,['contract.md']); assert.equal(result.files[0]!.content,'committed');
    await assert.rejects(()=>snapshot(repo,['.env']),/Unsafe/); await assert.rejects(()=>snapshot(repo,['../contract.md']),/Unsafe/);
  } finally {await rm(repo,{recursive:true,force:true});}
});
