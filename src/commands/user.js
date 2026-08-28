const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("user")
    .setDescription("Show user information.")
    .addUserOption(o => o.setName("member").setDescription("User").setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser("member") || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "User ID", value: user.id },
        { name: "Joined Discord", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>` },
        { name: "Joined Server", value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : "Unknown" }
      );

    await interaction.reply({ embeds: [embed] });
  }
};