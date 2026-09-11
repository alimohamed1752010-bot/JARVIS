const test=require('node:test');
const assert=require('node:assert/strict');
const superior=require('../src/systems/superior');

test('V15 superior state initializes watch and schedules',()=>{
  const cfg={}; const v=superior.ensure(cfg);
  assert.equal(v.watch.enabled,false); assert.deepEqual(v.watch.channels,[]); assert.deepEqual(v.scheduledActions,[]);
});
test('V15 action history formatting is deterministic',()=>{
  const cfg={v9:{actionJournal:[{id:4,at:new Date().toISOString(),status:'SUCCESS',action:'ROLE_ADD',targetId:'123',reason:'test'}]}};
  const out=superior.formatHistory(cfg,5);
  assert.match(out,/#4/); assert.match(out,/ROLE_ADD/); assert.match(out,/<@123>/);
});
test('V15 case explanation reports stored evidence',()=>{
  const cfg={cases:[{id:7,at:new Date().toISOString(),action:'SECURITY-ALERT',userId:'55',moderatorId:'66',reason:'possible nuke',evidence:{count:4}}]};
  const out=superior.explainCase(cfg,7);
  assert.match(out,/CASE #7/); assert.match(out,/possible nuke/); assert.match(out,/"count": 4/);
});
