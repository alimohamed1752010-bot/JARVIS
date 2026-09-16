const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const agent=fs.readFileSync(path.join(__dirname,'..','src','core','agent.js'),'utf8');

test('V17.1 strips yo/hey/hi/ok jarvis prefixes and get-everything-ready filler',()=>{
  assert.match(agent,/\\(\\?:yo\\|hey\\|hi\\|ok\\|okay\\)\\s\\+\\)\\?jarvis/);
  assert.match(agent,/get\\s\\+everything\\s\\+ready/);
});
test('V17.1 execution label is current',()=>assert.match(agent,/JARVIS V17\\.1 EXECUTION/));
test('V17.1 has deterministic TikTok and Gmail web aliases',()=>{
  assert.match(agent,/gmail:'https:\\/\\/mail\\.google\\.com\\//);
  assert.match(agent,/tiktok:'https:\\/\\/www\\.tiktok\\.com\\//);
});
