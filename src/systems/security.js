const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getConfig, saveConfig, addCase } = require('../utils/config');
const { logEvent } = require('./logger');

const joinBuckets = new Map();
const spamBuckets = new Map();
const nukeBuckets = new Map();

function trusted(guild, member, config, channelId) {
  if (!member) return false;
  if (member.id === guild.ownerId) return true;
  if (config.security.trustedUserIds.includes(member.id)) return true;
  if (member.roles.cache.some(r => config.security.trustedRoleIds.includes(r.id))) return true;
  if (channelId && config.automod.exemptChannelIds.includes(channelId)) return true;
  if (member.roles.cache.some(r => config.automod.exemptRoleIds.includes(r.id))) return true;
  return config.automod.exemptUserIds.includes(member.id);
}

async function securityAlert(guild, title, description, color = 0xED4245) {
  console.warn(`[SECURITY] ${guild.name}: ${title} — ${description}`);
  await logEvent(guild, { title: `🚨 ${title}`, description, color });
}

async function lockGuild(guild, reason = 'Security threat detected') {
  const config = getConfig(guild.id); config.lockdown = true; saveConfig(guild.id, config);
  let changed = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased() || channel.isThread()) continue;
    try {
      const everyone = guild.roles.everyone;
      const overwrite = channel.permissionOverwrites.cache.get(everyone.id);
      if (!overwrite || overwrite.allow.has(PermissionFlagsBits.SendMessages)) {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: `JARVIS lockdown: ${reason}` }); changed++;
      }
    } catch (error) { console.warn(`[LOCKDOWN] #${channel.name}: ${error.message}`); }
  }
  await securityAlert(guild, 'SERVER LOCKDOWN ACTIVATED', `**Reason:** ${reason}\n**Channels changed:** ${changed}`);
  return changed;
}

async function unlockGuild(guild, reason = 'Staff request') {
  const config = getConfig(guild.id); config.lockdown = false; saveConfig(guild.id, config);
  let changed = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased() || channel.isThread()) continue;
    try { await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }, { reason: `JARVIS unlock: ${reason}` }); changed++; } catch {}
  }
  await logEvent(guild, { title: '🔓 SERVER LOCKDOWN LIFTED', description: `Reason: ${reason}\nChannels restored: ${changed}`, color: 0x57F287 });
  return changed;
}

async function onMemberJoin(member) {
  const config = getConfig(member.guild.id);
  if (!config.antiRaid.enabled) return;
  const key = member.guild.id; const now = Date.now();
  const arr = (joinBuckets.get(key) || []).filter(t => now - t < config.antiRaid.windowMs); arr.push(now); joinBuckets.set(key, arr);
  if (arr.length >= config.antiRaid.joins) {
    await securityAlert(member.guild, 'MASS JOIN DETECTED', `Detected **${arr.length} joins** in ${config.antiRaid.windowMs / 1000}s.`, 0xFEE75C);
    if (config.antiRaid.lockdown && !config.lockdown) await lockGuild(member.guild, 'Possible raid detected');
  }
}

async function onMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return { blocked: false };
  const config = getConfig(message.guild.id);
  if (!config.automod.enabled || trusted(message.guild, message.member, config, message.channel.id)) return { blocked: false };
  const text = message.content || '';
  const now = Date.now(); const key = `${message.guild.id}:${message.author.id}`;
  const bucket = (spamBuckets.get(key) || []).filter(x => now - x.at < config.automod.spamWindowMs); bucket.push({ at: now, text }); spamBuckets.set(key, bucket);
  let reason = null;
  if (config.automod.antiInvites && /(discord\.gg|discord(?:app)?\.com\/invite)\//i.test(text)) reason = 'Discord invite spam';
  if (!reason && config.automod.antiLinks && /https?:\/\/\S+/i.test(text)) reason = 'Link filtering';
  if (!reason && config.automod.maxMentions > 0 && message.mentions.users.size + message.mentions.roles.size > config.automod.maxMentions) reason = 'Mention flooding';
  if (!reason && config.automod.blockedWords.some(w => w && text.toLowerCase().includes(String(w).toLowerCase()))) reason = 'Blocked word';
  const same = bucket.slice(-config.automod.repeatedMessageLimit).filter(x => x.text === text).length;
  if (!reason && config.automod.antiSpam && same >= config.automod.repeatedMessageLimit) reason = 'Repeated-message spam';
  if (!reason && config.automod.antiSpam && bucket.length >= config.automod.spamMaxMessages) reason = 'Message flooding';
  if (!reason) return { blocked: false };
  try { await message.delete(); } catch {}
  const c = addCase(message.guild.id, { action: 'AUTOMOD', userId: message.author.id, moderatorId: message.client.user.id, reason, channelId: message.channel.id });
  await logEvent(message.guild, { title: '🛡 AUTOMOD ACTION', description: `**${message.author.tag}** triggered JARVIS security.`, fields: [{ name: 'Reason', value: reason }, { name: 'Case', value: `#${c.id}` }], color: 0xFEE75C });
  return { blocked: true, reason };
}

function trackAuditAction(guildId, actorId, type) {
  const key = `${guildId}:${actorId}:${type}`; const now = Date.now(); const arr = (nukeBuckets.get(key) || []).filter(t => now - t < 15000); arr.push(now); nukeBuckets.set(key, arr); return arr.length;
}

async function onAuditLogEntry(entry, guild) {
  const config = getConfig(guild.id); if (!config.antiNuke.enabled || !entry.executorId) return;
  if (entry.executorId === guild.client.user.id || entry.executorId === guild.ownerId) return;
  const type = String(entry.action).includes('ChannelDelete') ? 'channel-delete' : String(entry.action).includes('RoleDelete') ? 'role-delete' : String(entry.action);
  const count = trackAuditAction(guild.id, entry.executorId, type);
  const limit = type === 'channel-delete' ? config.antiNuke.channelDeleteLimit : config.antiNuke.roleDeleteLimit;
  if (count >= limit) {
    await securityAlert(guild, 'POSSIBLE NUKE DETECTED', `Actor <@${entry.executorId}> triggered **${count} ${type} actions** in ${config.antiNuke.actionWindowMs / 1000}s.`);
    if (!config.lockdown) await lockGuild(guild, `Possible server nuke by <@${entry.executorId}>`);
  }
}

module.exports = { trusted, lockGuild, unlockGuild, onMemberJoin, onMessage, onAuditLogEntry };
