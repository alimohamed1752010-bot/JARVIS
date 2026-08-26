const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member and save the warning.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction, { getConfig, saveConfig, addCase, logEvent }) {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const config = getConfig(interaction.guild.id);
    config.warnings ??= {};
    config.warnings[user.id] ??= [];
    config.warnings[user.id].push({
      moderator: interaction.user.tag,
      reason,
      at: new Date().toISOString()
    });
    saveConfig(interaction.guild.id, config);
    const c = addCase(interaction.guild.id, { action: "WARN", userId: user.id, moderatorId: interaction.user.id, reason });
    await logEvent(interaction.guild, `⚠️ **${user.tag}** was warned by **${interaction.user.tag}** — Case #${c.id} — ${reason}`);
    await interaction.reply(`⚠️ **${user.tag}** has been warned.\n**Reason:** ${reason}\n**Total warnings:** ${config.warnings[user.id].length}\n**Case:** #${c.id}`);
  }
};