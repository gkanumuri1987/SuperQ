import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, firefox, webkit } from '@playwright/test';
import { validateProject } from './model.js';
import { Execution, Reporting } from './config.js';
import { coverage } from './coverage.js';
import { run, selectTests } from './runner.js';
import { createAdapters } from './adapters.js';
import { cloudCredentialNames } from './browser.js';
import { createReport, writeReports, type ProfileRun } from './reporting.js';
import { snapshot, changes, loadSnapshot } from './knowledge.js';
const help=`SuperQ — evidence-driven automation

  init <project.json>                      Create an editable reference project
  doctor <project.json>                   Validate setup without starting cloud sessions
  plan <project.json> <env> <suite>        Preview selection, dependencies and profiles
  run <project.json> <env> <suite>         Execute and generate reports
  validate|analyze <project.json>          Validate configuration or inspect coverage
  snapshot <repo> <output.json> <paths...> Capture committed, allowlisted source files
  diff <before.json> <after.json>          Compare source knowledge

Run/plan options:
  --profiles local,firefox                 Explicit named profiles (default: local)
  --workers 4 --retries 1 --max-failures 3  Bounded workers; only retrySafe tests retry
  --tags smoke,critical --exclude-tags slow
  --tests TC-1,TC-2 --shard 1/4            Stable root sharding; prerequisites included
  --formats json,html,junit,markdown --output .superq
  --minimum-automation 0.9 --minimum-proven 0.8 --critical-gaps

Reports include summary, tests, coverage, blockers and browser views.
Cloud profiles require credentials and may incur provider charges when selected.
`;
async function main() {
  const {positionals,values}=parseArgs({allowPositionals:true,options:{help:{type:'boolean'},profiles:{type:'string'},workers:{type:'string'},retries:{type:'string'},'max-failures':{type:'string'},tags:{type:'string'},'exclude-tags':{type:'string'},tests:{type:'string'},shard:{type:'string'},formats:{type:'string'},output:{type:'string'},'minimum-automation':{type:'string'},'minimum-proven':{type:'string'},'critical-gaps':{type:'boolean'}}});
  const [command,file,...args]=positionals;
  if(values.help||!command) {console.log(help);return;}
  if(command==='init'&&file) {const template=await readFile(new URL('../examples/project.json',import.meta.url),'utf8');await writeFile(resolve(file),template,{flag:'wx',mode:0o600});console.log(`Created ${file}. Edit its requirements, tests and environment, then run doctor.`);return;}
  if(command==='snapshot'&&file&&args.length>=2) {const [out,...paths]=args; const result=await snapshot(file,paths); await writeFile(resolve(out!),JSON.stringify(result,null,2),{mode:0o600});console.log(`Saved committed source snapshot ${result.revision}`);return;}
  if(command==='diff'&&file&&args[0]) {console.log(JSON.stringify(changes(await loadSnapshot(file),await loadSnapshot(args[0])),null,2));return;}
  if(!file||!['validate','analyze','run','plan','doctor'].includes(command)) throw new Error(help);
  const p=validateProject(JSON.parse(await readFile(resolve(file),'utf8')));
  if(command==='validate') {console.log(`Valid: ${p.name}`);return;}
  if(command==='analyze') {console.log(JSON.stringify(coverage(p),null,2));return;}
  if(command==='doctor') {
    const checks=[];
    const names=(values.profiles??'local').split(',').map(x=>x.trim()).filter(Boolean);
    if(!names.length||names.some(name=>!p.browsers[name])) throw new Error('Unknown or empty browser profile selection');
    for(const name of names) {
      const profile=p.browsers[name]!;
      const missing=cloudCredentialNames(profile).filter(key=>!process.env[key]); let browserInstalled:boolean|null=null;
      if(profile.provider==='local'&&!['chrome','edge'].includes(profile.browser)) {try{await access((profile.browser==='firefox'?firefox:profile.browser==='webkit'?webkit:chromium).executablePath());browserInstalled=true;}catch{browserInstalled=false;}}
      checks.push({profile:name,provider:profile.provider,browser:profile.browser,missingCredentialNames:missing,browserInstalled,note:profile.provider==='local'?'Chrome/Edge channels require an installed browser.':'No paid session started. Verify account browser availability, tunnel and session quota.',ok:missing.length===0&&browserInstalled!==false});
    }
    console.log(JSON.stringify({project:p.name,checks},null,2));if(checks.some(c=>!c.ok)) process.exitCode=1;return;
  }
  const list=(value:string)=>value.split(',').map(x=>x.trim()).filter(Boolean);
  const numeric=(value:string)=>{if(!value.trim()) throw new Error('Numeric option cannot be empty');return Number(value);};
  let shard:Execution['shard']=p.execution.shard;
  if(values.shard){if(!/^\d+\/\d+$/.test(values.shard)) throw new Error('Shard format must be index/total');const [index,total]=values.shard.split('/').map(Number);shard={index:index!,total:total!};}
  p.execution=Execution.parse({...p.execution,...(values.workers!==undefined?{workers:numeric(values.workers)}:{}),...(values.retries!==undefined?{retries:numeric(values.retries)}:{}),...(values['max-failures']!==undefined?{maxFailures:numeric(values['max-failures'])}:{}),...(values.tags!==undefined?{includeTags:list(values.tags)}:{}),...(values['exclude-tags']!==undefined?{excludeTags:list(values['exclude-tags'])}:{}),...(values.tests!==undefined?{testIds:list(values.tests)}:{}),shard});
  p.reporting=Reporting.parse({...p.reporting,...(values.formats?{formats:list(values.formats)}:{}),...(values['minimum-automation']!==undefined?{minimumAutomation:numeric(values['minimum-automation'])}:{}),...(values['minimum-proven']!==undefined?{minimumProven:numeric(values['minimum-proven'])}:{}),...(values['critical-gaps']?{failOnCriticalGaps:true}:{})});
  const [env,suite]=args;if(!env||!suite||!p.environments[env]) throw new Error('Known environment and suite required');
  // Never implicitly select a configured cloud provider.
  const profiles=[...new Set(list(values.profiles??'local'))];if(!profiles.length) throw new Error('Select at least one profile');
  for(const name of profiles){const profile=p.browsers[name];if(!profile) throw new Error(`Unknown browser profile: ${name}`);if(profile.provider!=='local'&&p.execution.workers>profile.maxSessions) throw new Error(`Workers exceed configured cloud session cap: ${name}`);}
  const selected=selectTests(p,suite,p.execution);if(!selected.roots.length) throw new Error('No tests selected');
  if(command==='plan') {console.log(JSON.stringify({project:p.name,environment:env,suite,profiles:profiles.map(name=>({name,provider:p.browsers[name]!.provider,browser:p.browsers[name]!.browser})),workers:p.execution.workers,roots:selected.roots,prerequisites:selected.tests.filter(t=>!selected.roots.includes(t.id)).map(t=>t.id),estimatedMaximumBrowserSessions:profiles.reduce(n=>n+selected.tests.reduce((sum,t)=>sum+t.steps.filter(s=>p.catalog.find(a=>a.id===s.action)?.kind==='web').length*(1+(t.retrySafe?p.execution.retries:0)),0),0),note:'Dry run only. Dependencies may run in multiple shards. Repeated tests need isolated data.'},null,2));return;}
  const runs:ProfileRun[]=[];
  for(const name of profiles){const profile=p.browsers[name]!;const adapters=createAdapters(profile);try{runs.push({profile:name,provider:profile.provider,browser:profile.browser,results:await run(p,env,suite,adapters.registry)});}finally{await adapters.close();}}
  const report=createReport(p,env,suite,runs);const root=resolve(values.output??'.superq');const directory=join(root,'runs',report.runId);
  await writeReports(report,p.reporting.formats,directory);await mkdir(root,{recursive:true,mode:0o700});await writeFile(join(root,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({runId:report.runId,summary:report.summary,gates:report.gates,reports:directory},null,2));if(report.gates.length) process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error&&error.name==='ZodError'?'Invalid project or options: run validate/doctor and review schema types and bounds.':error instanceof SyntaxError?'Invalid JSON project.':error instanceof Error?error.message:'SuperQ failed');process.exitCode=1;});
