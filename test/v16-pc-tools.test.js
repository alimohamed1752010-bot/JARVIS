const test = require('node:test');
const assert = require('node:assert/strict');
const pc = require('../src/core/pcTools');

test('V16 PC tool module exposes unified desktop capabilities', () => {
  for (const name of ['openApp','closeApp','listProcesses','setVolume','key','typeText','hotkey','mouse','screenshot','openUrl','fileAction','shell']) {
    assert.equal(typeof pc[name], 'function', `${name} should be exported`);
  }
});

test('V16 PC shell safety blocks destructive system commands', async () => {
  if (pc.IS_WIN) {
    await assert.rejects(() => pc.shell('Remove-Item -Recurse C:\\Windows'), /blocked/i);
  } else {
    await assert.rejects(() => pc.shell('whoami'), /Windows/i);
  }
});
