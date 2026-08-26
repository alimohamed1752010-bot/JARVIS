const { PermissionsBitField } = require('discord.js');

function isAdmin(member) { return !!member?.permissions?.has(PermissionsBitField.Flags.Administrator); }
function hasPerm(member, permission) { return !!member?.permissions?.has(permission); }
function truncate(text, length = 1000) { const s = String(text ?? ''); return s.length > length ? `${s.slice(0, Math.max(0, length - 3))}...` : s; }
function parseDuration(value) {
  const m = String(value || '').match(/^(\d+)\s*(s|m|h|d)$/i); if (!m) return null;
  const n = Number(m[1]); const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 }; return n * units[m[2].toLowerCase()];
}
function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  let sec = Math.floor(ms / 1000); const d = Math.floor(sec / 86400); sec %= 86400; const h = Math.floor(sec / 3600); sec %= 3600; const m = Math.floor(sec / 60); sec %= 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(' ');
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function safeReason(reason) { return truncate(reason || 'No reason provided', 450); }
function memberTargetSafe(actor, target) {
  if (!target) return { ok: false, reason: 'I need a target member, sir.' };
  if (actor.id === target.id) return { ok: false, reason: 'I will not allow you to punish yourself, sir.' };
  if (target.guild.ownerId === target.id) return { ok: false, reason: 'The server owner is outside my moderation hierarchy.' };
  if (actor.id !== target.guild.ownerId && target.roles.highest.position >= actor.roles.highest.position) return { ok: false, reason: 'That member is at or above your highest role.' };
  if (target.id === target.guild.client?.user?.id) return { ok: false, reason: 'I decline to moderate myself.' };
  return { ok: true };
}
function jarvisEmbed(title, description, color = 0x8ecae6) {
  const { EmbedBuilder } = require('discord.js');
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp().setFooter({ text: 'JARVIS — Just A Rather Very Intelligent System' });
}
module.exports = { isAdmin, hasPerm, truncate, parseDuration, formatUptime, pick, safeReason, memberTargetSafe, jarvisEmbed };
