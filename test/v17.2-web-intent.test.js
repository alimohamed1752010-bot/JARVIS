const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const agent=fs.readFileSync('src/core/agent.js','utf8');
const ai=fs.readFileSync('src/ai/ai.js','utf8');
test('legacy web intent regression remains valid in V18',()=>{
  assert.match(agent,/gmail:'https:\/\/mail\.google\.com\//);
  assert.match(agent,/tiktok:'https:\/\/www\.tiktok\.com\//);
  assert.match(agent,/JARVIS V18\.0 EXECUTION/);
  assert.match(ai,/ALWAYS use pc_open_url for known sites/);
});
