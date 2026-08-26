const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const { register } = require('../registry');
const { getConfig, addCase, addWarning, getWarnings, clearWarnings, saveConfig } = require('../../utils/config');
const { hasPerm, parseDuration, safeReason, memberTargetSafe, jarvisEmbed, truncate } = require('../../utils/helpers');
const { logEvent } = require('../../systems/logger');

function target(message) { return message.mentions.members.first(); }
function guard(message, perm) { return hasPerm(message.member, perm) ? null : '❌ I need the appropriate Discord permission, sir.'; }

register('timeout', { category: 'Moderation', description: 'Timeout a member: jarvis timeout @user 10m reason', text: async (m, args) => {
  const e = guard(m, PermissionsBitField.Flags.ModerateMembers); if (e) return m.reply(e); const member = target(m); const dArg = args.find(a => /^\d+(s|m|h|d)$/i.test(a));
  if (!member || !dArg) return m.reply('❌ Use `jarvis timeout @user 10m reason`.'); const d = parseDuration(dArg); if (!d || d > 28 * 86400000) return m.reply('❌ Duration must be between 1 second and 28 days.');
  const safe = memberTargetSafe(m.member, member); if (!safe.ok || !member.moderatable) return m.reply(safe.reason || '❌ I cannot timeout that member.'); const reason = safeReason(args.slice(args.indexOf(dArg) + 1).join(' '));
  try { await member.timeout(d, `JARVIS: ${m.author.tag} — ${reason}`); const c = addCase(m.guild.id, { action: 'TIMEOUT', userId: member.id, moderatorId: m.author.id, reason, duration: dArg }); await logEvent(m.guild, { title: '⏱ MEMBER TIMEOUT', description: `**${member.user.tag}** was timed out.`, fields: [{ name: 'Moderator', value: m.author.tag }, { name: 'Duration', value: dArg }, { name: 'Reason', value: reason }, { name: 'Case', value: `#${c.id}` }] }); return m.reply(`⏱️ **${member.user.tag}** has been timed out for **${dArg}**.\nCase: **#${c.id}**`); } catch (error) { console.error('[TIMEOUT]', error); return m.reply('❌ I could not complete that timeout. Check my role and permissions.'); }
}});

register('kick', { category: 'Moderation', description: 'Kick a member', text: async (m, args) => {
  const e = guard(m, PermissionsBitField.Flags.KickMembers); if (e) return m.reply(e); const member = target(m); if (!member) return m.reply('❌ Mention the member.'); const safe = memberTargetSafe(m.member, member); if (!safe.ok || !member.kickable) return m.reply(safe.reason || '❌ I cannot kick that member.'); const reason = safeReason(args.slice(1).join(' '));
  try { await member.kick(`JARVIS: ${m.author.tag} — ${reason}`); const c = addCase(m.guild.id, { action: 'KICK', userId: member.id, moderatorId: m.author.id, reason }); await logEvent(m.guild, { title: '👢 MEMBER KICKED', description: `**${member.user.tag}** was kicked.`, fields: [{ name: 'Moderator', value: m.author.tag }, { name: 'Reason', value: reason }, { name: 'Case', value: `#${c.id}` }] }); return m.reply(`👢 **${member.user.tag}** has been kicked.\nCase: **#${c.id}**`); } catch (error) { console.error('[KICK]', error); return m.reply('❌ I could not kick that member.'); }
}});

register('ban', { category: 'Moderation', description: 'Ban a member', text: async (m, args) => {
  const e = guard(m, PermissionsBitField.Flags.BanMembers); if (e) return m.reply(e); const member = target(m); if (!member) return m.reply('❌ Mention the member.'); const safe = memberTargetSafe(m.member, member); if (!safe.ok || !member.bannable) return m.reply(safe.reason || '❌ I cannot ban that member.'); const reason = safeReason(args.slice(1).join(' '));
  try { await member.ban({ reason: `JARVIS: ${m.author.tag} — ${reason}` }); const c = addCase(m.guild.id, { action: 'BAN', userId: member.id, moderatorId: m.author.id, reason }); await logEvent(m.guild, { title: '🔨 MEMBER BANNED', description: `**${member.user.tag}** was banned.`, fields: [{ name: 'Moderator', value: m.author.tag }, { name: 'Reason', value: reason }, { name: 'Case', value: `#${c.id}` }] }); return m.reply(`🔨 **${member.user.tag}** has been banned.\nCase: **#${c.id}**`); } catch (error) { console.error('[BAN]', error); return m.reply('❌ I could not ban that member.'); }
}});

register('warn', { category: 'Moderation', description: 'Warn a member', text: async (m, args) => {
  const member = target(m); if (!member) return m.reply('❌ Mention the member.'); const safe = memberTargetSafe(m.member, member); if (!safe.ok) return m.reply(safe.reason); const reason = safeReason(args.slice(1).join(' ')); const list = addWarning(m.guild.id, member.id, reason, m.author.tag); const c = addCase(m.guild.id, { action: 'WARN', userId: member.id, moderatorId: m.author.id, reason });
  await logEvent(m.guild, { title: '⚠️ MEMBER WARNED', description: `**${member.user.tag}** received a warning.`, fields: [{ name: 'Warnings', value: String(list.length) }, { name: 'Reason', value: reason }, { name: 'Case', value: `#${c.id}` }] }); return m.reply(`⚠️ **${member.user.tag}** warned. Total warnings: **${list.length}**. Case: **#${c.id}**`);
}});

register('warnings', { category: 'Moderation', description: 'View warnings: jarvis warnings @user', text: async (m) => { const member = target(m); if (!member) return m.reply('❌ Mention a member.'); const list = getWarnings(m.guild.id, member.id); return m.reply({ embeds: [jarvisEmbed(`⚠️ Warnings — ${member.user.tag}`, list.length ? list.slice(-15).map((x,i) => `**${i+1}.** ${truncate(x.reason, 180)} — ${x.moderator} • <t:${Math.floor(new Date(x.at).getTime()/1000)}:R>`).join('\n') : 'No warnings recorded.', 0xFEE75C)] }); }});
register('clearwarnings', { category: 'Moderation', description: 'Clear a member warnings', text: async (m) => { const e = guard(m, PermissionsBitField.Flags.ModerateMembers); if (e) return m.reply(e); const member = target(m); if (!member) return m.reply('❌ Mention a member.'); clearWarnings(m.guild.id, member.id); return m.reply(`✅ Cleared warnings for **${member.user.tag}**.`); }});

register('case', { category: 'Moderation', description: 'View a case by ID', text: async (m,args) => { const id = Number(args[0]); const c = getConfig(m.guild.id).cases.find(x => x.id === id); if (!c) return m.reply('❌ Case not found.'); return m.reply({ embeds: [jarvisEmbed(`📋 Case #${c.id}`, `**Action:** ${c.action}\n**User:** <@${c.userId}>\n**Moderator:** <@${c.moderatorId}>\n**Reason:** ${c.reason || 'None'}\n**Time:** <t:${Math.floor(new Date(c.at).getTime()/1000)}:F>`, 0x5865F2)] }); }});
register('cases', { category: 'Moderation', description: 'Show recent cases', text: async (m,args) => { const c = getConfig(m.guild.id).cases; const user = target(m); const filtered = user ? c.filter(x => x.userId === user.id) : c; const rows = filtered.slice(-15).reverse(); return m.reply({ embeds: [jarvisEmbed('📋 Recent Cases', rows.length ? rows.map(x => `**#${x.id}** ${x.action} <@${x.userId}> — ${truncate(x.reason,100)}`).join('\n') : 'No cases found.')] }); }});

module.exports = {};
