const test=require('node:test');
const assert=require('node:assert/strict');
const reasoning=require('../src/core/reasoning');
const fs=require('node:fs');

test('V14 correlates repeated security signals',()=>{
  const cfg={};
  for(let i=0;i<8;i++) reasoning.addTimeline(cfg,'g',{type:'member_join',detail:`join ${i}`});
  for(let i=0;i<3;i++) reasoning.addTimeline(cfg,'g',{type:'role_permission_change',detail:`perm ${i}`});
  const r=reasoning.correlate(cfg,'g');
  assert.ok(r.signals.some(x=>x.title==='Unusual join burst'));
  assert.ok(r.signals.some(x=>x.title==='Rapid permission changes'));
});

test('V14 agent and validator are wired for investigation',()=>{
  const agent=fs.readFileSync(require.resolve('../src/core/agent'),'utf8');
  const validator=fs.readFileSync(require.resolve('../src/core/planValidator'),'utf8');
  const planner=fs.readFileSync(require.resolve('../src/ai/ai'),'utf8');
  assert.match(agent,/server_investigate/);
  assert.match(validator,/server_investigate/);
  assert.match(planner,/server_investigate/);
  assert.match(planner,/server_relationship/);
});
