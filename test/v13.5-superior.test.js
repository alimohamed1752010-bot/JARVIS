const test=require('node:test');
const assert=require('node:assert/strict');
const knowledge=require('../src/core/serverKnowledge');

test('V13.5 learns recurring server behavior',()=>{const c={};knowledge.recordEvent(c,'g',{action:'CHANNEL_RENAME',detail:'general → gen'});knowledge.recordEvent(c,'g',{action:'CHANNEL_RENAME',detail:'general → gen'});assert.equal(knowledge.behavior(c,'g').CHANNEL_RENAME.count,2);assert.match(knowledge.context(c,'g'),/LEARNED SERVER BEHAVIOR/);});
test('V13.5 bounds anomalies',()=>{const c={};for(let i=0;i<120;i++)knowledge.recordAnomaly(c,'g',{type:'x',detail:String(i)});assert.equal(knowledge.get(c,'g').anomalies.length,100);});
test('V13.5 autopilot is alert-only for dangerous events',()=>{const s=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','src/systems/autopilot.js'),'utf8');assert.match(s,/No destructive automatic action was taken/);});
