const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('V10 voice is text-to-TTS only and contains no active STT receiver', () => {
  const voice = fs.readFileSync(path.join(__dirname, '..', 'src', 'v8', 'voice.js'), 'utf8');
  assert.doesNotMatch(voice, /receiver\.subscribe|VoiceReceiver|transcribePcm|AudioReceiveStream|onTranscript/);
  assert.match(voice, /speakText/);
  assert.match(voice, /setTtsEnabled/);
  assert.match(voice, /createAudioPlayer/);
});

test('V10 package removes receive-only voice dependencies', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.version, '11.0.0');
  assert.equal(pkg.dependencies['prism-media'], undefined);
  assert.equal(pkg.dependencies['opusscript'], undefined);
});


test('V10 command router recognizes who am I without member resolution', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'commandEngine.js'), 'utf8');
  assert.match(source, /action:'whoami'/);
  assert.match(source, /if\(intent\.action==='whoami'\)/);
  assert.match(source, /message\.author\.id/);
});
