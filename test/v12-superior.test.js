const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const risk=require('../src/core/risk');

test('V12.1 DM reply continuity exports the DM AI handler',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src','ai','ai.js'),'utf8');
  assert.match(source,/async function conversationalReplyDM/);
  assert.match(source,/conversationalReplyDM,clearMemory/);
  const index=fs.readFileSync(path.join(__dirname,'..','src','index.js'),'utf8');
  assert.match(index,/message\.reference\?\.messageId/);
  assert.match(index,/ref\?\.author\?\.id===client\.user\.id/);
});

test('V12.1 plan validator is wired into the superior agent',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src','core','agent.js'),'utf8');
  assert.match(source,/validatePlan/);
  assert.match(source,/summarizePlan/);
});

test('V12.1 risk engine treats bans as critical',()=>{
  assert.equal(risk.label(risk.level({action:'ban'})),'CRITICAL');
});
