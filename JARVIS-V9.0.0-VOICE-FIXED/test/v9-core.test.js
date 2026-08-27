const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const files=[
  'src/core/commandEngine.js','src/core/resolver.js','src/core/permissions.js','src/core/executor.js',
  'src/core/context.js','src/core/confirmations.js','src/core/journal.js','src/core/awareness.js',
  'src/core/simulator.js','src/core/toolRegistry.js','src/systems/eventAwareness.js','src/ai/ai.js','src/index.js'
];
for(const file of files){assert.ok(fs.existsSync(path.join(__dirname,'..',file)),`Missing ${file}`);}
assert.match(fs.readFileSync(path.join(__dirname,'..','src/core/commandEngine.js'),'utf8'),/voicemove/);
assert.match(fs.readFileSync(path.join(__dirname,'..','src/core/commandEngine.js'),'utf8'),/excludeTargets/);
assert.match(fs.readFileSync(path.join(__dirname,'..','src/core/executor.js'),'utf8'),/reversible/);
console.log('JARVIS V9 structural tests passed.');
