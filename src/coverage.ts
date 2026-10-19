import { isHealed } from "./model.js";
import { isReviewCurrent } from './identity.js';
import type { Project, Result, TestCase } from './model.js';
export const hasAutomation=(t:TestCase)=>t.status==='approved'&&!t.blockedBy.length&&t.steps.length>0&&t.steps.some(s=>s.assertions.length>0);
export function coverage(p: Project, results: Result[] = []) {
  const passed=(id:string)=>{const matching=results.filter(x=>x.id===id);return matching.length===1&&matching[0]!.status==='passed'&&!matching[0]!.flaky&&!isHealed(matching[0]!);};
  const rows = p.requirements.map(r => {
    const tests = p.tests.filter(t=>t.requirementIds.includes(r.id));
    const approved = tests.filter(t=>t.status==='approved');
    const automated = tests.filter(hasAutomation);
    const gaps: string[] = [];
    const reviewed=approved.length>0&&approved.every(t=>isReviewCurrent(p,t));
    if (!reviewed) gaps.push('missing-qe-review');
    if(tests.some(t=>results.some(r=>r.id===t.id&&isHealed(r))))gaps.push('healing-review-required');
    if (!approved.length) gaps.push('no-approved-test');
    if (!automated.length) gaps.push('missing-asserted-automation');
    if (tests.some(t=>t.blockedBy.length)) gaps.push('blocker');
    const criteria=r.criteria.map(c=>{const mapped=automated.filter(t=>t.covers[r.id]?.includes(c.id));return {id:c.id,title:c.title,automated:mapped.map(t=>t.id),proven:mapped.length>0&&mapped.every(t=>passed(t.id)&&isReviewCurrent(p,t))};});
    if(criteria.some(c=>!c.automated.length)) gaps.push('uncovered-acceptance-criteria');
    // One happy-path pass cannot hide a missing, failed or flaky sibling test.
    const executed=automated.length>0&&approved.every(t=>hasAutomation(t)&&passed(t.id))&&!tests.some(t=>t.blockedBy.length);
    const proven=executed&&reviewed&&criteria.every(c=>c.proven);
    return { requirementId:r.id, risk:r.risk, tests:tests.map(t=>t.id), automated:automated.map(t=>t.id), criteria, reviewed, executed, proven, gaps };
  });
  const weights = { critical:5, high:3, medium:2, low:1 };
  const total = rows.reduce((n,r)=>n+weights[r.risk],0);
  return { scope:'Declared requirements and acceptance criteria only; mappings and passing checks do not prove application completeness.', rows,
    riskWeightedAutomation: total ? rows.reduce((n,r)=>n+(r.automated.length&&r.criteria.every(c=>c.automated.length)?weights[r.risk]:0),0)/total : 0,
    riskWeightedProven: total ? rows.reduce((n,r)=>n+(r.proven?weights[r.risk]:0),0)/total : 0,
    duplicateCandidates: p.tests.flatMap((t,i)=>p.tests.slice(i+1).filter(u=>JSON.stringify(t.steps)===JSON.stringify(u.steps) && t.steps.length>0).map(u=>[t.id,u.id])) };
}
