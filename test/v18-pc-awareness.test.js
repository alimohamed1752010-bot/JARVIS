const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pc=fs.readFileSync('src/core/pcTools.js','utf8');
const agent=fs.readFileSync('src/core/agent.js','utf8');
const validator=fs.readFileSync('src/core/planValidator.js','utf8');
const ai=fs.readFileSync('src/ai/ai.js','utf8');
test('V18 exposes read-only PC awareness actions',()=>{
  for(const x of ['systemStatus','activeWindow','networkStatus','pcState']) assert.match(pc,new RegExp(`async function ${x}\\(`));
  for(const x of ['pc_system_status','pc_active_window','pc_network_status','pc_state']) { assert.match(validator,new RegExp(x)); assert.match(agent,new RegExp(x)); }
  assert.match(ai,/pc_state combines those read-only signals/);
});
test('V18 planner includes live PC context without granting extra authority',()=>{
  assert.match(agent,/LIVE PC CONTEXT/);
  assert.match(agent,/pcBridge\.execute\('pc_state'/);
  assert.match(ai,/treat it as observational, not permission/);
});
test('V18 keeps verified browser and existing PC tools',()=>{
  assert.match(pc,/openBrowserUrl/);
  assert.match(pc,/findBrowserExecutable/);
  for(const x of ['openApp','openUrl','browserSearch','spotifyPlay','setVolume']) assert.match(pc,new RegExp(`function ${x}\\(`));
});
