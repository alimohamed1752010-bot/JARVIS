const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
const agent = fs.readFileSync(path.join(root, 'src/core/agent.js'), 'utf8');
const ai = fs.readFileSync(path.join(root, 'src/ai/ai.js'), 'utf8');
const executor = fs.readFileSync(path.join(root, 'src/core/executor.js'), 'utf8');

test('V15.1 routes universal server invocations through the AI-first router', () => {
  assert.match(index, /V15\.1 AI-FIRST UNIVERSAL ROUTER/);
  assert.match(index, /runAgent\(\{message, prompt:universalPrompt/);
  assert.match(index, /V11 agent already ran in the universal AI-first router/);
});

test('V15.1 agent asks AI planner before deterministic parser fallback', () => {
  const aiPos = agent.indexOf('await parseAgentPlan({message,prompt:plannerPrompt})');
  const deterministicFallbackPos = agent.indexOf('if(!rawPlan && deterministicPlan) rawPlan=deterministicPlan');
  assert.ok(aiPos >= 0 && deterministicFallbackPos > aiPos);
});

test('V15.1 planner supports role editing and richer Discord actions', () => {
  assert.match(ai, /role_edit/);
  assert.match(ai, /color/);
  assert.match(ai, /mentionable/);
});

test('V15.1 executor supports role appearance/permission editing', () => {
  assert.match(executor, /action==='role_edit'/);
  assert.match(executor, /targetRole\.edit\(opts\)/);
  assert.match(executor, /opts\.color/);
});

test('V15.1 channel permission targets are not limited to roles', () => {
  assert.match(agent, /guild\.roles\.everyone/);
  assert.match(agent, /resolveMember\(message\.guild,ref\)/);
});
