const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/config');

async function logEvent(guild, { title, description, color = 0x5865f2, fields = [] } = {}) {
  try {
    const config = getConfig(guild.id);
    if (!config.logChannelId) return false;
    const channel = guild.channels.cache.get(config.logChannelId);
    if (!channel?.isTextBased()) return false;
    const embed = new EmbedBuilder().setTitle(title || 'JARVIS Event').setDescription(description || null).setColor(color).setTimestamp();
    if (fields.length) embed.addFields(fields.slice(0, 25));
    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) { console.error('[LOG ERROR]', error.message); return false; }
}
module.exports = { logEvent };
