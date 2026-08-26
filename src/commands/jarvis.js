const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("jarvis")
    .setDescription("Advanced JARVIS controls.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName("stats").setDescription("Show a live server report."))
    .addSubcommand(s => s.setName("diagnostics").setDescription("Run a JARVIS health check."))
    .addSubcommand(s => s.setName("permissions").setDescription("Show JARVIS permissions."))
    .addSubcommand(s => s.setName("lockdown").setDescription("Lock public text channels."))
    .addSubcommand(s => s.setName("unlockdown").setDescription("End emergency lockdown."))
    .addSubcommand(s => s.setName("automod").setDescription("Toggle AutoMod.").addStringOption(o => o.setName("mode").setDescription("on, off, or status").setRequired(true).addChoices({name:"on",value:"on"},{name:"off",value:"off"},{name:"status",value:"status"})))
    .addSubcommand(s => s.setName("antiraid").setDescription("Toggle anti-raid.").addStringOption(o => o.setName("mode").setDescription("on, off, or status").setRequired(true).addChoices({name:"on",value:"on"},{name:"off",value:"off"},{name:"status",value:"status"})))
    .addSubcommand(s => s.setName("autorole").setDescription("Configure autorole.").addRoleOption(o => o.setName("role").setDescription("Role to assign").setRequired(false)))
    .addSubcommand(s => s.setName("verify").setDescription("Verify yourself."))
    .addSubcommand(s => s.setName("case").setDescription("View a moderation case.").addIntegerOption(o => o.setName("id").setDescription("Case ID").setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName("cases").setDescription("List recent moderation cases."))
    .addSubcommand(s => s.setName("audit").setDescription("Show recent audit activity."))
    .addSubcommand(s => s.setName("snapshot").setDescription("Create a server configuration snapshot.")),

  async execute(interaction, { getConfig, saveConfig }) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const config = getConfig(guild.id);

    if (sub === "stats") {
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle("📊 JARVIS Server Report").setColor(0x00aeff).addFields(
        {name:"Members",value:String(guild.memberCount),inline:true},
        {name:"Channels",value:String(guild.channels.cache.size),inline:true},
        {name:"Roles",value:String(guild.roles.cache.size),inline:true},
        {name:"Cases",value:String(config.cases?.length || 0),inline:true},
        {name:"Warnings",value:String(Object.values(config.warnings || {}).reduce((n,x)=>n+x.length,0)),inline:true},
        {name:"API",value:`${Math.round(interaction.client.ws.ping)}ms`,inline:true}
      ).setTimestamp()] });
    }

    if (sub === "diagnostics") {
      const me = guild.members.me;
      const p = me?.permissions;
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle("🩺 JARVIS Diagnostics").setColor(0x00aeff).setDescription([
        `Status: **ONLINE**`,
        `API: **${Math.round(interaction.client.ws.ping)}ms**`,
        `Role position: **${me?.roles.highest?.position ?? "Unknown"}**`,
        `AutoMod: **${config.automod.enabled ? "ON" : "OFF"}**`,
        `Anti-Raid: **${config.antiRaid.enabled ? "ON" : "OFF"}**`,
        `Administrator permission: **${p?.has(PermissionFlagsBits.Administrator) ? "YES" : "NO"}**`
      ].join("\n"))] });
    }

    if (sub === "permissions") {
      const p = guild.members.me?.permissions;
      const names = ["Administrator","ManageGuild","ManageChannels","ManageRoles","ManageMessages","KickMembers","BanMembers","ModerateMembers","ViewAuditLog","ManageWebhooks"];
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle("🔐 JARVIS Permissions").setColor(0x00aeff).setDescription(names.map(n => `${p?.has(PermissionFlagsBits[n]) ? "✅" : "❌"} ${n}`).join("\n"))] });
    }

    if (sub === "lockdown" || sub === "unlockdown") {
      config.lockdown = sub === "lockdown";
      saveConfig(guild.id, config);
      let changed = 0;
      for (const channel of guild.channels.cache.values()) {
        if (!channel.isTextBased() || channel.isThread()) continue;
        try {
          await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: config.lockdown ? false : null });
          changed++;
        } catch {}
      }
      return interaction.reply(`${config.lockdown ? "🚨 Emergency lockdown activated" : "🔓 Lockdown lifted"}, sir. **${changed}** channels updated.`);
    }

    if (sub === "automod" || sub === "antiraid") {
      const mode = interaction.options.getString("mode");
      if (sub === "automod") config.automod.enabled = mode === "on" ? true : mode === "off" ? false : config.automod.enabled;
      else config.antiRaid.enabled = mode === "on" ? true : mode === "off" ? false : config.antiRaid.enabled;
      saveConfig(guild.id, config);
      const value = sub === "automod" ? config.automod.enabled : config.antiRaid.enabled;
      return interaction.reply(`${sub === "automod" ? "🛡️ AutoMod" : "🚨 Anti-Raid"} is **${value ? "ONLINE" : "OFFLINE"}**.`);
    }

    if (sub === "autorole") {
      const role = interaction.options.getRole("role");
      if (!role) return interaction.reply(`🎭 Autorole: ${config.autoroleId ? `<@&${config.autoroleId}>` : "Not configured"}.`);
      config.autoroleId = role.id;
      saveConfig(guild.id, config);
      return interaction.reply(`✅ Autorole set to **${role.name}**.`);
    }

    if (sub === "verify") {
      if (!config.verificationRoleId) return interaction.reply({content:"❌ Verification has not been configured.",ephemeral:true});
      const role = guild.roles.cache.get(config.verificationRoleId);
      if (!role) return interaction.reply({content:"❌ Verification role no longer exists.",ephemeral:true});
      if (interaction.member.roles.cache.has(role.id)) return interaction.reply({content:"✅ You're already verified, sir.",ephemeral:true});
      try { await interaction.member.roles.add(role, "JARVIS verification"); return interaction.reply(`✅ Verification complete, ${interaction.member}.`); }
      catch { return interaction.reply({content:"❌ I couldn't assign the verification role.",ephemeral:true}); }
    }

    if (sub === "case") {
      const id = interaction.options.getInteger("id");
      const entry = (config.cases || []).find(c => c.id === id);
      if (!entry) return interaction.reply({content:"❌ Case not found.",ephemeral:true});
      return interaction.reply({embeds:[new EmbedBuilder().setTitle(`📁 Case #${id}`).setColor(0x00aeff).addFields(
        {name:"Action",value:entry.action || "Unknown",inline:true},
        {name:"User",value:entry.userId ? `<@${entry.userId}>` : "Unknown",inline:true},
        {name:"Moderator",value:entry.moderatorId ? `<@${entry.moderatorId}>` : "Unknown",inline:true},
        {name:"Reason",value:entry.reason || "No reason provided"},
        {name:"Time",value:`<t:${Math.floor(new Date(entry.at).getTime()/1000)}:F>`}
      )]});
    }

    if (sub === "cases") {
      const rows = (config.cases || []).slice(-15).reverse();
      return interaction.reply({embeds:[new EmbedBuilder().setTitle("📁 Recent Cases").setColor(0x00aeff).setDescription(rows.length ? rows.map(c=>`**#${c.id}** ${c.action} — <@${c.userId}> — ${c.reason || "No reason"}`).join("\n") : "No cases recorded.")]});
    }

    if (sub === "audit") {
      const logs = await guild.fetchAuditLogs({limit:10}).catch(()=>null);
      if (!logs) return interaction.reply({content:"❌ I couldn't read the audit log.",ephemeral:true});
      const lines = logs.entries.map(e=>`**${e.action}** — ${e.executor?.tag || "Unknown"} — <t:${Math.floor(e.createdTimestamp/1000)}:R>`).slice(0,10);
      return interaction.reply({embeds:[new EmbedBuilder().setTitle("🔎 Recent Audit Activity").setDescription(lines.join("\n") || "No entries.").setColor(0x00aeff)]});
    }

    if (sub === "snapshot") {
      const snapshot = {generatedAt:new Date().toISOString(),guildId:guild.id,guildName:guild.name,memberCount:guild.memberCount,channels:guild.channels.cache.map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parentId})),roles:guild.roles.cache.map(r=>({id:r.id,name:r.name,position:r.position,color:r.hexColor})),config};
      const fs = require("node:fs"); const path = require("node:path");
      const file = path.join(__dirname,"..","..","data",`${guild.id}-snapshot-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(snapshot,null,2));
      return interaction.reply(`📦 Snapshot created: **${snapshot.channels.length} channels**, **${snapshot.roles.length} roles**.`);
    }
  }
};
