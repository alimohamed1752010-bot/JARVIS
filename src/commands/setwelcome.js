const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setwelcome")
    .setDescription("Set JARVIS's welcome channel.")
    .addChannelOption(o => o.setName("channel").setDescription("Welcome channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Use {user} and {server}."))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, { getConfig, saveConfig }) {
    const channel = interaction.options.getChannel("channel");
    const message = interaction.options.getString("message");

    const config = getConfig(interaction.guild.id);
    config.welcomeChannelId = channel.id;
    if (message) config.welcomeMessage = message;
    saveConfig(interaction.guild.id, config);

    await interaction.reply(`✅ Welcome channel set to ${channel}.`);
  }
};