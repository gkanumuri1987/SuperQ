import test from 'node:test';
import assert from 'node:assert/strict';
import { readJiraIssue, readAdoWorkItem } from '../src/connectors.js';
test('Jira and ADO readers normalize revisions without inventing executable tests',async()=>{
  const original=globalThis.fetch; const calls:string[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=String(input); calls.push(url); assert.equal(init?.redirect,'error'); assert.ok(new Headers(init?.headers).has('authorization'));
    return Response.json(url.includes('atlassian')?{key:'QE-1',fields:{summary:'Health',description:{type:'doc'},updated:'2026-10-19'}}:{id:1,rev:3,fields:{'System.Title':'Health','Microsoft.VSTS.TCM.Steps':'<steps />'}});
  };
  try {
    const jira=await readJiraIssue('https://example.atlassian.net','QE-1','qe@example.invalid','fixture'); assert.equal(jira.revision,'2026-10-19'); assert.deepEqual(jira.description,{type:'doc'});
    const ado=await readAdoWorkItem('example','QE',1,'fixture'); assert.equal(ado.revision,'3'); assert.equal(ado.description,'<steps />'); assert.equal(calls.length,2);
    await assert.rejects(()=>readJiraIssue('http://example.atlassian.net','QE-1','qe','fixture'),/HTTPS/);
    await assert.rejects(()=>readAdoWorkItem('../other','QE',1,'fixture'),/Invalid/);
  } finally {globalThis.fetch=original;}
});
