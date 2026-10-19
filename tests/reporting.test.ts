import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateProject } from '../src/model.js';
import { createReport, html, junit, markdown, writeReports } from '../src/reporting.js';
const raw=JSON.parse(await readFile('examples/project.json','utf8'));
test('proven coverage requires all requested profiles to pass and quality gates catch gaps',()=>{
  const p=validateProject(raw);p.reporting.minimumProven=0.9;p.reporting.failOnCriticalGaps=true;
  const r=createReport(p,'local','smoke',[{profile:'chrome',provider:'local',browser:'chrome',results:[{id:'TC-API',status:'passed',durationMs:1}]},{profile:'firefox',provider:'local',browser:'firefox',results:[{id:'TC-API',status:'failed',durationMs:1}]}]);
  assert.equal(r.coverage.rows[0]!.proven,false);assert.ok(r.gates.includes('Proven coverage below threshold'));assert.equal(r.summary.failed,1);
});
test('flaky passing results fail default gates and JUnit; empty runs cannot pass',()=>{
  const p=validateProject(raw);const r=createReport(p,'local','smoke',[{profile:'local',provider:'local',browser:'chromium',results:[{id:'TC-API',status:'passed',durationMs:1,flaky:true}]}]);
  assert.ok(r.gates.includes('Flaky tests detected'));assert.match(junit(r),/Flaky test: failed attempt retained/);assert.match(junit(r),/SuperQ quality gates/);
  assert.ok(createReport(p,'local','smoke',[]).gates.includes('No tests executed'));
});
test('HTML and XML escape application strings, expose report views and write all requested formats',async()=>{
  const p=validateProject(raw);p.name='</title><script>alert("x")</script>&';const report=createReport(p,'local','smoke',[{profile:'<bad>',provider:'local',browser:'chromium',results:[{id:'TC-API',status:'blocked',reason:'<secret>&"',durationMs:1}]}]);
  const page=html(report);assert.ok(!page.includes('</title><script>alert'));assert.match(page,/&lt;script&gt;/);assert.match(page,/Browser matrix/);assert.match(page,/Requirements and coverage/);assert.match(junit(report),/&lt;secret&gt;&amp;&quot;/);assert.match(markdown(report),/&lt;script>/);
  const directory=await mkdtemp(join(tmpdir(),'superq-report-'));try{await writeReports(report,['json','html','junit','markdown'],directory);assert.equal(JSON.parse(await readFile(join(directory,'report.json'),'utf8')).runId,report.runId);assert.match(await readFile(join(directory,'junit.xml'),'utf8'),/<testsuites>/);}finally{await rm(directory,{recursive:true,force:true});}
});
