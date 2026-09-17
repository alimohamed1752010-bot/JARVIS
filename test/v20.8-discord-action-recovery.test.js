const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const agent=fs.readFileSync(path.join(root,'src/core/agent.js'),'utf8');
const index=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const voice=fs.readFileSync(path.join(root,'src/pc-agent/voice.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'src/pc-agent/local_voice_worker.py'),'utf8');
const mod=require(path.join(root,'src/core/agent.js'));

test('time Oraby out is a direct timeout plan, not an empty mixed-command request',()=>{
  const plan=mod.deterministicAgentPlan('time Oraby out');
  assert.ok(plan);
  assert.equal(plan.steps.length,1);
  assert.equal(plan.steps[0].action,'timeout');
  assert.deepEqual(plan.steps[0].targets,['Oraby']);
});

test('mixed PC + timeout extraction remains supported',()=>{
  const plan=mod.deterministicAgentPlan('open tiktok then time Oraby out for 1 minute');
  assert.ok(plan);
  assert.ok(plan.steps.some(s=>s.action==='pc_open_url'));
  const timeout=plan.steps.find(s=>s.action==='timeout');
  assert.ok(timeout);
  assert.deepEqual(timeout.targets,['Oraby']);
  assert.equal(timeout.durationMs,60000);
});

test('confirmation router runs before the AI planner',()=>{
  const c=index.indexOf('const confirmed = await confirmV11Plan');
  const a=index.indexOf('const agent = await runAgent({message, prompt:universalPrompt');
  assert.ok(c>=0 && a>=0 && c<a);
});

test('legacy confirmations are still available',()=>{
  assert.match(index,/const legacy = await routeV9Command/);
  assert.match(agent,/go ahead|execute/);
});

test('local voice invalidates stale command generations',()=>{
  assert.match(voice,/let commandGeneration = 0/);
  assert.match(voice,/commandGeneration \+= 1/);
  assert.match(voice,/commandId !== commandGeneration/);
  assert.match(voice,/speakLocal\(speech, commandId\)/);
  assert.match(worker,/beam_size=10/);
  assert.match(worker,/best_of=10/);
  assert.match(worker,/Time out, Oraby/);
});
