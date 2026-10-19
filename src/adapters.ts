import { journeyCommands } from "./web-setups.js";
import { authenticatePage } from "./web-auth.js";
import type { TraceStore } from "./trace-artifacts.js";
import { webCommandSchema, resolveLocator } from "./web-commands.js";
import { loadSession, authDirectory } from './auth-session.js';
import { request, expect, type Browser } from '@playwright/test';
import { Client } from 'pg';
import { MongoClient } from 'mongodb';
import snowflake from 'snowflake-sdk';
import { z } from 'zod';
import { Registry, interpolate } from './runner.js';
import { BrowserProfile } from './config.js';
import { openBrowser } from './browser.js';

// Adapters enforce a narrow operation surface. Database credentials MUST also use
// database-enforced read-only roles; SQL text checks are not an authorization boundary.
export function readQuery(sql: string) {
  if(!/^\s*select\b/i.test(sql) || /;|--|\/\*|\b(into|for\s+update|copy|call)\b/i.test(sql)) throw new Error('Only one plain SELECT is supported');
  return sql;
}
function secret(name:string) { const value=process.env[name]; if(!value) throw new Error(`Missing secret environment variable ${name}`); return value; }
const sqlInput=z.object({query:z.string().min(1),params:z.array(z.union([z.string(),z.number(),z.boolean(),z.null()])).default([])}).strict();
export function createAdapters(rawProfile:unknown={provider:'local'}, connector:typeof openBrowser=openBrowser,sessionDirectory=authDirectory(), traces?:TraceStore) {
  const profile=BrowserProfile.parse(rawProfile);
  const registry = new Registry(); const browsers=new Set<Browser>();
  registry.register('api:request',async(input,ctx)=>{
    const i=z.object({service:z.string().optional(),path:z.string(),method:z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD']).default('GET'),body:z.unknown().optional(),headers:z.record(z.string(),z.string()).optional()}).strict().parse(input);
    const base=i.service?ctx.urls?.[i.service]:ctx.apiURL??ctx.baseURL;if(!base)throw new Error('Unknown environment service');
    const url=new URL(i.path,base); if(url.origin!==new URL(base).origin) throw new Error('Cross-origin API request denied');
    const api=await request.newContext({baseURL:base,timeout:30_000,ignoreHTTPSErrors:false});
    const abort=()=>{void api.dispose().catch(()=>{});};ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();
    try { const r=await api.fetch(url.href,{method:i.method,data:i.body,headers:{...(ctx.account?.token&&url.origin===new URL(ctx.apiURL??ctx.baseURL).origin?{authorization:`Bearer ${ctx.account.token}`} : {}),...Object.fromEntries(Object.entries(i.headers??{}).map(([k,v])=>[k.toLowerCase(),v]))},maxRedirects:0}); const text=await r.text(); let body:unknown=text; try{body=JSON.parse(text);}catch{} ctx.observe?.({operation:"api.request",status:"passed"});return {status:r.status(),body}; }
    catch(error){ctx.observe?.({operation:"api.request",status:"failed",issue:"interaction-failed"});throw error;}
    finally {ctx.signal?.removeEventListener('abort',abort); await api.dispose(); }
  });
  registry.register('web:journey',async(input,ctx)=>{
    const command=webCommandSchema(z.string().min(1),z.string().min(1));
    const entries=journeyCommands(ctx.project,input);
    // One journey owns one browser session, including cloud sessions. No mutable
    // session is shared across parallel tests or retries.
    const storageState=ctx.account&&ctx.sso?await loadSession(ctx.project,ctx.environment!,ctx.account.id,sessionDirectory):undefined;
    const browser=await connector(profile,`${ctx.testId??'SuperQ journey'} (attempt ${ctx.attempt??1})`); browsers.add(browser);
    let context:Awaited<ReturnType<Browser['newContext']>>|undefined;
    let stopTrace:(()=>Promise<void>)|undefined;
    const abort=()=>{void browser.close().catch(()=>{});};ctx.signal?.addEventListener('abort',abort,{once:true});
    try {
      if(ctx.signal?.aborted)throw new Error('Browser journey cancelled');
      context=await browser.newContext({storageState,serviceWorkers:'block',viewport:profile.viewport,locale:profile.locale,timezoneId:profile.timezoneId});
      const origin=new URL(ctx.baseURL).origin;
      await context.route('**/*',async route=> { const url=new URL(route.request().url()); if(url.origin===origin) await route.continue(); else await route.abort(); });
      const page=await context.newPage(); page.setDefaultTimeout(15_000); const text:Record<string,string>={};const checkpoints:Record<string,unknown>={};const repairBudget=ctx.repairBudget??{remaining:1};
      await authenticatePage(page,ctx);
      if(traces){try{stopTrace=await traces.start(context,ctx.testId??'journey',ctx.attempt??1);}catch{traces.warn();}}
      let commandIndex=0;
      for(const entry of entries) {
        const c=command.parse(entry.setupId?interpolate(entry.command,ctx.data):entry.command);commandIndex=entry.index;
        const observe=(o:Parameters<NonNullable<typeof ctx.observe>>[0])=>ctx.observe?.({...o,...(entry.setupId?{setupId:entry.setupId}:{})});
        let matches:number|undefined;
        try {
        if(c.type==='goto') { const url=new URL(c.path,ctx.baseURL); if(url.origin!==origin) throw new Error('Cross-origin navigation denied'); await page.goto(url.href);observe({command:commandIndex,operation:'web.goto',status:'passed'}); continue; }
        if(c.type==='expectURL') {
          const url=new URL(c.path,ctx.baseURL);if(url.origin!==origin)throw new Error('Cross-origin expectation denied');
          await expect(page).toHaveURL(url.href,{timeout:c.timeoutMs});checkpoints[String(commandIndex)]=c.path;
          observe({command:commandIndex,operation:'web.expectURL',status:'passed'});continue;
        }
        const definition=(id:string)=>interpolate(ctx.project.locators[id],ctx.data) as typeof ctx.project.locators[string];
        const def=definition(c.locator);if(!def)throw new Error('Unknown catalog locator');
        let locator=resolveLocator(page,def);
        matches=await locator.count();
        if(!entry.setupId && matches===0 && ctx.project.healing?.enabled && ctx.project.healing.locators[c.locator]?.length && profile.provider==='local' && repairBudget.remaining>0 && ctx.testId && ctx.project.tests.find(t=>t.id===ctx.testId)?.evidenceIds.length && !(c.type==='expectCount' && c.count===0)) {
          try{await locator.waitFor({state:'attached',timeout:ctx.project.healing.waitMs});}catch{}
          matches=await locator.count();
          if(matches===0) {
            const eligible=[];let ambiguous=false;
            for(const id of ctx.project.healing.locators[c.locator]??[]) {
              const alternative=resolveLocator(page,definition(id));
              const count=await alternative.count();if(count>1)ambiguous=true;
              if(count===1 && await alternative.isVisible())eligible.push({id,locator:alternative});
            }
            if(eligible.length===1 && !ambiguous && await locator.count()===0) {
              repairBudget.remaining--;
              observe({command:commandIndex,operation:`web.${c.type}`,status:'failed',locator:c.locator,issue:'control-unavailable'});
              locator=eligible[0]!.locator;
              observe({command:commandIndex,operation:'web.heal',status:'passed',locator:c.locator,replacement:eligible[0]!.id});
              matches=1;
            }else if(await locator.count()===0){observe({command:commandIndex,operation:"web.heal",status:"failed",locator:c.locator,issue:ambiguous||eligible.length>1?"ambiguous-control":"control-unavailable"});}
          }
        }
        if(c.type==='click') await locator.click();
        else if(c.type==='fill') await locator.fill(c.value);
        else if(c.type==='selectOption') await locator.selectOption(c.value);
        else if(c.type==='check') await locator.check();
        else if(c.type==='uncheck') await locator.uncheck();
        else if(c.type==='expectText') {await expect(locator).toBeVisible({timeout:c.timeoutMs});await expect(locator).toHaveText(c.value,{timeout:c.timeoutMs});const observed=await locator.innerText();text[c.captureAs??c.locator]=observed;checkpoints[String(commandIndex)]=observed;}
        else if(c.type==='expectValue') {await expect(locator).toHaveValue(c.value,{timeout:c.timeoutMs});checkpoints[String(commandIndex)]=c.value;}
        else if(c.type==='expectVisible') {await expect(locator).toBeVisible({timeout:c.timeoutMs});checkpoints[String(commandIndex)]=true;}
        else if(c.type==='expectCount') {await expect(locator).toHaveCount(c.count,{timeout:c.timeoutMs});checkpoints[String(commandIndex)]=await locator.count();}
        else {await locator.waitFor({state:'visible'});text[c.captureAs??c.locator]=await locator.innerText();}
        observe({command:commandIndex,operation:`web.${c.type}`,status:'passed',locator:c.locator});
        }catch(error){
          observe({command:commandIndex,operation:`web.${c.type}`,status:'failed',...('locator' in c?{locator:c.locator}:{}),issue:c.type==='goto'?'navigation-failed':matches===0?'control-unavailable':matches&&matches>1?'ambiguous-control':c.type.startsWith('expect')?'expectation-failed':'interaction-failed'});
          throw error;
        }
      }
      return {url:page.url(),text,checkpoints};
    } finally {ctx.signal?.removeEventListener('abort',abort); try {try {await stopTrace?.().catch(()=>traces?.warn());} finally {await context?.close();}} finally {await browser.close();browsers.delete(browser);} }
  });
  registry.register('postgres:query',async input=>{
    const i=sqlInput.parse(input); readQuery(i.query);
    const db=new Client({connectionString:secret('SUPERQ_POSTGRES_URL'),connectionTimeoutMillis:15_000,statement_timeout:30_000,query_timeout:30_000});
    try { await db.connect(); await db.query('BEGIN READ ONLY'); const result=await db.query(i.query,i.params); return {rows:result.rows,rowCount:result.rowCount}; }
    finally { await db.end(); }
  });
  registry.register('mongo:find',async input=>{
    const i=z.object({database:z.string(),collection:z.string(),filter:z.record(z.string(),z.unknown()).default({}),limit:z.number().int().min(1).max(1000).default(100)}).strict().parse(input);
    const db=new MongoClient(secret('SUPERQ_MONGO_URL'),{serverSelectionTimeoutMS:15_000});
    try { await db.connect(); const rows=await db.db(i.database).collection(i.collection).find(i.filter,{maxTimeMS:30_000}).limit(i.limit).toArray(); return {rows,rowCount:rows.length}; }
    finally { await db.close(); }
  });
  registry.register('snowflake:query',async input=>{
    const i=sqlInput.parse(input); readQuery(i.query);
    const db=snowflake.createConnection({account:secret('SUPERQ_SNOWFLAKE_ACCOUNT'),username:secret('SUPERQ_SNOWFLAKE_USER'),password:secret('SUPERQ_SNOWFLAKE_PASSWORD'),role:secret('SUPERQ_SNOWFLAKE_READ_ROLE'),warehouse:secret('SUPERQ_SNOWFLAKE_WAREHOUSE')});
    try {
      await new Promise<void>((resolve,reject)=>db.connect(err=>err?reject(err):resolve()));
      const rows=await new Promise<unknown[]>((resolve,reject)=>db.execute({sqlText:i.query,binds:i.params as snowflake.Binds,complete:(err,_stmt,rows)=>err?reject(err):resolve(rows??[])}));
      return {rows,rowCount:rows.length};
    } finally { await new Promise<void>(resolve=>db.destroy(()=>resolve())); }
  });
  return {registry,close:async()=>{const closed=await Promise.allSettled([...browsers].map(x=>x.close()));browsers.clear();if(closed.some(x=>x.status==='rejected')) throw new Error('Browser cleanup failed; connection details omitted.');}};
}
