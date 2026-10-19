import type { Project, Result } from './model.js';
export function coverage(p: Project, results: Result[] = []) {
  const rows = p.requirements.map(r => {
    const tests = p.tests.filter(t=>t.requirementIds.includes(r.id));
    const approved = tests.filter(t=>t.status==='approved');
    const automated = approved.filter(t=>t.steps.length && t.steps.some(s=>s.assertions.length));
    const gaps: string[] = [];
    if (!tests.some(t=>t.origin==='qe')) gaps.push('missing-qe-review');
    if (!approved.length) gaps.push('no-approved-test');
    if (!automated.length) gaps.push('missing-asserted-automation');
    if (tests.some(t=>t.blockedBy.length)) gaps.push('blocker');
    const proven = automated.some(t=>results.find(x=>x.id===t.id)?.status==='passed');
    return { requirementId:r.id, risk:r.risk, tests:tests.map(t=>t.id), automated:automated.map(t=>t.id), proven, gaps };
  });
  const weights = { critical:5, high:3, medium:2, low:1 };
  const total = rows.reduce((n,r)=>n+weights[r.risk],0);
  return { scope:'Declared requirements only; mapping does not prove behavioral completeness.', rows,
    riskWeightedAutomation: total ? rows.reduce((n,r)=>n+(r.automated.length?weights[r.risk]:0),0)/total : 0,
    riskWeightedProven: total ? rows.reduce((n,r)=>n+(r.proven?weights[r.risk]:0),0)/total : 0,
    duplicateCandidates: p.tests.flatMap((t,i)=>p.tests.slice(i+1).filter(u=>JSON.stringify(t.steps)===JSON.stringify(u.steps) && t.steps.length>0).map(u=>[t.id,u.id])) };
}
