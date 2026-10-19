import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ollamaProvider } from '../src/ollama.js';
import { Planner } from '../src/ai.js';
import { validateProject } from '../src/model.js';
const proposal={summary:'Verify contract',requirementId:'REQ-HEALTH',evidenceIds:['DOC-1'],actionIds:['health-request'],questions:[],steps:['Check the documented health response']};
test('Ollama sends bounded structured prompts to loopback and keeps output a reviewed draft',async()=>{
  const p=validateProject(JSON.parse(await readFile('examples/project.json','utf8')));
  const provider=ollamaProvider('fixture-local',undefined,async(url,options)=>{assert.equal(String(url),'http://127.0.0.1:11434/api/generate');assert.equal(options?.redirect,'error');const body=JSON.parse(String(options?.body));assert.equal(body.stream,false);assert.equal(body.options.num_predict,2000);assert.equal(body.format.type,'object');return Response.json({done:true,done_reason:'stop',response:JSON.stringify(proposal)});});
  const plan=await new Planner(provider,0.01).propose(p,'REQ-HEALTH',0.01);assert.equal(plan.requirementId,'REQ-HEALTH');assert.equal(p.tests.length,3);
});
test('Ollama rejects remote endpoints, cloud model names, incomplete or unsupported responses',async()=>{
  assert.throws(()=>ollamaProvider('fixture','https://example.com'),/loopback/);assert.throws(()=>ollamaProvider('some-model:cloud'),/local model/);
  const incomplete=ollamaProvider('fixture',undefined,async()=>Response.json({done:true,done_reason:'length',response:'{}'}));await assert.rejects(()=>incomplete({prompt:'test',maxOutputTokens:10}),/truncated/);
  const p=validateProject(JSON.parse(await readFile('examples/project.json','utf8')));const fake=ollamaProvider('fixture',undefined,async()=>Response.json({done:true,response:JSON.stringify({...proposal,evidenceIds:['invented']})}));await assert.rejects(()=>new Planner(fake,0.01).propose(p,'REQ-HEALTH',0.01),/Unsupported AI/);
});
