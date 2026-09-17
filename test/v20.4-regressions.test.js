const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JARVIS_PC_URL='ws://localhost';
process.env.JARVIS_PC_TOKEN='test';
const agent = require('../src/core/agent');

test('V20.4 deterministic close routes Spotify to pc_close_app', () => {
  const plan = agent.deterministicAgentPlan('Jarvis, close Spotify.');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].action, 'pc_close_app');
  assert.equal(plan.steps[0].name, 'Spotify');
});

test('V20.4 close accepts app/window suffixes', () => {
  for (const input of ['close the Spotify app', 'quit Spotify window', 'exit Spotify']) {
    const plan = agent.deterministicAgentPlan(input);
    assert.equal(plan.steps[0].action, 'pc_close_app');
    assert.equal(plan.steps[0].name, 'Spotify');
  }
});

test('V20.4 invalid volume is preserved for the PC validator/tool to reject', () => {
  const plan = agent.deterministicAgentPlan('Jarvis, set volume to 200');
  assert.equal(plan.steps[0].action, 'pc_volume');
  assert.equal(plan.steps[0].durationMs, 200);
});

test('V20.4 ordinary conversation is not falsely marked as handled by the deterministic planner', () => {
  assert.equal(agent.deterministicAgentPlan('Bro stop saying done.'), null);
});
