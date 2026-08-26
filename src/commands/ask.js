const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { conversationalReply } = require('../ai');
module.exports = {
  data: new SlashCommandBuilder().setName('ask').setDescription('Ask JARVIS an AI question.').addStringOption(o=>o.setName('question').setDescription('Your question').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction, { getConfig, saveConfig }) {
    const question=interaction.options.getString('question');
    const config=getConfig(interaction.guild.id);
    await interaction.deferReply();
    try {
      const reply=await conversationalReply({message:{guild:interaction.guild,member:interaction.member,author:interaction.user,channel:interaction.channel},config,saveConfig,prompt:question,mode:config.ai?.personality||'classic',context:`Live Discord context: server=${interaction.guild.name}; members=${interaction.guild.memberCount}; channel=#${interaction.channel.name}.`});
      await interaction.editReply(reply?.slice(0,1900)||'I have nothing useful to add, sir.');
    } catch(e){ console.error('[ASK]',e); await interaction.editReply('⚠️ My conversational systems are unavailable right now, sir.'); }
  }
};
