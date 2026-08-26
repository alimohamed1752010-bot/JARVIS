const { getConfig } = require('../utils/config');
const { onMemberJoin } = require('../systems/security');
module.exports = async member => {
  await onMemberJoin(member);
  const c = getConfig(member.guild.id);
  if (c.autoroleId) { const role = member.guild.roles.cache.get(c.autoroleId); if (role && role.position < member.guild.members.me.roles.highest.position) { try { await member.roles.add(role, 'JARVIS autorole'); } catch (e) { console.warn('[AUTOROLE]', e.message); } } }
  if (c.welcomeChannelId) { const ch = member.guild.channels.cache.get(c.welcomeChannelId); if (ch?.isTextBased()) { const text = c.welcomeMessage.replaceAll('{user}', `<@${member.id}>`).replaceAll('{server}', member.guild.name); try { await ch.send(text); } catch (e) { console.warn('[WELCOME]', e.message); } } }
};
