import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { validateProject } from '../src/model.js';
import { createReport,html } from '../src/reporting.js';
test('HTML dashboard switches views, filters tests and renders safely at desktop and mobile widths',async()=>{
  const p=validateProject(JSON.parse(await readFile('examples/project.json','utf8')));
  const report=createReport(p,'local','regression',[{profile:'local',provider:'local',browser:'chromium',results:[{id:'TC-API',status:'passed',durationMs:12},{id:'TC-WEB',status:'blocked',reason:'Waiting for test environment',durationMs:0}]}]);
  const browser=await chromium.launch();try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.setContent(html(report));
    assert.equal(await page.locator('#v0').isVisible(),true);
    await page.getByRole('button',{name:'Tests',exact:true}).click();assert.equal(await page.locator('#v1').isVisible(),true);
    await page.locator('#status').selectOption('blocked');assert.equal(await page.locator('#v1 tbody tr:visible').count(),1);
    await page.locator('#status').selectOption('');await page.locator('#search').fill('TC-API');assert.equal(await page.locator('#v1 tbody tr:visible').count(),1);
    await page.getByRole('button',{name:'Coverage',exact:true}).click();assert.equal(await page.locator('#v2').isVisible(),true);
    await page.getByRole('button',{name:'Summary',exact:true}).click();
    if(process.env.SUPERQ_REPORT_PREVIEW){await mkdir('.superq',{recursive:true});await page.screenshot({path:'.superq/report-preview.png',fullPage:true});}
    await page.setViewportSize({width:390,height:844});assert.equal(await page.getByRole('button',{name:'Browsers',exact:true}).isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  }finally{await browser.close();}
});
