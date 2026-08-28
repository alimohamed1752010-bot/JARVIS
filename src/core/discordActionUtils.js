const { PermissionsBitField, ChannelType } = require('discord.js');

const PERMISSION_ALIASES = new Map([
  ['soundboard', PermissionsBitField.Flags.UseSoundboard],
  ['use soundboard', PermissionsBitField.Flags.UseSoundboard],
  ['send messages', PermissionsBitField.Flags.SendMessages],
  ['view channel', PermissionsBitField.Flags.ViewChannel],
  ['view channels', PermissionsBitField.Flags.ViewChannel],
  ['manage messages', PermissionsBitField.Flags.ManageMessages],
  ['manage channels', PermissionsBitField.Flags.ManageChannels],
  ['manage roles', PermissionsBitField.Flags.ManageRoles],
  ['mention everyone', PermissionsBitField.Flags.MentionEveryone],
  ['embed links', PermissionsBitField.Flags.EmbedLinks],
  ['attach files', PermissionsBitField.Flags.AttachFiles],
  ['read message history', PermissionsBitField.Flags.ReadMessageHistory],
  ['connect', PermissionsBitField.Flags.Connect],
  ['speak', PermissionsBitField.Flags.Speak],
  ['mute members', PermissionsBitField.Flags.MuteMembers],
  ['deafen members', PermissionsBitField.Flags.DeafenMembers],
  ['move members', PermissionsBitField.Flags.MoveMembers],
  ['administrator', PermissionsBitField.Flags.Administrator],
  ['kick members', PermissionsBitField.Flags.KickMembers],
  ['ban members', PermissionsBitField.Flags.BanMembers],
  ['moderate members', PermissionsBitField.Flags.ModerateMembers]
]);

function normalizePermission(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (PERMISSION_ALIASES.has(raw)) return PERMISSION_ALIASES.get(raw);
  const key = Object.keys(PermissionsBitField.Flags).find(k => k.toLowerCase() === raw.replace(/\s+/g, ''));
  return key ? PermissionsBitField.Flags[key] : null;
}

function permissionName(flag) {
  return Object.entries(PermissionsBitField.Flags).find(([, value]) => value === flag)?.[0] || String(flag);
}

function resolveRole(guild, query) {
  const raw = String(query || '').trim();
  const mention = raw.match(/^<@&(\d+)>$/);
  if (mention) {
    const role = guild.roles.cache.get(mention[1]);
    return role ? { status: 'resolved', role, candidates: [role] } : { status: 'missing', role: null, candidates: [] };
  }
  const q = raw.replace(/^@/, '').toLowerCase();
  const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id);
  const exact = roles.filter(r => r.name.toLowerCase() === q);
  if (exact.length === 1) return { status: 'resolved', role: exact[0], candidates: exact };
  const matches = roles.filter(r => r.name.toLowerCase().includes(q)).sort((a, b) => b.position - a.position);
  if (!matches.length) return { status: 'missing', role: null, candidates: [] };
  if (matches.length > 1) return { status: 'ambiguous', role: null, candidates: matches.slice(0, 10) };
  return { status: 'resolved', role: matches[0], candidates: matches };
}

function resolveChannelAny(guild, query) {
  const raw = String(query || '').trim();
  const mention = raw.match(/^<#(\d+)>$/);
  if (mention) {
    const channel = guild.channels.cache.get(mention[1]);
    return channel ? { status: 'resolved', channel, candidates: [channel] } : { status: 'missing', channel: null, candidates: [] };
  }
  const q = raw.replace(/^#/, '').toLowerCase();
  const channels = [...guild.channels.cache.values()];
  const exact = channels.filter(c => c.name.toLowerCase() === q);
  if (exact.length === 1) return { status: 'resolved', channel: exact[0], candidates: exact };
  const matches = channels.filter(c => c.name.toLowerCase().includes(q));
  if (!matches.length) return { status: 'missing', channel: null, candidates: [] };
  if (matches.length > 1) return { status: 'ambiguous', channel: null, candidates: matches.slice(0, 10) };
  return { status: 'resolved', channel: matches[0], candidates: matches };
}

module.exports = { normalizePermission, permissionName, resolveRole, resolveChannelAny };
