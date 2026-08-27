const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('V11 package version is bumped and no dependency was removed from V10.1.0', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.version, '11.0.0');
  for (const dep of ['discord.js', 'dotenv', '@google/genai', '@discordjs/voice', 'ffmpeg-static']) {
    assert.ok(pkg.dependencies[dep], `Expected dependency ${dep} to still be present`);
  }
});

test('V11 reminders persist to config instead of living only in memory', () => {
  const index = read('src/index.js');
  assert.match(index, /function scheduleReminder/);
  assert.match(index, /function rehydrateReminders/);
  assert.match(index, /cfg\.reminders\.push\(entry\)/);
  assert.match(index, /rehydrateReminders\(\)/);
  // The old bare setTimeout-only implementation should be gone.
  assert.doesNotMatch(index, /reminders\.delete\(timer\)/);
});

test('V11 wires the previously-unused memoryLayers module into real commands', () => {
  const index = read('src/index.js');
  assert.match(index, /require\("\.\/core\/memoryLayers"\)/);
  assert.match(index, /registerCommand\("note"/);
  assert.match(index, /registerCommand\("notes"/);
  assert.match(index, /registerCommand\("pref"/);
  assert.match(index, /registerCommand\("myprefs"/);
});

test('V11 generalizes the scheduler without changing the existing daily briefing loop', () => {
  const scheduler = read('src/systems/scheduler.js');
  assert.match(scheduler, /function startScheduler/);
  assert.match(scheduler, /function startJobScheduler/);
  assert.match(scheduler, /dailyBriefing/); // untouched V10 behavior still present
  assert.match(scheduler, /scheduledJobs/);
  const index = read('src/index.js');
  assert.match(index, /startJobScheduler\(client,getConfig,saveConfig\)/);
  assert.match(index, /registerCommand\("schedule"/);
});

test('V11 adds informational activity-spike detection without altering existing analytics exports', () => {
  const analytics = read('src/systems/analytics.js');
  for (const fn of ['recordMessage', 'getTopUsers', 'getAnalytics', 'getRecentRate', 'isSpiking']) {
    assert.match(analytics, new RegExp(fn));
  }
  const index = read('src/index.js');
  assert.match(index, /registerCommand\("ratecheck"/);
});

test('V11 tool registry stays a superset of the V10 tool registry', () => {
  const registry = read('src/core/toolRegistry.js');
  for (const tool of ["'calculator'", "'server.snapshot'", "'member.resolve'", "'channel.resolve'"]) {
    assert.ok(registry.includes(tool), `Expected tool ${tool} to still be registered`);
  }
  assert.ok(registry.includes("'clock'"), 'Expected new clock tool');
  assert.ok(registry.includes("'server.status'"), 'Expected new server.status tool');
});

test('V11 exposes full case detail without removing the existing history command', () => {
  const engine = read('src/core/commandEngine.js');
  assert.match(engine, /action:'history'/);
  assert.match(engine, /action:'caseinfo'/);
  assert.match(engine, /journal\.get\(config,intent\.caseId\)/);
});

test('V11 dashboard auto-refreshes and keeps every existing status field', () => {
  const dashboard = read('src/dashboard.js');
  assert.match(dashboard, /http-equiv="refresh"/);
  for (const field of ['data.discord', 'data.ai', 'data.voice', 'g.automod', 'g.antiRaid', 'g.lockdown', 'g.top']) {
    assert.ok(dashboard.includes(field), `Expected dashboard to still render ${field}`);
  }
});

console.log('JARVIS V11 structural tests passed.');
