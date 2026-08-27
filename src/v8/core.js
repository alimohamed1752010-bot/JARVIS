const crypto = require('node:crypto');

const MAX_SESSION_MESSAGES = Number(process.env.JARVIS_MAX_SESSION_MESSAGES || 30);
const MAX_SUMMARY_CHARS = 1800;
const RATE_LIMIT_WINDOW = Number(process.env.AI_RATE_WINDOW_MS || 60000);
const RATE_LIMIT_MAX = Number(process.env.AI_RATE_MAX || 8);
const usage = new Map();
const requestLocks = new Set();

function sessionKey(guildId, userId) { return `${guildId}:${userId}`; }

function ensureV8(config) {
  config.ai ??= {};
  config.ai.sessions ??= {};
  config.ai.sessionSummaries ??= {};
  config.ai.usage ??= {};
  config.ai.settings ??= { responseStyle: 'adaptive', webSearch: true, autoSummarize: true };
  return config;
}

function getSession(config, guildId, userId) {
  ensureV8(config);
  const key = sessionKey(guildId, userId);
  config.ai.sessions[key] ??= [];
  return config.ai.sessions[key];
}

function pushSession(config, guildId, userId, role, text) {
  const session = getSession(config, guildId, userId);
  session.push({ id: crypto.randomUUID(), role, text: String(text || '').slice(0, 4000), at: new Date().toISOString() });
  while (session.length > MAX_SESSION_MESSAGES) session.shift();
  return session;
}

function clearSession(config, guildId, userId) {
  ensureV8(config);
  delete config.ai.sessions[sessionKey(guildId, userId)];
  delete config.ai.sessionSummaries[sessionKey(guildId, userId)];
}

function getSessionSummary(config, guildId, userId) {
  ensureV8(config);
  return config.ai.sessionSummaries[sessionKey(guildId, userId)] || '';
}

function setSessionSummary(config, guildId, userId, summary) {
  ensureV8(config);
  config.ai.sessionSummaries[sessionKey(guildId, userId)] = String(summary || '').slice(0, MAX_SUMMARY_CHARS);
}

function allowRequest(key, max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW) {
  const now = Date.now();
  const list = (usage.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) return false;
  list.push(now);
  usage.set(key, list);
  return true;
}

function usageSnapshot(config, guildId, userId) {
  ensureV8(config);
  const key = sessionKey(guildId, userId);
  return {
    requests: Number(config.ai.usage[key]?.requests || 0),
    failures: Number(config.ai.usage[key]?.failures || 0),
    tokens: Number(config.ai.usage[key]?.tokens || 0),
    sessionMessages: getSession(config, guildId, userId).length
  };
}

function recordUsage(config, guildId, userId, data = {}) {
  ensureV8(config);
  const key = sessionKey(guildId, userId);
  config.ai.usage[key] ??= { requests: 0, failures: 0, tokens: 0, lastAt: null };
  const u = config.ai.usage[key];
  u.requests += Number(data.requests || 0);
  u.failures += Number(data.failures || 0);
  u.tokens += Number(data.tokens || 0);
  u.lastAt = new Date().toISOString();
  return u;
}

function acquireRequestLock(key) {
  if (requestLocks.has(key)) return false;
  requestLocks.add(key);
  return true;
}
function releaseRequestLock(key) { requestLocks.delete(key); }

function healthSnapshot({ client, getAIStatus, guildCount = 0 }) {
  const ai = getAIStatus();
  return {
    version: '8.0.0',
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    node: process.version,
    discord: Boolean(client?.user),
    guilds: guildCount,
    ai: { enabled: ai.enabled, configured: ai.configured, model: ai.model, fallback: ai.fallbackModel || null },
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  ensureV8, getSession, pushSession, clearSession, getSessionSummary, setSessionSummary,
  allowRequest, usageSnapshot, recordUsage, acquireRequestLock, releaseRequestLock, healthSnapshot,
  MAX_SESSION_MESSAGES
};
