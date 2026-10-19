import { z } from 'zod';
import { BrowserProfile, Execution, Reporting } from './config.js';
import { ReleasePolicy, Revision } from './release-policy.js';
const id = z.string().min(1);
export const Evidence = z.object({ id, source: z.string().min(1), revision: z.string().min(1), excerpt: z.string().min(1), applicationRevision:Revision.optional() }).strict();
export const Assertion = z.object({ path: z.string(), operator: z.enum(['equals', 'contains', 'matches', 'exists']), expected: z.unknown().optional() }).strict().superRefine((a, c) => {
  if (a.operator !== 'exists' && a.expected === undefined) c.addIssue({code:'custom',message:'Assertion requires expected value'});
  if (a.operator === 'matches') { try { new RegExp(String(a.expected)); } catch { c.addIssue({code:'custom',message:'Invalid assertion regex'}); } }
});
export const Step = z.object({ save: z.record(z.string(), z.string().min(1)).default({}), action: id, input: z.record(z.string(), z.unknown()).default({}), assertions: z.array(Assertion).default([]) }).strict();
export const Project = z.object({
  name: id,
  evidence: z.array(Evidence).default([]),
  requirements: z.array(z.object({ id, title: id, risk: z.enum(['critical','high','medium','low']), criteria:z.array(z.object({id,title:id}).strict()).default([]), evidenceIds: z.array(id).min(1) }).strict()),
  catalog: z.array(z.object({ id, kind: z.enum(['api','web','postgres','mongo','snowflake','custom']), operation: id, description: id }).strict()),
  locators: z.record(z.string(), z.object({ strategy: z.enum(['role','label','testId','text']), value: id, name: z.string().optional() }).strict()).default({}),
  tests: z.array(z.object({ id, title: id, origin: z.enum(['qe','ai']), status: z.enum(['draft','approved']), review:z.object({reviewer:id,at:z.iso.datetime(),digest:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().optional(), covers:z.record(z.string(),z.array(id)).default({}), requirementIds: z.array(id).min(1), evidenceIds: z.array(id).min(1), suites: z.array(id).min(1), tags: z.array(id).default([]), retrySafe: z.boolean().default(false), dependsOn: z.array(id).default([]), blockedBy: z.array(id).default([]), data: z.record(z.string(), z.unknown()).default({}), steps: z.array(Step).default([]) }).strict()),
  release: ReleasePolicy.optional(),
  browsers: z.record(z.string(), BrowserProfile).default({local: BrowserProfile.parse({provider:"local"})}),
  execution: Execution.default(Execution.parse({})),
  reporting: Reporting.default(Reporting.parse({})),
  data: z.record(z.string(), z.unknown()).default({}),
  environments: z.record(z.string(), z.object({ baseURL: z.url(), data: z.record(z.string(),z.unknown()).default({}) }).strict()),
  suites: z.record(z.string(), z.object({ data: z.record(z.string(),z.unknown()).default({}) }).strict()),
}).strict();
export type Project = z.infer<typeof Project>;
export type TestCase = Project['tests'][number];
export type Step = z.infer<typeof Step>;
export type Assertion = z.infer<typeof Assertion>;
export type Attempt = { number: number; status: 'passed'|'failed'; durationMs: number; failedStep?: number; failureKind?: 'action'|'assertion'|'timeout' };
export const ResultSchema=z.object({id,status:z.enum(['passed','failed','blocked','skipped']),durationMs:z.number().finite().nonnegative(),reason:z.string().optional(),flaky:z.boolean().optional(),dependency:z.boolean().optional(),attempts:z.array(z.object({number:z.number().int().positive(),status:z.enum(['passed','failed']),durationMs:z.number().finite().nonnegative(),failedStep:z.number().int().nonnegative().optional(),failureKind:z.enum(['action','assertion','timeout']).optional()}).strict()).optional()}).strict();
export type Result = { id: string; status: 'passed'|'failed'|'blocked'|'skipped'; durationMs: number; reason?: string; attempts?: Attempt[]; flaky?: boolean; dependency?: boolean };

export function validateProject(raw: unknown): Project {
  const p = Project.parse(raw);
  const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`); };
  unique(p.requirements.map(x=>x.id),'requirement ID'); unique(p.tests.map(x=>x.id),'test ID');
  unique(p.evidence.map(x=>x.id),'evidence ID'); unique(p.catalog.map(x=>x.id),'action ID');
  unique(p.catalog.map(x=>`${x.kind}:${x.operation}`),'catalog operation: reuse existing action');
  unique(Object.values(p.locators).map(x=>JSON.stringify([x.strategy,x.value,x.name])),'locator: reuse existing locator');
  for(const env of Object.values(p.environments)){const url=new URL(env.baseURL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('Environment requires an HTTP(S) URL without embedded credentials');}
  if(!Object.keys(p.browsers).length) throw new Error('At least one browser profile required');
  const evidence = new Set(p.evidence.map(x=>x.id)); const reqs = new Set(p.requirements.map(x=>x.id));
  const tests = new Map(p.tests.map(x=>[x.id,x])); const actions = new Set(p.catalog.map(x=>x.id));
  for (const r of p.requirements) {unique(r.criteria.map(c=>c.id),`criterion ID in ${r.id}`);for (const e of r.evidenceIds) if (!evidence.has(e)) throw new Error(`Unknown evidence ${e}`);}
  if(p.release){
    if(!Object.hasOwn(p.environments,p.release.environment))throw new Error('Unknown release environment');
    unique(p.release.requiredSuites,'release suite');unique(p.release.requiredProfiles,'release profile');unique(p.release.requiredChecks,'release check');unique(p.release.requiredApprovalRoles,'approval role');
    for(const s of p.release.requiredSuites) if(!Object.hasOwn(p.suites,s)) throw new Error(`Unknown release suite ${s}`);
    for(const b of p.release.requiredProfiles) if(!Object.hasOwn(p.browsers,b)) throw new Error(`Unknown release profile ${b}`);
  }
  for (const t of p.tests) {
    for(const [req,criteria] of Object.entries(t.covers)){const requirement=p.requirements.find(r=>r.id===req);if(!t.requirementIds.includes(req)||!requirement) throw new Error(`Invalid criterion mapping ${req}`);unique(criteria,'criterion mapping');for(const c of criteria) if(!requirement.criteria.some(x=>x.id===c)) throw new Error(`Unknown criterion ${c}`);}
    for(const s of t.steps) for(const key of Object.keys(s.save)){if(!/^[a-zA-Z][\w.-]*$/.test(key)||key.startsWith('superq.')||['__proto__','constructor','prototype'].includes(key)) throw new Error(`Unsafe saved variable ${key}`);}
    for (const e of t.evidenceIds) if (!evidence.has(e)) throw new Error(`Unknown evidence ${e}`);
    for (const r of t.requirementIds) if (!reqs.has(r)) throw new Error(`Unknown requirement ${r}`);
    for (const s of t.suites) if (!Object.hasOwn(p.suites,s)) throw new Error(`Unknown suite ${s}`);
    for (const d of t.dependsOn) if (!tests.has(d)) throw new Error(`Unknown dependency ${d}`);
    for (const s of t.steps) if (!actions.has(s.action)) throw new Error(`Unknown action ${s.action}`);
  }
  const active = new Set<string>(); const done = new Set<string>();
  function visit(t: TestCase) { if(active.has(t.id)) throw new Error(`Dependency cycle at ${t.id}`); if(done.has(t.id)) return; active.add(t.id); for(const d of t.dependsOn) visit(tests.get(d)!); active.delete(t.id); done.add(t.id); }
  p.tests.forEach(visit); return p;
}
