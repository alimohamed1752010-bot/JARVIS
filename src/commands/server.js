const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder().setName("server").setDescription("Show server information."),

  async execute(interaction) {
    const g = interaction.guild;
    const embed = new EmbedBuilder()
      .setTitle(g.name)
      .setThumbnail(g.iconURL({ size: 256 }))
      .addFields(
        { name: "Members", value: String(g.memberCount), inline: true },
        { name: "Channels", value: String(g.channels.cache.size), inline: true },
        { name: "Roles", value: String(g.roles.cache.size), inline: true },
        { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>` }
      );
    await interaction.reply({ embeds: [embed] });
  }
};