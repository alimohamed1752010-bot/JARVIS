const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a member to another voice channel.")
    .addUserOption(o => o.setName("user").setDescription("Member to move").setRequired(true))
    .addChannelOption(o => o.setName("channel").setDescription("Destination voice channel").setRequired(true)
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addStringOption(o => o.setName("reason").setDescription("Reason"))
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const destination = interaction.options.getChannel("channel");
    const reason = interaction.options.getString("reason") || "Owner-directed voice move.";
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const me = interaction.guild.members.me;

    if (!member) return interaction.reply({ content: "I can't find that member in this server.", ephemeral: true });
    if (!me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({ content: "I need **Move Members** permission to move members between voice channels.", ephemeral: true });
    }
    if (!destination?.isVoiceBased()) {
      return interaction.reply({ content: "The destination must be a voice channel.", ephemeral: true });
    }
    if (!member.voice?.channel) {
      return interaction.reply({ content: `**${user.tag}** is not currently in a voice channel.`, ephemeral: true });
    }
    if (member.voice.channelId === destination.id) {
      return interaction.reply({ content: `**${user.tag}** is already in **${destination.name}**.`, ephemeral: true });
    }

    await member.voice.setChannel(destination, reason);
    await interaction.reply(`🔀 **${user.tag}** was moved to **${destination.name}**.\n**Reason:** ${reason}`);
  }
};
