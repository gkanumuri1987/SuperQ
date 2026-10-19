import { execFileSync } from 'node:child_process';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
export const Snapshot=z.object({revision:z.string(),files:z.array(z.object({path:z.string(),hash:z.string(),content:z.string()}))});
export type Snapshot=z.infer<typeof Snapshot>;
export async function snapshot(repo:string,paths:string[]):Promise<Snapshot> {
  if(!paths.length) throw new Error('Explicit non-secret file paths required');
  const root=await realpath(repo);
  const git=(args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:8*1024*1024}).trim();
  const revision=git(['rev-parse','HEAD']);
  const tracked=new Set(git(['ls-files']).split('\n')); const files:Snapshot['files']=[];
  for(const path of [...new Set(paths)]) {
    if(isAbsolute(path)||path.split('/').includes('..')||!tracked.has(path)||/(^|\/)(\.env[^/]*|[^/]*\.(pem|key)|credentials[^/]*)$/i.test(path)) throw new Error(`Unsafe or untracked source path: ${path}`);
    const absolute=resolve(root,path); const info=await lstat(absolute); const canonical=await realpath(absolute);
    if(info.isSymbolicLink()||relative(root,canonical).startsWith('..')||!info.isFile()||info.size>256_000) throw new Error(`Unsupported source path: ${path}`);
    // Read committed content so evidence always matches its declared revision.
    const content=execFileSync('git',['-C',root,'show',`${revision}:${path}`],{encoding:'utf8',maxBuffer:256_000});
    if(content.includes('\0')) throw new Error('Binary source is unsupported');
    files.push({path,content,hash:createHash('sha256').update(content).digest('hex')});
  }
  return {revision,files};
}
export function changes(before:Snapshot,after:Snapshot) {
  const a=new Map(before.files.map(f=>[f.path,f.hash])); const b=new Map(after.files.map(f=>[f.path,f.hash]));
  return [...new Set([...a.keys(),...b.keys()])].filter(p=>a.get(p)!==b.get(p)).map(path=>({path,status:!a.has(path)?'added':!b.has(path)?'removed':'modified',revision:after.revision}));
}
export async function loadSnapshot(path:string) { return validateSnapshot(JSON.parse(await readFile(path,'utf8'))); }

export function validateSnapshot(raw:unknown):Snapshot {
  const value=Snapshot.parse(raw);
  if(new Set(value.files.map(f=>f.path)).size!==value.files.length)throw new Error('Duplicate knowledge source paths');
  for(const f of value.files)if(f.hash!==createHash('sha256').update(f.content).digest('hex'))throw new Error('Knowledge content hash mismatch');
  return value;
}
