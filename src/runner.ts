import assert from 'node:assert/strict';
import type { Project, Result, Step, Assertion, Attempt } from './model.js';
import { createHash, randomUUID } from 'node:crypto';
import { Execution } from './config.js';
export type Context = { project: Project; baseURL: string; data: Record<string,unknown>; testId?: string; attempt?: number };
export type Handler = (input: Record<string,unknown>, context: Context) => Promise<unknown>;
export class Registry {
  private handlers = new Map<string,Handler>();
  register(operation: string, handler: Handler) { if(this.handlers.has(operation)) throw new Error(`Duplicate handler ${operation}`); this.handlers.set(operation,handler); return this; }
  get(operation: string) { const h=this.handlers.get(operation); if(!h) throw new Error(`No handler for ${operation}`); return h; }
}
export function resolveData(p: Project, env: string, suite: string, testData: Record<string,unknown>) {
  if(!p.environments[env] || !p.suites[suite]) throw new Error('Unknown environment or suite');
  // Deliberately shallow: an object override replaces the entire object.
  return {...p.data,...p.environments[env].data,...p.suites[suite].data,...testData};
}
export function interpolate(value: unknown, data: Record<string,unknown>): unknown {
  if(typeof value==='string') {
    const exact=/^\$\{([\w.-]+)\}$/.exec(value);
    const lookup=(key:string)=>{ if(!Object.hasOwn(data,key)) throw new Error(`Missing data ${key}`); return data[key]; };
    if(exact) return lookup(exact[1]!);
    return value.replace(/\$\{([\w.-]+)\}/g,(_,k)=>String(lookup(k)));
  }
  if(Array.isArray(value)) return value.map(x=>interpolate(x,data));
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,interpolate(v,data)]));
  return value;
}
export function check(actual: unknown, a: Assertion) {
  let value=actual;
  for(const key of a.path ? a.path.split('.') : []) {
    value = value!==null && typeof value==='object' && Object.hasOwn(value,key) ? (value as Record<string,unknown>)[key] : undefined;
  }
  switch(a.operator) {
    case 'equals': assert.deepEqual(value,a.expected); break;
    case 'exists': assert.notEqual(value,undefined); assert.notEqual(value,null); break;
    case 'contains': assert.ok(typeof value==='string' ? value.includes(String(a.expected)) : Array.isArray(value) && value.some(x=>{try{assert.deepEqual(x,a.expected); return true;}catch{return false;}})); break;
    case 'matches': assert.equal(typeof value,'string'); assert.match(value as string,new RegExp(String(a.expected))); break;
  }
}
export function selectTests(p:Project,suite:string,options:Execution) {
  if(!p.suites[suite]) throw new Error('Unknown suite');
  for(const id of options.testIds) if(!p.tests.some(t=>t.id===id&&t.suites.includes(suite))) throw new Error(`Unknown test in suite: ${id}`);
  const roots=p.tests.filter(t=>t.suites.includes(suite)
    && (!options.testIds.length||options.testIds.includes(t.id))
    && (!options.includeTags.length||t.tags.some(tag=>options.includeTags.includes(tag)))
    && !t.tags.some(tag=>options.excludeTags.includes(tag))
    && (!options.shard||createHash('sha256').update(t.id).digest().readUInt32BE(0)%options.shard.total===options.shard.index-1));
  const ids=new Set<string>();
  function add(id:string) {if(ids.has(id)) return; ids.add(id); p.tests.find(t=>t.id===id)!.dependsOn.forEach(add);}
  roots.forEach(t=>add(t.id));
  return {roots:roots.map(t=>t.id),tests:p.tests.filter(t=>ids.has(t.id))};
}
export async function run(p: Project, env: string, suite: string, registry: Registry, overrides:Partial<Execution>={}): Promise<Result[]> {
  if(!p.environments[env] || !p.suites[suite]) throw new Error('Unknown environment or suite');
  const options=Execution.parse({...p.execution,...overrides});
  const {roots,tests}=selectTests(p,suite,options);
  if(!roots.length) throw new Error('No tests selected; check suite, tags, test IDs or shard');
  const executionId=randomUUID();
  const results=new Map<string,Result>(); const pending=new Set(tests.map(t=>t.id));
  const running=new Map<string,Promise<void>>(); let failures=0;
  async function execute(id:string):Promise<Result> {
    const t=tests.find(t=>t.id===id)!; const start=Date.now(); const attempts:Attempt[]=[];
    const finish=(status:Result['status'],reason?:string):Result=>({id,status,durationMs:Date.now()-start,attempts,flaky:status==='passed'&&attempts.length>1,dependency:!roots.includes(id),...(reason?{reason}:{})});
    if(t.status!=='approved') return finish('skipped','Review required');
    if(t.blockedBy.length) return finish('blocked',`Blockers: ${t.blockedBy.join(', ')}`);
    for(const d of t.dependsOn) if(results.get(d)?.status!=='passed') return finish('blocked',`Dependency ${d} did not pass`);
    if(!t.steps.length || !t.steps.some(s=>s.assertions.length)) return finish('blocked','Executable steps and explicit assertions required');
    for(let number=1;number<=1+(t.retrySafe?options.retries:0);number++) {
      const attemptStart=Date.now(); let step=0; let failureKind:'action'|'assertion'='action';
      try {
        const data={...resolveData(p,env,suite,t.data),'superq.testId':id,'superq.attempt':number,'superq.runId':executionId,'superq.environment':env,'superq.suite':suite}; const context={project:p,baseURL:p.environments[env]!.baseURL,data,testId:id,attempt:number};
        for(const raw of t.steps) {
          step++; failureKind='action'; const s=interpolate(raw,data) as Step; const action=p.catalog.find(a=>a.id===s.action)!;
          const response=await registry.get(`${action.kind}:${action.operation}`)(s.input,context);
          failureKind='assertion'; s.assertions.forEach(a=>check(response,a));
        }
        attempts.push({number,status:'passed',durationMs:Date.now()-attemptStart}); return finish('passed');
      } catch {
        attempts.push({number,status:'failed',durationMs:Date.now()-attemptStart,failedStep:step,failureKind});
      }
    }
    return finish('failed','Action or assertion failed; raw values omitted to protect secrets.');
  }
  while(pending.size||running.size) {
    let progressed=false;
    for(const id of pending) {
      if(running.size>=options.workers) break;
      const t=tests.find(t=>t.id===id)!;
      if(!t.dependsOn.every(d=>results.has(d))) continue;
      pending.delete(id); progressed=true;
      if(options.maxFailures&&failures>=options.maxFailures) {results.set(id,{id,status:'skipped',durationMs:0,reason:'Maximum failures reached',dependency:!roots.includes(id)});continue;}
      const task=execute(id).then(result=>{results.set(id,result);if(result.status==='failed') failures++;}).finally(()=>{running.delete(id);});
      running.set(id,task);
    }
    if(running.size) await Promise.race(running.values());
    else if(pending.size&&!progressed) throw new Error('Dependency scheduling stalled; validate project first');
  }
  return tests.map(t=>results.get(t.id)!);
}
