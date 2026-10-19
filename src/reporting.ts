import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { coverage } from './coverage.js';
import { isHealed, ResultSchema, type Project, type Result } from './model.js';
import { projectFingerprint } from './identity.js';
export type Provenance={applicationRevision?:string;artifactDigest?:string;automationRevision?:string|null;automationDirty?:boolean;startedAt?:string};
export type ProfileRun={profile:string;provider:string;browser:string;results:Result[]};
export function createReport(p:Project,environment:string,suite:string,runs:ProfileRun[],provenance:Provenance={}) {
  for(const run of runs) run.results.forEach(r=>ResultSchema.parse(r));
  runs=runs.map(run=>({...run,results:run.results.map(r=>({...r,healed:isHealed(r)}))}));
  // An ID is proven only if it passes in every requested profile. Flaky tests
  // retain their actual passing outcome and are handled independently by gates.
  const ids=[...new Set(runs.flatMap(r=>r.results.map(t=>t.id)))];
  const consolidated=ids.map(id=>{
    const results=runs.map(r=>r.results.find(t=>t.id===id));
    const status:Result['status']=results.every(r=>r?.status==='passed')?'passed':results.some(r=>r?.status==='failed')?'failed':results.some(r=>r?.status==='blocked')?'blocked':'skipped';
    return {id,status,healed:results.some(r=>r?.healed),flaky:results.some(r=>r?.flaky),durationMs:results.reduce((n,r)=>n+(r?.durationMs??0),0)};
  });
  const coverageReport=coverage(p,consolidated);
  const results=runs.flatMap(r=>r.results.map(t=>({...t,profile:r.profile,title:p.tests.find(x=>x.id===t.id)?.title??t.id})));
  const summary={total:results.length,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,blocked:results.filter(r=>r.status==='blocked').length,skipped:results.filter(r=>r.status==='skipped').length,flaky:results.filter(r=>r.flaky).length,healed:results.filter(r=>r.healed).length};
  const gates:string[]=[];
  if(!results.length) gates.push('No tests executed');
  if(new Set(runs.map(r=>r.profile)).size!==runs.length) gates.push('Duplicate profile results');
  for(const r of runs){if(new Set(r.results.map(t=>t.id)).size!==r.results.length) gates.push('Duplicate test results');if(r.results.some(t=>!p.tests.some(x=>x.id===t.id))) gates.push('Unknown test results');}
  if(results.some(r=>r.status!=='passed')) gates.push('Tests failed, blocked or skipped');
  if(summary.healed)gates.push('Healed execution requires reviewed repair and a clean rerun');
  if(p.execution.failOnFlaky&&summary.flaky) gates.push('Flaky tests detected');
  if(coverageReport.riskWeightedAutomation<p.reporting.minimumAutomation) gates.push('Automation coverage below threshold');
  if(coverageReport.riskWeightedProven<p.reporting.minimumProven) gates.push('Proven coverage below threshold');
  if(p.reporting.failOnCriticalGaps&&coverageReport.rows.some(r=>r.risk==='critical'&&r.gaps.length)) gates.push('Critical requirement gaps');
  return {schemaVersion:2,productionCertified:false,provenance:{...provenance,projectFingerprint:projectFingerprint(p)},runId:randomUUID(),project:p.name,environment,suite,at:new Date().toISOString(),execution:p.execution,summary,gates,coverage:coverageReport,runs,results};
}
export type Report=ReturnType<typeof createReport>;
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
export function junit(report:Report) {
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites>${report.runs.map(run=>`<testsuite name="${escape(`${report.project} / ${run.profile}`)}" tests="${run.results.length}" failures="${run.results.filter(r=>r.status==='failed'||r.healed||(r.flaky&&report.execution.failOnFlaky)).length}" skipped="${run.results.filter(r=>r.status==='blocked'||r.status==='skipped').length}" time="${run.results.reduce((n,r)=>n+r.durationMs,0)/1000}">${run.results.map(r=>`<testcase name="${escape(r.id)}" classname="${escape(run.profile)}" time="${r.durationMs/1000}">${r.status==='failed'||r.healed||(r.flaky&&report.execution.failOnFlaky)?`<failure message="${escape(r.healed?'Speculative healing requires reviewed repair and clean rerun':r.flaky?'Flaky test: failed attempt retained':r.reason)}"/>`:r.status!=='passed'?`<skipped message="${escape(r.reason)}"/>`:''}<system-out>${escape(JSON.stringify({attempts:r.attempts,healed:r.healed,flaky:r.flaky,dependency:r.dependency,observations:r.observations,diagnosticsTruncated:r.diagnosticsTruncated}))}</system-out></testcase>`).join('')}</testsuite>`).join('')}${report.gates.length?`<testsuite name="SuperQ quality gates" tests="1" failures="1"><testcase name="Quality gates"><failure message="${escape(report.gates.join('; '))}"/></testcase></testsuite>`:''}</testsuites>`;
}
export function markdown(report:Report) {
  const cell=(x:unknown)=>String(x??'').replace(/[|\r\n]/g,' ').replace(/</g,'&lt;');
  return `# ${cell(report.project)}\n\nProduction readiness: not assessed.\n\nEnvironment: ${cell(report.environment)} · Suite: ${cell(report.suite)}\n\n${report.summary.passed}/${report.summary.total} passed; ${report.summary.failed} failed; ${report.summary.blocked} blocked; ${report.summary.flaky} flaky; ${report.summary.healed} healed (review required).\n\nQuality gates: ${report.gates.length?report.gates.map(cell).join('; '):'passed'}\n\nAutomation: ${(report.coverage.riskWeightedAutomation*100).toFixed(1)}%; proven across requested profiles: ${(report.coverage.riskWeightedProven*100).toFixed(1)}%.\n\n${report.coverage.scope}\n\n| Profile | Test | Status | Attempts |\n|---|---|---|---|\n${report.results.map(r=>`| ${cell(r.profile)} | ${cell(r.id)} | ${r.status}${r.healed?' (healed; review required)':''}${r.flaky?' (flaky)':''} | ${r.attempts?.length??0} |`).join('\n')}\n`;
}
export function html(report:Report) {
  const table=(headers:string[],rows:string[][])=>`<table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><title>SuperQ · ${escape(report.project)}</title>
<style>body{font:16px system-ui;margin:0;background:#f4f6fa;color:#162238}header,main{max-width:1200px;margin:auto;padding:24px}header{background:#162238;color:white;max-width:none}header div{max-width:1200px;margin:auto}h1{margin:8px 0}nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}button,select,input{font:inherit;padding:10px;border:1px solid #aab5c6;border-radius:6px}button{cursor:pointer;background:white}button[aria-pressed=true]{background:#185dc5;color:white}section{background:white;padding:20px;border-radius:10px;overflow:auto}section[hidden]{display:none}.cards{display:flex;gap:16px;flex-wrap:wrap}.card{padding:20px;background:#eaf0fb;border-radius:8px;min-width:120px}.card strong{font-size:28px;display:block}table{border-collapse:collapse;width:100%;margin-top:16px;font-size:14px}td,th{padding:12px;border-bottom:1px solid #dce2ec;text-align:left;vertical-align:top}th{background:#eef2f8}label{margin-right:12px}.gates{color:#9b2335}small{display:block;margin-top:12px;color:#53627b}</style>
<header><div><small style="color:#b9d1ff">SUPERQ / QUALITY INTELLIGENCE</small><h1>${escape(report.project)}</h1><p>${escape(report.environment)} · ${escape(report.suite)} · ${escape(report.at)}</p></div></header><main>
<nav aria-label="Report views">${['Summary','Tests','Coverage','Blockers','Browsers'].map((v,i)=>`<button type="button" data-view="v${i}" aria-pressed="${i===0}">${v}</button>`).join('')}</nav>
<section id="v0"><h2>Execution summary</h2><p><b>Production readiness has not been assessed.</b> A passing run is not production certification. Use a complete promotion manifest and independent release review.</p><div class="cards">${Object.entries(report.summary).map(([k,v])=>`<div class="card">${escape(k)}<strong>${v}</strong></div>`).join('')}</div><h3>Quality gates</h3><p class="${report.gates.length?'gates':''}">${escape(report.gates.join('; ')||'All configured gates passed')}</p><p>Risk-weighted automation: <b>${(report.coverage.riskWeightedAutomation*100).toFixed(1)}%</b> · proven across requested profiles: <b>${(report.coverage.riskWeightedProven*100).toFixed(1)}%</b></p><small>${escape(report.coverage.scope)}</small></section>
<section id="v1" hidden><h2>Test details</h2><label>Search <input id="search" type="search" placeholder="Test ID, title or profile"></label><label>Status <select id="status"><option value="">All</option>${['passed','failed','blocked','skipped','flaky','healed'].map(x=>`<option>${x}</option>`).join('')}</select></label>${table(['Profile','Test','Title','Status','Duration (ms)','Attempts / failure step'],report.results.map(r=>[r.profile,r.id,r.title,r.status+(r.healed?' (healed; review required)':'')+(r.flaky?' (flaky)':''),String(r.durationMs),(r.attempts??[]).map(a=>`${a.number}: ${a.status}${a.failedStep?` step ${a.failedStep} (${a.failureKind})`:''}`).join('; ')]))}<small>Attempts retain original failures. Raw response bodies, inputs and credentials are omitted.</small></section>
<section id="v2" hidden><h2>Requirements and coverage</h2>${table(['Requirement','Risk','Tests','Automated','Proven','Gaps / criteria'],report.coverage.rows.map(r=>[r.requirementId,r.risk,r.tests.join(', '),r.automated.join(', '),r.proven?'Yes':'No',[...r.gaps,...r.criteria.map(c=>`${c.id}: ${c.proven?'proven':c.automated.length?'not executed or failing':'no automation'}`)].join(', ')]))}</section>
<section id="v3" hidden><h2>Blockers and unresolved work</h2>${table(['Profile','Test','Status','Reason'],report.results.filter(r=>r.status!=='passed').map(r=>[r.profile,r.id,r.status,r.reason??'']))}<h3>Command and assertion diagnostics</h3>${table(['Test','Step / command','Operation','Status','Issue / reference'],report.results.flatMap(r=>(r.observations??[]).map(o=>[r.id,`${o.step}${o.command?` / ${o.command}`:''}`,o.operation,o.status,[o.issue,o.locator,o.replacement,o.assertionPath].filter(Boolean).join(' · ')])))}<small>Diagnostics omit input values, response bodies and observed page text. Long traces are bounded; see diagnosticsTruncated in JSON.</small><h3>Coverage gaps</h3>${table(['Requirement','Risk','Gaps'],report.coverage.rows.filter(r=>r.gaps.length).map(r=>[r.requirementId,r.risk,r.gaps.join(', ')]))}</section>
<section id="v4" hidden><h2>Browser matrix</h2>${table(['Profile','Provider','Browser','Passed','Failed','Blocked / skipped'],report.runs.map(r=>[r.profile,r.provider,r.browser,String(r.results.filter(t=>t.status==='passed').length),String(r.results.filter(t=>t.status==='failed').length),String(r.results.filter(t=>t.status==='blocked'||t.status==='skipped').length)]))}<small>Profiles run sequentially; tests within each profile use bounded parallel workers. API and data tests are repeated for each requested profile.</small></section>
<script>document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('section').forEach(s=>s.hidden=s.id!==b.dataset.view);document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}));function filter(){const q=document.getElementById('search').value.toLowerCase(),s=document.getElementById('status').value;document.querySelectorAll('#v1 tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q)||(s&&!r.cells[3].textContent.includes(s)))}document.getElementById('search').addEventListener('input',filter);document.getElementById('status').addEventListener('change',filter);</script></main></html>`;
}
export async function writeReports(report:Report,formats:Project['reporting']['formats'],directory:string) {
  await mkdir(directory,{recursive:true,mode:0o700});
  for(const format of new Set(formats)) {
    const output=format==='json'?JSON.stringify(report,null,2):format==='html'?html(report):format==='junit'?junit(report):markdown(report);
    await writeFile(join(directory,format==='junit'?'junit.xml':`report.${format==='markdown'?'md':format}`),output,{mode:0o600});
  }
}
