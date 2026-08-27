const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show JARVIS commands."),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle("🤖 JARVIS")
      .setDescription("Your server assistant.")
      .addFields(
        { name: "Moderation", value: "`/ban` `/kick` `/timeout` `/clear` `/warn`" },
        { name: "Server", value: "`/server` `/user` `/avatar`" },
        { name: "Setup", value: "`/setwelcome` `/setlogs`" }
      )
      .setFooter({ text: "More ProBot-style features can be added to JARVIS." });
    await interaction.reply({ embeds: [embed] });
  }
};