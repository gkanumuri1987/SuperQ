import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateProject } from '../../dist/model.js';
import { run } from '../../dist/runner.js';
import { createAdapters } from '../../dist/adapters.js';
Given('the SuperQ reference application',async function(){
  this.project=validateProject(JSON.parse(await readFile('examples/project.json','utf8')));
  this.adapters=createAdapters();
});
When('I execute the approved health test',async function(){this.results=await run(this.project,'local','smoke',this.adapters.registry);});
Then('the health test passes all explicit assertions',function(){assert.equal(this.results.length,1);assert.equal(this.results[0].status,'passed');});
After(async function(){await this.adapters?.close();});
