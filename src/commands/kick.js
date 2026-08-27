const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .addUserOption(o => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided.";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) return interaction.reply({ content: "I can't find that member.", ephemeral: true });
    if (!member.kickable) return interaction.reply({ content: "I can't kick that member. Check role hierarchy and permissions.", ephemeral: true });

    await member.kick(reason);
    await interaction.reply(`👢 **${user.tag}** has been kicked.\n**Reason:** ${reason}`);
  }
};