const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function defaultConfig() {
  return {
    version: 3,
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    welcomeMessage: process.env.WELCOME_MESSAGE || 'Welcome {user} to **{server}**! 🎉',
    muteRoleId: null,
    autoroleId: null,
    verificationRoleId: null,
    verificationChannelId: null,
    ticketCategoryId: null,
    ticketLogChannelId: null,
    lockdown: false,
    maintenance: false,
    automod: {
      enabled: false, antiSpam: true, antiLinks: false, antiInvites: true,
      maxMentions: 5, spamWindowMs: 6000, spamMaxMessages: 6,
      repeatedMessageLimit: 4, blockedWords: [], exemptRoleIds: [], exemptUserIds: [], exemptChannelIds: []
    },
    antiRaid: { enabled: false, joins: 8, windowMs: 10000, lockdown: true, suspiciousAccountDays: 3 },
    antiNuke: { enabled: true, channelDeleteLimit: 5, roleDeleteLimit: 5, actionWindowMs: 10000 },
    warnings: {},
    cases: [],
    customCommands: {},
    reminders: [],
    ai: {
      enabled: true, memoryEnabled: true, memoryTtlMs: 72 * 60 * 60 * 1000,
      maxHistory: 12, personality: 'classic', customPersonality: '',
      adminPreferences: {},
      memory: {}
    },
    security: { trustedUserIds: [], trustedRoleIds: [] }
  };
}

function normalizeConfig(input = {}) {
  const d = defaultConfig();
  const c = { ...d, ...input };
  c.automod = { ...d.automod, ...(input.automod || {}) };
  c.antiRaid = { ...d.antiRaid, ...(input.antiRaid || {}) };
  c.antiNuke = { ...d.antiNuke, ...(input.antiNuke || {}) };
  c.ai = { ...d.ai, ...(input.ai || {}) };
  c.security = { ...d.security, ...(input.security || {}) };
  c.warnings = input.warnings && typeof input.warnings === 'object' ? input.warnings : {};
  c.cases = Array.isArray(input.cases) ? input.cases : [];
  c.customCommands = input.customCommands && typeof input.customCommands === 'object' ? input.customCommands : {};
  c.reminders = Array.isArray(input.reminders) ? input.reminders : [];
  c.ai.memory = input.ai?.memory && typeof input.ai.memory === 'object' ? input.ai.memory : {};
  return c;
}

function filePath(guildId) { return path.join(DATA_DIR, `${guildId}.json`); }
function ensureDirs() { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

function getConfig(guildId) {
  ensureDirs();
  const file = filePath(guildId);
  if (!fs.existsSync(file)) return defaultConfig();
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    console.error(`[CONFIG ERROR] ${guildId}:`, error.message);
    try {
      fs.copyFileSync(file, path.join(BACKUP_DIR, `${guildId}-corrupt-${Date.now()}.json`));
    } catch {}
    return defaultConfig();
  }
}

function saveConfig(guildId, config, { backup = true } = {}) {
  ensureDirs();
  const normalized = normalizeConfig(config);
  const file = filePath(guildId);
  const tmp = `${file}.${process.pid}.tmp`;
  if (backup && fs.existsSync(file)) {
    try { fs.copyFileSync(file, path.join(BACKUP_DIR, `${guildId}-${Date.now()}.json`)); } catch (error) { console.warn('[CONFIG BACKUP]', error.message); }
  }
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmp, file);
  return normalized;
}

function updateConfig(guildId, mutator, options) {
  const c = getConfig(guildId);
  mutator(c);
  return saveConfig(guildId, c, options);
}

function pruneBackups(guildId, keep = 10) {
  ensureDirs();
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith(`${guildId}-`) && f.endsWith('.json')).sort().reverse();
  for (const old of files.slice(keep)) { try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch {} }
}

function addCase(guildId, data) {
  const c = getConfig(guildId);
  const id = (c.cases.reduce((max, x) => Math.max(max, Number(x.id) || 0), 0) || 0) + 1;
  const entry = { id, at: new Date().toISOString(), ...data };
  c.cases.push(entry);
  if (c.cases.length > 2000) c.cases = c.cases.slice(-2000);
  saveConfig(guildId, c);
  pruneBackups(guildId);
  return entry;
}

function addWarning(guildId, userId, reason, moderator) {
  const c = getConfig(guildId);
  c.warnings[userId] ??= [];
  c.warnings[userId].push({ reason: reason || 'No reason provided', moderator, at: new Date().toISOString() });
  if (c.warnings[userId].length > 100) c.warnings[userId] = c.warnings[userId].slice(-100);
  saveConfig(guildId, c);
  return c.warnings[userId];
}
function getWarnings(guildId, userId) { return getConfig(guildId).warnings[userId] || []; }
function clearWarnings(guildId, userId) { updateConfig(guildId, c => delete c.warnings[userId]); }

module.exports = { DATA_DIR, defaultConfig, normalizeConfig, getConfig, saveConfig, updateConfig, addCase, addWarning, getWarnings, clearWarnings, pruneBackups };
