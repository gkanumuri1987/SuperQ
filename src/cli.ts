import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateProject } from './model.js';
import { coverage } from './coverage.js';
import { run } from './runner.js';
import { createAdapters } from './adapters.js';
import { snapshot, changes, loadSnapshot } from './knowledge.js';
async function main() {
  const [command,file,...args]=process.argv.slice(2);
  if(command==='snapshot'&&file&&args.length>=2) {
    const [out,...paths]=args; const result=await snapshot(file,paths); await writeFile(resolve(out!),JSON.stringify(result,null,2),{mode:0o600}); console.log(`Saved committed source snapshot ${result.revision}`); return;
  }
  if(command==='diff'&&file&&args[0]) {console.log(JSON.stringify(changes(await loadSnapshot(file),await loadSnapshot(args[0])),null,2)); return;}
  if(!file||!['validate','analyze','run'].includes(command??'')) throw new Error('Usage: superq validate|analyze <project.json> | run <project.json> <env> <suite> | snapshot <repo> <output.json> <tracked-path...> | diff <before.json> <after.json>');
  const p=validateProject(JSON.parse(await readFile(resolve(file),'utf8')));
  if(command==='validate') {console.log(`Valid: ${p.name}`);return;}
  if(command==='analyze') {console.log(JSON.stringify(coverage(p),null,2));return;}
  const [env,suite]=args; if(!env||!suite) throw new Error('Environment and suite required');
  const adapters=createAdapters();
  try {const results=await run(p,env,suite,adapters.registry); const report={project:p.name,environment:env,suite,at:new Date().toISOString(),results,coverage:coverage(p,results)}; await mkdir('.superq',{recursive:true}); await writeFile('.superq/report.json',JSON.stringify(report,null,2),{mode:0o600}); console.log(JSON.stringify(report,null,2)); if(results.some(r=>r.status!=='passed')) process.exitCode=1;}
  finally {await adapters.close();}
}
main().catch(()=>{console.error('SuperQ failed: check command arguments, project validation, adapter configuration and required credentials.');process.exitCode=1;});
