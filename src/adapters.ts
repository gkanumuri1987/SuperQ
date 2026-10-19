import { loadSession, authDirectory, totp, AuthenticationRequired } from './auth-session.js';
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
export function createAdapters(rawProfile:unknown={provider:'local'}, connector:typeof openBrowser=openBrowser,sessionDirectory=authDirectory()) {
  const profile=BrowserProfile.parse(rawProfile);
  const registry = new Registry(); const browsers=new Set<Browser>();
  registry.register('api:request',async(input,ctx)=>{
    const i=z.object({service:z.string().optional(),path:z.string(),method:z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD']).default('GET'),body:z.unknown().optional(),headers:z.record(z.string(),z.string()).optional()}).strict().parse(input);
    const base=i.service?ctx.urls?.[i.service]:ctx.apiURL??ctx.baseURL;if(!base)throw new Error('Unknown environment service');
    const url=new URL(i.path,base); if(url.origin!==new URL(base).origin) throw new Error('Cross-origin API request denied');
    const api=await request.newContext({baseURL:base,timeout:30_000,ignoreHTTPSErrors:false});
    const abort=()=>{void api.dispose().catch(()=>{});};ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();
    try { const r=await api.fetch(url.href,{method:i.method,data:i.body,headers:{...(ctx.account?.token&&url.origin===new URL(ctx.apiURL??ctx.baseURL).origin?{authorization:`Bearer ${ctx.account.token}`} : {}),...Object.fromEntries(Object.entries(i.headers??{}).map(([k,v])=>[k.toLowerCase(),v]))},maxRedirects:0}); const text=await r.text(); let body:unknown=text; try{body=JSON.parse(text);}catch{} return {status:r.status(),body}; }
    finally {ctx.signal?.removeEventListener('abort',abort); await api.dispose(); }
  });
  registry.register('web:journey',async(input,ctx)=>{
    const command=z.discriminatedUnion('type',[
      z.object({type:z.literal('goto'),path:z.string()}).strict(),
      z.object({type:z.literal('click'),locator:z.string()}).strict(),
      z.object({type:z.literal('fill'),locator:z.string(),value:z.string()}).strict(),
      z.object({type:z.literal('text'),locator:z.string()}).strict(),
      z.object({type:z.literal('expectText'),locator:z.string(),value:z.string(),timeoutMs:z.number().int().min(1).max(60000).default(5000)}).strict(),
    ]);
    const i=z.object({commands:z.array(command).min(1)}).strict().parse(input);
    // One journey owns one browser session, including cloud sessions. No mutable
    // session is shared across parallel tests or retries.
    const storageState=ctx.account&&ctx.sso?await loadSession(ctx.project,ctx.environment!,ctx.account.id,sessionDirectory):undefined;
    const browser=await connector(profile,`${ctx.testId??'SuperQ journey'} (attempt ${ctx.attempt??1})`); browsers.add(browser);
    let context:Awaited<ReturnType<Browser['newContext']>>|undefined;
    const abort=()=>{void browser.close().catch(()=>{});};ctx.signal?.addEventListener('abort',abort,{once:true});
    try {
      if(ctx.signal?.aborted)throw new Error('Browser journey cancelled');
      context=await browser.newContext({storageState,serviceWorkers:'block',viewport:profile.viewport,locale:profile.locale,timezoneId:profile.timezoneId});
      const origin=new URL(ctx.baseURL).origin;
      await context.route('**/*',async route=> { const url=new URL(route.request().url()); if(url.origin===origin) await route.continue(); else await route.abort(); });
      const page=await context.newPage(); page.setDefaultTimeout(15_000); const text:Record<string,string>={};
      if(ctx.account&&ctx.sso){
        try{await page.goto(new URL(ctx.sso.successPath,ctx.baseURL).href);await expect(page).toHaveURL(new URL(ctx.sso.successPath,ctx.baseURL).href,{timeout:5000});await expect(page.getByText(String(interpolate(ctx.sso.successText,ctx.data)),{exact:true})).toBeVisible({timeout:5000});}
        catch{throw new AuthenticationRequired();}
      }
      if(ctx.account&&ctx.login){
        try{
        if(!ctx.account.username||!ctx.account.password)throw new Error('Login requires configured username and password secret');
        const loginURL=new URL(ctx.login.path,ctx.baseURL),successURL=new URL(ctx.login.successPath,ctx.baseURL);
        if(loginURL.origin!==origin||successURL.origin!==origin)throw new Error('Cross-origin login denied');
        await page.goto(loginURL.href);
        await page.getByLabel(ctx.login.usernameLabel,{exact:true}).fill(ctx.account.username);
        await page.getByLabel(ctx.login.passwordLabel,{exact:true}).fill(ctx.account.password);
        await page.getByRole('button',{name:ctx.login.submitButton,exact:true}).click();
        if(ctx.login.mfa){await page.getByLabel(ctx.login.mfa.codeLabel,{exact:true}).waitFor({state:'visible'});if(!ctx.account.mfaSecret)throw new AuthenticationRequired('Configure the TOTP seed secret for this test account.');await page.getByLabel(ctx.login.mfa.codeLabel,{exact:true}).fill(totp(ctx.account.mfaSecret,ctx.login.mfa));await page.getByRole('button',{name:ctx.login.mfa.submitButton,exact:true}).click();}
        await expect(page).toHaveURL(successURL.href);
        }catch{throw new AuthenticationRequired('Form sign-in or MFA was not accepted. Check the account, authentication settings and provider response.');}
      }
      for(const c of i.commands) {
        if(c.type==='goto') { const url=new URL(c.path,ctx.baseURL); if(url.origin!==origin) throw new Error('Cross-origin navigation denied'); await page.goto(url.href); continue; }
        const def=interpolate(ctx.project.locators[c.locator],ctx.data) as typeof ctx.project.locators[string]; if(!def) throw new Error(`Unknown locator ${c.locator}`);
        const locator=def.strategy==='text'?page.getByText(def.value,{exact:true}):def.strategy==='testId'?page.getByTestId(def.value):def.strategy==='label'?page.getByLabel(def.value,{exact:true}):page.getByRole(def.value as Parameters<typeof page.getByRole>[0],{name:def.name,exact:true});
        if(c.type==='click') await locator.click();
        else if(c.type==='fill') await locator.fill(c.value);
        else if(c.type==='expectText') {await expect(locator).toBeVisible({timeout:c.timeoutMs});await expect(locator).toHaveText(c.value,{timeout:c.timeoutMs});text[c.locator]=await locator.innerText();}
        else { await locator.waitFor({state:'visible'}); text[c.locator]=await locator.innerText(); }
      }
      return {url:page.url(),text};
    } finally {ctx.signal?.removeEventListener('abort',abort); try {await context?.close();} finally {await browser.close();browsers.delete(browser);} }
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
