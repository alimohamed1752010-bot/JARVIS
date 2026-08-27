const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { conversationalReply } = require('../ai');
const { getRecentMessages } = require('../tools/discordTools');
module.exports = {
  data: new SlashCommandBuilder().setName('summarize').setDescription('Summarize recent channel messages.').addIntegerOption(o=>o.setName('messages').setDescription('1-100 messages').setMinValue(1).setMaxValue(100)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction,{getConfig,saveConfig}){
    const count=interaction.options.getInteger('messages')||25;
    await interaction.deferReply();
    const msgs=await getRecentMessages(interaction.channel,count);
    if(!msgs.length) return interaction.editReply('No recent messages are available, sir.');
    const prompt=`Summarize these recent Discord messages. Identify key topics, decisions, questions, action items, and notable moderation/security concerns. Be concise and factual.\n\n${msgs.map(m=>`[${m.author}] ${m.content}`).join('\n')}`;
    try{const reply=await conversationalReply({message:{guild:interaction.guild,member:interaction.member,author:interaction.user,channel:interaction.channel},config:getConfig(interaction.guild.id),saveConfig,prompt,skipMemory:true,cooldownKey:`summarize:${interaction.guild.id}:${interaction.user.id}`}); await interaction.editReply((reply||'No summary generated.').slice(0,1900));}
    catch(e){console.error('[SUMMARIZE]',e);await interaction.editReply('⚠️ I could not summarize the channel, sir.');}
  }
};
