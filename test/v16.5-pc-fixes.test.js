const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPlan, deterministicAgentPlan } = require('../src/core/agent');

test('V16.5 keeps PC volume as a 0-100 value during plan cleaning', () => {
  const plan = cleanPlan({summary:'volume', needsConfirmation:false, steps:[{action:'pc_volume', durationMs:50}]});
  assert.equal(plan.steps[0].durationMs, 50);
});

test('V16.5 deterministic fallback understands YouTube and Minecraft', () => {
  const plan = deterministicAgentPlan('open YouTube, set the volume to 50 percent, then launch Minecraft');
  assert.ok(plan);
  assert.deepEqual(plan.steps.map(x=>x.action), ['pc_open_url','pc_volume','pc_open_app']);
  assert.equal(plan.steps[1].durationMs, 50);
  assert.equal(plan.steps[2].name, 'minecraftlauncher');
});
