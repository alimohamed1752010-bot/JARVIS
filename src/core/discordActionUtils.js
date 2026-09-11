const { PermissionsBitField, ChannelType } = require('discord.js');

const PERMISSION_ALIASES = new Map([
  ['soundboard', PermissionsBitField.Flags.UseSoundboard],
  ['use soundboard', PermissionsBitField.Flags.UseSoundboard],
  ['send messages', PermissionsBitField.Flags.SendMessages],
  ['view channel', PermissionsBitField.Flags.ViewChannel],
  ['view channels', PermissionsBitField.Flags.ViewChannel],
  ['manage messages', PermissionsBitField.Flags.ManageMessages],
  ['manage threads', PermissionsBitField.Flags.ManageThreads],
  ['manage thread', PermissionsBitField.Flags.ManageThreads],
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
  const raw = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\b(?:access|permission|permissions|perm|perms)\b/g, '').replace(/\s+/g, ' ').trim();
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

function normalizeRoleColor(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const named = {
    'whiteish-yellow': '#fff7b2',
    'whitish-yellow': '#fff7b2',
    'white yellow': '#fff7b2',
    'pale yellow': '#fff7b2',
    'light yellow': '#fff3a6',
    'cream': '#fffdd0',
    'ivory': '#fffff0',
    'white': '#ffffff',
    'black': '#000000',
    'red': '#ff0000',
    'green': '#00ff00',
    'blue': '#0000ff',
    'yellow': '#ffff00',
    'orange': '#ffa500',
    'purple': '#800080',
    'pink': '#ffc0cb',
    'cyan': '#00ffff',
    'teal': '#008080',
    'gold': '#ffd700',
    'golden': '#ffd700',
    'gray': '#808080',
    'grey': '#808080'
  };
  if (named[raw]) return named[raw];
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : null;
}

module.exports = { normalizePermission, permissionName, normalizeRoleColor, resolveRole, resolveChannelAny };
