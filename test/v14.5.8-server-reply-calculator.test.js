const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeMath } = require('../src/v8/tools');

test('safeMath handles natural-language server reply math', () => {
  assert.equal(safeMath('how about 6x6x6'), '216');
  assert.equal(safeMath('what is 5x5x5'), '125');
  assert.equal(safeMath("what's 12 / 3"), '4');
  assert.equal(safeMath('calculate 7 times 8'), null);
});

test('safeMath still rejects non-arithmetic requests', () => {
  assert.equal(safeMath('how about building a 6x6x6 cube'), null);
});


test('direct server replies persist both sides of every non-AI turn for follow-up context', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(source, /function rememberDirectReplyTurn/);
  assert.match(source, /pushSession\(config, message\.guild\.id, message\.author\.id, 'user', user\)/);
  assert.match(source, /pushSession\(config, message\.guild\.id, message\.author\.id, 'model', model\)/);
  assert.match(source, /rememberDirectReplyTurn\(message, rawContent, mathReply\)/);
  assert.match(source, /rememberDirectReplyTurn\(message, rawContent, agentReply\)/);
});
