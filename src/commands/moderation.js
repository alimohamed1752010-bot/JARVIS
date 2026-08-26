const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to ban").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided.";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) return interaction.reply({ content: "I can't find that member in this server.", ephemeral: true });
    if (!member.bannable) return interaction.reply({ content: "I can't ban that member. Check JARVIS's role position and permissions.", ephemeral: true });

    await member.ban({ reason });
    await interaction.reply(`🔨 **${user.tag}** has been banned.\n**Reason:** ${reason}`);
  }
};