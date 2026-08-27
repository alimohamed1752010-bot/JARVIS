const { PermissionsBitField, ChannelType } = require('discord.js');

async function fetchAllMembers(guild) {
  try { await guild.members.fetch(); } catch (e) { console.error('[MEMBER FETCH]', e.message); }
  return guild.members.cache;
}

function findMembers(guild, query) {
  const q = String(query || '').trim().toLowerCase().replace(/^[@#]/, '');
  if (!q) return guild.members.cache;
  // Prefer exact identity matches. The previous `first()` over substring
  // matches could select an unrelated member when several names matched.
  const exact = guild.members.cache.filter(m =>
    m.id === q ||
    m.user.username.toLowerCase() === q ||
    (m.user.globalName || '').toLowerCase() === q ||
    m.displayName.toLowerCase() === q ||
    m.user.tag.toLowerCase() === q
  );
  if (exact.size) return exact;
  return guild.members.cache.filter(m =>
    m.user.username.toLowerCase().includes(q) ||
    (m.user.globalName || '').toLowerCase().includes(q) ||
    m.displayName.toLowerCase().includes(q) ||
    m.user.tag.toLowerCase().includes(q) || m.id === q
  );
}

async function getMember(guild, query) {
  await fetchAllMembers(guild);
  if (!query) return null;
  const mention = String(query).match(/<@!?(\d+)>/);
  const id = mention?.[1] || String(query).trim();
  if (/^\d{15,25}$/.test(id)) return guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
  return findMembers(guild, query).first() || null;
}

async function onlineMembers(guild) {
  const members = await fetchAllMembers(guild);
  return members.filter(m => m.presence?.status && m.presence.status !== 'offline');
}

function formatMember(m) {
  return { id: m.id, username: m.user.username, globalName: m.user.globalName, displayName: m.displayName, tag: m.user.tag, bot: m.user.bot, status: m.presence?.status || 'offline', roles: m.roles.cache.filter(r => r.id !== m.guild.id).map(r => r.name) };
}

async function getServerOverview(guild) {
  const members = await fetchAllMembers(guild);
  const online = members.filter(m => m.presence?.status && m.presence.status !== 'offline').size;
  return { name: guild.name, id: guild.id, members: guild.memberCount, cachedMembers: members.size, online, bots: members.filter(m => m.user.bot).size, channels: guild.channels.cache.size, roles: guild.roles.cache.size, ownerId: guild.ownerId };
}

async function getRecentMessages(channel, limit = 25) {
  if (!channel?.isTextBased() || !channel.messages) return [];
  const messages = await channel.messages.fetch({ limit }).catch(() => null);
  if (!messages) return [];
  return [...messages.values()].map(m => ({ id:m.id, author:m.author.tag, content:m.content.slice(0,500), at:m.createdAt.toISOString() }));
}

module.exports = { fetchAllMembers, findMembers, getMember, onlineMembers, formatMember, getServerOverview, getRecentMessages };
