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

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const file = path.join(__dirname, "..", "..", "data", `${interaction.guild.id}-warnings.json`);

    let warnings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    warnings[user.id] ??= [];
    warnings[user.id].push({
      moderator: interaction.user.id,
      reason,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(file, JSON.stringify(warnings, null, 2));

    await interaction.reply(`⚠️ **${user.tag}** has been warned.\n**Reason:** ${reason}\n**Total warnings:** ${warnings[user.id].length}`);
  }
};