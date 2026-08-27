const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a user's avatar.")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser("user") || interaction.user;
    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Avatar`)
      .setImage(user.displayAvatarURL({ size: 1024, extension: "png" }));
    await interaction.reply({ embeds: [embed] });
  }
};