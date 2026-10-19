import { coverage, hasAutomation } from './coverage.js';
import { isReviewCurrent } from './identity.js';
import type { Project } from './model.js';
export function audit(p:Project){
  const findings:{severity:'high'|'medium';id:string;subject:string;message:string}[]=[];
  const add=(severity:'high'|'medium',id:string,subject:string,message:string)=>findings.push({severity,id,subject,message});
  for(const r of p.requirements){if(!r.criteria.length)add('high','acceptance-criteria',r.id,'Define independent acceptance criteria before claiming complete coverage.');}
  for(const t of p.tests){
    if(t.status==='approved'&&!isReviewCurrent(p,t))add('high','review-integrity',t.id,'Record a human review of the current test definition.');
    if(t.status==='approved'&&!hasAutomation(t))add('high','automation-blocked',t.id,'Approved case needs executable steps, meaningful assertions and no blockers.');
    if(t.blockedBy.length)add('high','blocker',t.id,t.blockedBy.join('; '));
    for(const req of t.requirementIds)if(!t.covers[req]?.length)add('medium','criterion-mapping',t.id,`Map acceptance criteria for ${req}.`);
    for(const step of t.steps){const action=p.catalog.find(a=>a.id===step.action)!;
      if(action.kind==='web'&&action.operation==='journey'){
        const commands=Array.isArray(step.input.commands)?step.input.commands:[];
        for(const c of commands)if(c&&typeof c==='object'&&'locator' in c&&typeof c.locator==='string'&&!p.locators[c.locator])add('high','missing-locator',t.id,`Unknown catalog locator ${c.locator}.`);
      }
      if(action.kind==='api'&&step.assertions.every(a=>a.path==='status'))add('medium','weak-api-oracle',t.id,'HTTP status alone may miss incorrect business data; add contract/body assertions.');
    }
  }
  if(!p.release)add('high','release-policy',p.name,'No production promotion policy is configured.');
  for(const pair of coverage(p).duplicateCandidates)add('medium','duplicate-candidate',pair.join(', '),'Review identical steps and reuse catalog/data variations.');
  return {project:p.name,productionCertified:false,summary:{high:findings.filter(f=>f.severity==='high').length,medium:findings.filter(f=>f.severity==='medium').length},findings,coverage:coverage(p),nextActions:[...new Set(findings.filter(f=>f.severity==='high').map(f=>`${f.subject}: ${f.message}`))],limitations:['Assertions and evidence must be reviewed for business correctness.','External integrations and production controls require real application validation.']};
}
