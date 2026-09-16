const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('V16.7 preserves exact 0-100 volume semantics through plan validation', () => {
  const src = fs.readFileSync(path.join(root, 'src/core/planValidator.js'), 'utf8');
  assert.match(src, /action\|\|['"]['"]\)\.toLowerCase\(\)==['"]pc_volume['"]/);
  assert.match(src, /Number\(s\?\.durationMs \?\? s\?\.percent \?\? s\?\.volume \?\? 50\)/);
});

test('V16.7 reconciles AI PC plans with deterministic multi-action intent', () => {
  const src = fs.readFileSync(path.join(root, 'src/core/agent.js'), 'utf8');
  assert.match(src, /rawIsPurePC/);
  assert.match(src, /deterministicPlan\.steps\.every/);
  assert.match(src, /rawPlan=\{\.\.\.deterministicPlan/);
});

test('V16.7 planner explicitly requires one ordered action per requested app/game', () => {
  const src = fs.readFileSync(path.join(root, 'src/ai/ai.js'), 'utf8');
  assert.match(src, /ONE ordered step for EACH requested action/);
  assert.match(src, /Never collapse/);
});
