import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Project, TestCase } from './model.js';
export function canonical(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}
export function projectFingerprint(p:Project){const {execution:_,reporting:__,...content}=p;return createHash('sha256').update(canonical({...content,...(_.user?{executionIdentity:{user:_.user}}:{})})).digest('hex');}
export function automationIdentity(repo=fileURLToPath(new URL('..',import.meta.url))) {
  try{const git=(args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();return {automationRevision:git(['rev-parse','HEAD']),automationDirty:git(['status','--porcelain']).length>0};}
  catch{return {automationRevision:null,automationDirty:true};}
}


export function reviewFingerprint(p:Project,t:TestCase){
  const {review:_,...test}=t;
  const requirements=p.requirements.filter(r=>t.requirementIds.includes(r.id));
  const evidenceIds=new Set([...t.evidenceIds,...requirements.flatMap(r=>r.evidenceIds)]);
  const setupIds=[...new Set(t.steps.flatMap(s=>Array.isArray(s.input.setupIds)?s.input.setupIds as string[]:[]))];
  const setups=setupIds.map(id=>({id,definition:p.webSetups?.[id],locators:p.webSetups?.[id]?.commands.flatMap(c=>'locator' in c?[p.locators[c.locator]]:[])}));
  return createHash('sha256').update(canonical({test,requirements,...(setups.length?{setups}:{}),evidence:p.evidence.filter(e=>evidenceIds.has(e.id))})).digest('hex');
}

export function isReviewCurrent(p:Project,t:TestCase){return Boolean(t.review&&t.review.digest===reviewFingerprint(p,t));}
