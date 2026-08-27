const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Disconnect a member from their current voice channel.")
    .addUserOption(o => o.setName("user").setDescription("Member to disconnect").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "Owner-directed voice disconnect.";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const me = interaction.guild.members.me;

    if (!member) return interaction.reply({ content: "I can't find that member in this server.", ephemeral: true });
    if (!me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({ content: "I need **Move Members** permission to disconnect members from voice.", ephemeral: true });
    }
    if (!member.voice?.channel) {
      return interaction.reply({ content: `**${user.tag}** is not currently in a voice channel.`, ephemeral: true });
    }

    const from = member.voice.channel.name;
    await member.voice.disconnect(reason);
    await interaction.reply(`🔌 **${user.tag}** was disconnected from **${from}**.\n**Reason:** ${reason}`);
  }
};
