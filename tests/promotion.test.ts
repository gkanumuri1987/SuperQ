import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateProject } from '../src/model.js';
import { createReport } from '../src/reporting.js';
import { assessPromotion } from '../src/promotion.js';
import { reviewFingerprint } from '../src/identity.js';
import { coverage } from '../src/coverage.js';
import { audit } from '../src/audit.js';
const raw=JSON.parse(await readFile('examples/project.json','utf8'));
const revision='a'.repeat(40),automation='b'.repeat(40),artifactDigest=`sha256:${'c'.repeat(64)}`;
function fixture(){
  const now=new Date();const at=(minutes:number)=>new Date(now.getTime()-minutes*60000).toISOString();
  const source=structuredClone(raw);source.tests=[source.tests[0]];source.requirements=[source.requirements[0]];
  source.requirements[0].criteria=[{id:'AC-1',title:'Response status and contract are correct'}];
  source.tests[0].covers={'REQ-HEALTH':['AC-1']};source.evidence[0].applicationRevision=revision;
  source.release={environment:'local',requiredSuites:['smoke'],requiredProfiles:['local'],requiredChecks:['security','rollback']};
  const p=validateProject(source);p.tests[0]!.review={reviewer:'QE reviewer',at:at(60),digest:reviewFingerprint(p,p.tests[0]!)};
  const report=createReport(p,'local','smoke',[{profile:'local',provider:'local',browser:'chromium',results:[{id:'TC-API',status:'passed',durationMs:3,attempts:[{number:1,status:'passed',durationMs:3}]}]}],{applicationRevision:revision,artifactDigest,automationRevision:automation,automationDirty:false,startedAt:at(30)});report.at=at(5);
  const manifest={applicationRevision:revision,artifactDigest,reports:['report.json'],checks:['security','rollback'].map(id=>({id,status:'passed',applicationRevision:revision,artifactDigest,evidence:`https://ci.example.invalid/${id}`,checkedAt:at(10)})),approvals:[{reviewer:'Quality lead',role:'qe',decision:'approved',applicationRevision:revision,artifactDigest,at:at(1)},{reviewer:'Release owner',role:'release-owner',decision:'approved',applicationRevision:revision,artifactDigest,at:at(1)}]};
  return {p,report,manifest,now};
}
test('complete current reviewed evidence is eligible for human review, never certified',()=>{
  const f=fixture();const r=assessPromotion(f.p,f.manifest,[f.report],f.now);assert.equal(r.decision,'eligible-for-human-review',r.reasons.join('; '));assert.equal(r.certified,false);assert.equal(r.reportDigests.length,1);
});
test('promotion fails closed on missing policy/provenance, dirty automation, stale reports and partial selections',()=>{
  for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.p.release=undefined;},(f:ReturnType<typeof fixture>)=>{delete f.report.provenance.applicationRevision;},(f:ReturnType<typeof fixture>)=>{f.report.provenance.automationDirty=true;},(f:ReturnType<typeof fixture>)=>{f.report.at='2020-01-01T00:00:00Z';},(f:ReturnType<typeof fixture>)=>{f.report.execution.testIds=['TC-API'];}]){
    const f=fixture();mutate(f);assert.equal(assessPromotion(f.p,f.manifest,[f.report],f.now).decision,'blocked');
  }
});
test('promotion rejects missing matrix results, duplicate tests, flaky passes and forged summary percentages',()=>{
  const mutations=[(f:ReturnType<typeof fixture>)=>{f.report.runs[0]!.results=[];},(f:ReturnType<typeof fixture>)=>{f.report.runs[0]!.results.push({...f.report.runs[0]!.results[0]!});},(f:ReturnType<typeof fixture>)=>{f.report.runs[0]!.results[0]!.flaky=true;},(f:ReturnType<typeof fixture>)=>{f.report.runs[0]!.results[0]!.status='failed';f.report.summary.failed=0;f.report.gates=[];f.report.coverage.riskWeightedProven=1;}];
  for(const mutate of mutations){const f=fixture();mutate(f);assert.equal(assessPromotion(f.p,f.manifest,[f.report],f.now).decision,'blocked');}
});
test('promotion requires exact artifact, fresh external checks and independent release approvals',()=>{
  const mutations=[(f:ReturnType<typeof fixture>)=>{f.manifest.artifactDigest=`sha256:${'d'.repeat(64)}`;},(f:ReturnType<typeof fixture>)=>{f.manifest.checks=[];},(f:ReturnType<typeof fixture>)=>{f.manifest.checks[0]!.status='failed';},(f:ReturnType<typeof fixture>)=>{f.manifest.approvals[1]!.reviewer=f.manifest.approvals[0]!.reviewer;},(f:ReturnType<typeof fixture>)=>{f.manifest.approvals[0]!.decision='rejected';}];
  for(const mutate of mutations){const f=fixture();mutate(f);assert.equal(assessPromotion(f.p,f.manifest,[f.report],f.now).decision,'blocked');}
});
test('changing an assertion or its source evidence invalidates the prior test review',()=>{
  const f=fixture();f.p.tests[0]!.steps[0]!.assertions[0]!.expected=500;assert.ok(audit(f.p).findings.some(x=>x.id==='review-integrity'));
  const g=fixture();g.p.evidence[0]!.excerpt='Changed expected behavior';assert.ok(audit(g.p).findings.some(x=>x.id==='review-integrity'));
});
test('one passing case cannot conceal failed linked cases or uncovered acceptance criteria',()=>{
  const f=fixture();const sibling=structuredClone(f.p.tests[0]!);sibling.id='TC-negative';f.p.tests.push(sibling);
  assert.equal(coverage(f.p,[{id:'TC-API',status:'passed',durationMs:1},{id:'TC-negative',status:'failed',durationMs:1}]).rows[0]!.proven,false);
  f.p.requirements[0]!.criteria.push({id:'AC-missing',title:'Negative authorization rules'});const report=coverage(f.p);assert.ok(report.rows[0]!.gaps.includes('uncovered-acceptance-criteria'));assert.equal(report.riskWeightedAutomation,0);
});
test('promotion rejects the wrong environment, stale approvals and incorrect browser identity',()=>{
  for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.report.environment='another-environment';},(f:ReturnType<typeof fixture>)=>{f.manifest.approvals[0]!.at=new Date(f.now.getTime()-3600000).toISOString();},(f:ReturnType<typeof fixture>)=>{f.report.runs[0]!.browser='firefox';}]){const f=fixture();mutate(f);assert.equal(assessPromotion(f.p,f.manifest,[f.report],f.now).decision,'blocked');}
});
