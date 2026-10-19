import assert from 'node:assert/strict';
import type { Project, Result, Step, Assertion } from './model.js';
export type Context = { project: Project; baseURL: string; data: Record<string,unknown> };
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
export async function run(p: Project, env: string, suite: string, registry: Registry): Promise<Result[]> {
  if(!p.environments[env] || !p.suites[suite]) throw new Error('Unknown environment or suite');
  const results = new Map<string,Result>(); const selected=p.tests.filter(t=>t.suites.includes(suite));
  async function execute(id:string): Promise<Result> {
    if(results.has(id)) return results.get(id)!;
    const t=p.tests.find(t=>t.id===id)!; const start=Date.now();
    const finish=(status:Result['status'],reason?:string)=>{ const r={id,status,durationMs:Date.now()-start,...(reason?{reason}:{})}; results.set(id,r); return r; };
    if(t.status!=='approved') return finish('skipped','Review required');
    if(t.blockedBy.length) return finish('blocked',`Blockers: ${t.blockedBy.join(', ')}`);
    for(const d of t.dependsOn) { if((await execute(d)).status!=='passed') return finish('blocked',`Dependency ${d} did not pass`); }
    if(!t.steps.length || !t.steps.some(s=>s.assertions.length)) return finish('blocked','Executable steps and explicit assertions required');
    try {
      const data=resolveData(p,env,suite,t.data); const context={project:p,baseURL:p.environments[env]!.baseURL,data};
      for(const raw of t.steps) {
        const s=interpolate(raw,data) as Step; const action=p.catalog.find(a=>a.id===s.action)!;
        const response=await registry.get(`${action.kind}:${action.operation}`)(s.input,context);
        s.assertions.forEach(a=>check(response,a));
      }
      return finish('passed');
    } catch { return finish('failed','Action or assertion failed; inspect locally with sanitized adapter diagnostics.'); }
  }
  for(const t of selected) await execute(t.id); return [...results.values()];
}
