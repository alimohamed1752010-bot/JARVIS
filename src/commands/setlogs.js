const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Set JARVIS's basic member log channel.")
    .addChannelOption(o => o.setName("channel").setDescription("Log channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, { getConfig, saveConfig }) {
    const channel = interaction.options.getChannel("channel");
    const config = getConfig(interaction.guild.id);
    config.logChannelId = channel.id;
    saveConfig(interaction.guild.id, config);
    await interaction.reply(`✅ Log channel set to ${channel}.`);
  }
};