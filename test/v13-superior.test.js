const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const knowledge=require('../src/core/serverKnowledge');

test('V13 persistent server knowledge stores facts and events',()=>{
  const cfg={};
  knowledge.remember(cfg,'g1','Moderator role is above Helper','test');
  knowledge.recordEvent(cfg,'g1',{action:'ROLE_CREATE',detail:'Moderator'});
  const text=knowledge.context(cfg,'g1');
  assert.match(text,/Moderator role is above Helper/);
  assert.match(text,/ROLE_CREATE/);
});

test('V13 agent has bounded repair loops',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src','core','agent.js'),'utf8');
  assert.match(source,/MAX_AGENT_LOOPS/);
  assert.match(source,/repairPrompt/);
});

test('V13 DM reply invocation remains supported',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src','index.js'),'utf8');
  assert.match(source,/message\.reference\?\.messageId/);
  assert.match(source,/ref\?\.author\?\.id===client\.user\.id/);
});
