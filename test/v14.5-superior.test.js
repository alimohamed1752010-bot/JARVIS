const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const graph=require('../src/core/serverGraph');

test('V14.5 relationship graph exposes connected server objects',()=>{
  const g={nodes:[{id:'role:r1',type:'role',label:'Moderators',meta:{permissions:'0',managed:false}},{id:'member:m1',type:'member',label:'Steve',meta:{}},{id:'channel:c1',type:'channel',label:'Gen 2',meta:{}}],edges:[{from:'member:m1',to:'role:r1',type:'member_of'},{from:'member:m1',to:'channel:c1',type:'in_voice'}]};
  const r=graph.findRelated(g,'Steve');
  assert.equal(r.matches.length,1); assert.equal(r.related.length,2);
});

test('V14.5 diagnosis detects administrator roles',()=>{
  const g={nodes:[{id:'role:r1',type:'role',label:'Admin',meta:{permissions:String(8),managed:false}}],edges:[]};
  const d=graph.diagnose(g);
  assert.ok(d.findings.some(x=>x.type==='admin_role'));
});

test('V14.5 autopilot receives saveConfig dependency',()=>{
  const s=fs.readFileSync(path.join(__dirname,'..','src/systems/autopilot.js'),'utf8');
  assert.match(s,/function start\(client,\{getConfig,saveConfig,logEvent,recordKnowledge\}\)/);
});



test('V14.5 agent does not turn planner failure into a user-facing plan error',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src/core/agent.js'),'utf8');
  const guard=source.indexOf('if (!rawPlan) return {handled:false};');
  const validation=source.indexOf('const validation=validatePlan(rawPlan,message.guild);');
  assert.ok(guard>=0, 'null planner guard is missing');
  assert.ok(validation>guard, 'validation must happen after the null-plan guard');
});

test('V14.5 planner parser tolerates a JSON preamble from the model',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src/ai/ai.js'),'utf8');
  assert.match(source,/if \(!raw\.startsWith\('\{'\)\)/);
  assert.match(source,/lastIndexOf\('\}'\)/);
});


test('V14.5.4 permission normalizer accepts natural soundboard access wording',()=>{
  const {normalizePermission}=require('../src/core/discordActionUtils');
  assert.ok(normalizePermission('soundboard access perms'));
  assert.ok(normalizePermission('use soundboard access'));
});

test('V14.5.4 deterministic role creation handles soundboard access and direct owner execution',()=>{
  const {deterministicAgentPlan}=require('../src/core/agent');
  const plan=deterministicAgentPlan('make the role named "labubu" with soundboard access perms and give it to seif');
  assert.ok(plan);
  assert.equal(plan.needsConfirmation,false);
  assert.equal(plan.steps[0].action,'role_create');
  assert.equal(plan.steps[0].permissionChanges[0].permission,'soundboard access perms');
  assert.equal(plan.steps[1].action,'role_add');
  assert.deepEqual(plan.steps[1].targets,['seif']);
});

test('V14.5.4 channel resolver normalizes punctuation and sec shorthand',()=>{
  const {resolveChannel}=require('../src/core/resolver');
  const guild={channels:{cache:new Map([
    ['1',{id:'1',name:'secret 1',type:2}],
    ['2',{id:'2',name:'general 2',type:2}]
  ])}};
  const r=resolveChannel(guild,'sec 1',{voiceOnly:false});
  assert.equal(r.status,'resolved');
  assert.equal(r.channel.id,'1');
});
