import { z } from 'zod';
import { createHash } from 'node:crypto';
import { isHealed, ResultSchema, type Project } from './model.js';
import { Execution } from './config.js';
import { Revision, ArtifactDigest, PromotionManifest } from './release-policy.js';
import { projectFingerprint, isReviewCurrent, canonical } from './identity.js';
import { coverage, hasAutomation } from './coverage.js';
const RunEvidence=z.object({schemaVersion:z.literal(2),project:z.string(),runId:z.uuid(),environment:z.string(),suite:z.string(),at:z.iso.datetime(),
  provenance:z.object({applicationRevision:Revision,artifactDigest:ArtifactDigest,automationRevision:Revision,automationDirty:z.literal(false),startedAt:z.iso.datetime(),projectFingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  execution:Execution,runs:z.array(z.object({profile:z.string(),provider:z.string(),browser:z.string(),results:z.array(ResultSchema)}).strict()).min(1),
}).passthrough();
export function assessPromotion(p:Project,rawManifest:unknown,rawReports:unknown[],now=new Date()) {
  const manifest=PromotionManifest.parse(rawManifest);const reasons:string[]=[];const observations:string[]=[];
  const policy=p.release;
  const finish=()=>({schemaVersion:1,decision:reasons.length?'blocked':'eligible-for-human-review',certified:false,applicationRevision:manifest.applicationRevision,artifactDigest:manifest.artifactDigest,assessedAt:now.toISOString(),reasons:[...new Set(reasons)],observations,manifestDigest:createHash('sha256').update(canonical(manifest)).digest('hex'),reportDigests:rawReports.map(r=>createHash('sha256').update(canonical(r)).digest('hex')),scope:'Evidence-based promotion assessment. Inputs are attestations, not cryptographically verified deployment proof. No deployment is performed.'});
  if(!policy){reasons.push('No release policy configured');return finish();}
  if(manifest.reports.length!==rawReports.length){reasons.push('Report count does not match manifest');return finish();}
  function fresh(timestamp:string,label:string){const age=now.getTime()-Date.parse(timestamp);if(age< -300_000||age>policy!.maxAgeHours*3_600_000)reasons.push(`${label}: stale or future evidence`);}
  const reports: z.infer<typeof RunEvidence>[]=[];
  for(const raw of rawReports){const parsed=RunEvidence.safeParse(raw);if(!parsed.success){reasons.push('Invalid report: missing or invalid immutable provenance');continue;}const r=parsed.data;reports.push(r);
    if(r.project!==p.name||r.provenance.projectFingerprint!==projectFingerprint(p)) reasons.push(`Report ${r.runId}: project configuration changed`);
    if(r.provenance.applicationRevision!==manifest.applicationRevision||r.provenance.artifactDigest!==manifest.artifactDigest)reasons.push(`Report ${r.runId}: application build mismatch`);
    fresh(r.at,`Report ${r.runId}`);fresh(r.provenance.startedAt,`Run ${r.runId}`);
    if(Date.parse(r.at)<Date.parse(r.provenance.startedAt))reasons.push(`Report ${r.runId}: completion precedes start`);
    if(r.execution.shard||r.execution.testIds.length||r.execution.includeTags.length||r.execution.excludeTags.length)reasons.push(`Report ${r.runId}: partial test selection cannot authorize promotion`);
    if(r.environment!==policy.environment)reasons.push(`Report ${r.runId}: wrong release test environment`);
    if(!Object.hasOwn(p.environments,r.environment))reasons.push(`Report ${r.runId}: unknown environment`);
    if(new Set(r.runs.map(x=>x.profile)).size!==r.runs.length)reasons.push(`Report ${r.runId}: duplicate profiles`);
  }
  if(new Set(reports.map(r=>r.runId)).size!==reports.length)reasons.push('Duplicate report run IDs');
  if(new Set(reports.map(r=>r.provenance.automationRevision)).size>1)reasons.push('Reports use different automation revisions');
  if(new Set(reports.map(r=>r.environment)).size>1)reasons.push('Reports use different test environments');
  const included=new Set<string>();const outcomes=new Map<string,boolean[]>();
  const record=(id:string,passed:boolean)=>outcomes.set(id,[...(outcomes.get(id)??[]),passed]);
  for(const suite of policy.requiredSuites){
    const ids=new Set<string>();function add(id:string){if(ids.has(id))return;ids.add(id);p.tests.find(t=>t.id===id)!.dependsOn.forEach(add);}
    p.tests.filter(t=>t.suites.includes(suite)).forEach(t=>add(t.id));if(!ids.size)reasons.push(`Required suite ${suite} has no tests`);
    for(const id of ids)included.add(id);
    for(const profile of policy.requiredProfiles){
      const candidates=reports.filter(r=>r.suite===suite).flatMap(report=>report.runs.filter(run=>run.profile===profile).map(run=>({report,run})));
      if(candidates.length!==1){reasons.push(`${suite}/${profile}: exactly one complete run required`);for(const id of ids)record(id,false);continue;}
      const {run}=candidates[0]!;const config=p.browsers[profile]!;
      if(run.provider!==config.provider||run.browser!==config.browser)reasons.push(`${suite}/${profile}: browser configuration mismatch`);
      const resultIds=run.results.map(r=>r.id);if(new Set(resultIds).size!==resultIds.length||resultIds.length!==ids.size||resultIds.some(id=>!ids.has(id)))reasons.push(`${suite}/${profile}: missing, duplicate or unexpected tests`);
      for(const id of ids){const test=p.tests.find(t=>t.id===id)!;const result=run.results.find(r=>r.id===id);
        if(!test.evidenceIds.every(id=>p.evidence.some(e=>e.id===id&&(e.applicationRevision===manifest.applicationRevision||e.revision===manifest.applicationRevision))))reasons.push(`${id}: test evidence not reviewed for application build`);
        if(!hasAutomation(test)||!test.review)reasons.push(`${id}: approved reviewed assertion-bearing automation required`);
        if(test.review){if(!isReviewCurrent(p,test))reasons.push(`${id}: test changed since review or review digest is missing`);if(Date.parse(test.review.at)>Date.parse(candidates[0]!.report.provenance.startedAt))reasons.push(`${id}: review occurred after execution started`);}
        record(id,result?.status==='passed'&&!result.flaky&&!isHealed(result));
        if(!result||result.status!=='passed'||result.flaky||isHealed(result))reasons.push(`${suite}/${profile}/${id}: clean passing result required`);
        const attempts=result?.attempts;
        if(!attempts?.length||attempts.length!==1||attempts[0]?.number!==1||attempts[0]?.status!=='passed')reasons.push(`${suite}/${profile}/${id}: exactly one successful attempt required`);
      }
    }
  }
  for(const r of p.requirements){
    if(!r.criteria.length)reasons.push(`${r.id}: explicit acceptance criteria required`);
    if(!r.evidenceIds.every(id=>p.evidence.some(e=>e.id===id&&(e.applicationRevision===manifest.applicationRevision||e.revision===manifest.applicationRevision))))reasons.push(`${r.id}: evidence must be reviewed at the application revision`);
    for(const c of r.criteria){const tests=p.tests.filter(t=>t.covers[r.id]?.includes(c.id));if(!tests.length||!tests.some(t=>included.has(t.id)&&hasAutomation(t)&&t.review))reasons.push(`${r.id}/${c.id}: reviewed release-suite automation missing`);}
  }
  // Recompute coverage from validated required suite/profile results. Never trust
  // report-supplied summary, percentage or gate fields.
  const consolidated=[...included].map(id=>({id,status:outcomes.get(id)?.length&&outcomes.get(id)!.every(Boolean)?'passed' as const:'failed' as const,durationMs:0}));
  const c=coverage(p,consolidated);
  if(c.riskWeightedAutomation<policy.minimumAutomation)reasons.push('Release automation coverage below policy');
  if(c.riskWeightedProven<policy.minimumProven)reasons.push('Release proven coverage below policy');
  if(c.rows.some(r=>r.gaps.length))reasons.push('Unresolved requirement coverage or review gaps');
  for(const check of policy.requiredChecks){const matches=manifest.checks.filter(c=>c.id===check);if(matches.length!==1){reasons.push(`${check}: exactly one external check required`);continue;}const item=matches[0]!;if(item.status!=='passed'||item.applicationRevision!==manifest.applicationRevision||item.artifactDigest!==manifest.artifactDigest)reasons.push(`${check}: passing evidence for this build required`);fresh(item.checkedAt,check);}
  const latestEvidence=Math.max(...reports.map(r=>Date.parse(r.at)),...manifest.checks.map(c=>Date.parse(c.checkedAt)));
  const reviewers=new Set<string>();
  for(const role of policy.requiredApprovalRoles){const matches=manifest.approvals.filter(a=>a.role===role);if(matches.length!==1){reasons.push(`${role}: exactly one approval required`);continue;}const a=matches[0]!;if(a.decision!=='approved'||a.applicationRevision!==manifest.applicationRevision||a.artifactDigest!==manifest.artifactDigest)reasons.push(`${role}: approval for this build required`);if(reviewers.has(a.reviewer))reasons.push('Separate release approval roles require different reviewers');reviewers.add(a.reviewer);fresh(a.at,`Approval ${role}`);if(Date.parse(a.at)<latestEvidence)reasons.push(`${role}: approval predates completed release evidence`);}
  if(manifest.approvals.some(a=>a.decision==='rejected'))reasons.push('A release approval was rejected');
  observations.push(`Coverage recomputed: automation ${(c.riskWeightedAutomation*100).toFixed(1)}%, proven ${(c.riskWeightedProven*100).toFixed(1)}%.`);
  return finish();
}
