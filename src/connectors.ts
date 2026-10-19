import { z } from 'zod';
export type WorkItem={id:string;title:string;description:unknown;revision:string;source:string};
async function get(url:URL,authorization:string) {
  const response=await fetch(url,{headers:{authorization,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(30_000)});
  if(!response.ok) throw new Error(`Tracker request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}
/** Explicit IDs only; no remote instructions, code execution or tracker writes. */
export async function readJiraIssue(baseURL:string,key:string,email:string,token:string):Promise<WorkItem> {
  if(!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error('Invalid Jira issue key');
  const base=new URL(baseURL); if(base.protocol!=='https:'||base.username||base.password) throw new Error('HTTPS tracker URL required');
  const url=new URL(`/rest/api/3/issue/${encodeURIComponent(key)}`,base); url.searchParams.set('fields','summary,description,updated');
  const item=z.object({key:z.string(),fields:z.object({summary:z.string(),description:z.unknown(),updated:z.string()})}).parse(await get(url,`Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`));
  return {id:item.key,title:item.fields.summary,description:item.fields.description,revision:item.fields.updated,source:url.href};
}
export async function readAdoWorkItem(organization:string,project:string,id:number,pat:string):Promise<WorkItem> {
  if(!/^[\w-]+$/.test(organization)||!project||!Number.isSafeInteger(id)||id<1) throw new Error('Invalid ADO identity');
  const url=new URL(`https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?api-version=7.1`);
  const item=z.object({id:z.number(),rev:z.number(),fields:z.record(z.string(),z.unknown())}).parse(await get(url,`Basic ${Buffer.from(`:${pat}`).toString('base64')}`));
  const title=z.string().parse(item.fields['System.Title']);
  return {id:String(item.id),title,description:item.fields['System.Description']??item.fields['Microsoft.VSTS.TCM.Steps']??null,revision:String(item.rev),source:url.href};
}
