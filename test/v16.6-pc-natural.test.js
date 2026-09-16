const test = require('node:test');
const assert = require('node:assert/strict');
const pc = require('../src/core/pcTools');

test('V16.6 exposes dynamic application discovery helpers', () => {
  assert.equal(typeof pc.discoverApplication, 'function');
  assert.equal(typeof pc.discoverStartApp, 'function');
  assert.equal(typeof pc.discoverEpicGame, 'function');
  assert.equal(typeof pc.discoverModrinthProfile, 'function');
});

test('V16.6 PC tool module still exposes working actions', () => {
  for (const name of ['openApp','setVolume','browserSearch','spotifyPlay']) assert.equal(typeof pc[name], 'function');
});
