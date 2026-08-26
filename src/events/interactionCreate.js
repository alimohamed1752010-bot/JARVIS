const { PermissionsBitField } = require('discord.js');
const { commands } = require('../commands/registry');
const { isAdmin, jarvisEmbed } = require('../utils/helpers');
const { getConfig, saveConfig } = require('../utils/config');
const { getAIStatus, clearMemory } = require('../ai/ai');
const { lockGuild, unlockGuild } = require('../systems/security');
const { clientState } = require('../state');

module.exports = async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'jarvis') return;
  if (!interaction.guild || !isAdmin(interaction.member)) return interaction.reply({ content: '❌ JARVIS is restricted to administrators.', ephemeral: true });
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'help') return interaction.reply({ embeds: [jarvisEmbed('🤖 JARVIS', 'Use `jarvis help` for the full text-command database. Slash commands are available from `/jarvis`.')] });
    if (sub === 'diagnostics') {
      const a=getAIStatus(), c=getConfig(interaction.guild.id), me=interaction.guild.members.me;
      return interaction.reply({ embeds:[jarvisEmbed('🩺 JARVIS DIAGNOSTICS', `🟢 Discord: Connected\nLatency: **${Math.round(clientState.client.ws.ping)}ms**\nUptime: **${Math.floor(clientState.client.uptime/1000)}s**\n\n${a.enabled&&a.configured?'🟢':'🔴'} AI: **${a.enabled?'Enabled':'Disabled'}**\nModel: **${a.model}**\nAPI: **${a.configured?'Configured':'Missing key'}**\n\n🛡 AutoMod: **${c.automod.enabled?'Enabled':'Disabled'}**\n🚨 Anti-Raid: **${c.antiRaid.enabled?'Enabled':'Disabled'}**\n🛡 Anti-Nuke: **${c.antiNuke.enabled?'Enabled':'Disabled'}**\n\nPermissions: **${me?.permissions.has(PermissionsBitField.Flags.Administrator)?'Administrator':'Limited'}**`, a.configured?0x57F287:0xFEE75C)] });
    }
    if (sub === 'stats') return interaction.reply({ embeds:[jarvisEmbed('📊 SERVER REPORT', `👥 Members: **${interaction.guild.memberCount}**\n💬 Channels: **${interaction.guild.channels.cache.size}**\n🎭 Roles: **${interaction.guild.roles.cache.size}**\n📡 Latency: **${Math.round(clientState.client.ws.ping)}ms**`)] });
    if (sub === 'memory') {
      const c=getConfig(interaction.guild.id); const action=interaction.options.getString('action'); const user=interaction.options.getUser('user');
      if(action==='clear'){ if(user) clearMemory(c,interaction.guild.id,user.id); else c.ai.memory[interaction.guild.id]={}; saveConfig(interaction.guild.id,c); return interaction.reply('🧠 Memory cleared.'); }
      if(action==='on'||action==='off'){c.ai.memoryEnabled=action==='on';saveConfig(interaction.guild.id,c);return interaction.reply(`🧠 AI memory **${c.ai.memoryEnabled?'enabled':'disabled'}**.`);}
      const count=Object.values(c.ai.memory[interaction.guild.id]||{}).reduce((n,a)=>n+a.length,0); return interaction.reply(`🧠 Memory: **${c.ai.memoryEnabled?'ON':'OFF'}** | Stored messages: **${count}**`);
    }
    if (sub === 'personality') { const c=getConfig(interaction.guild.id); const mode=interaction.options.getString('mode'); if(!mode)return interaction.reply(`🧠 Current personality: **${c.ai.personality}**. Available: classic, sarcastic, strict, professional, chaotic.`); c.ai.personality=mode; saveConfig(interaction.guild.id,c); return interaction.reply(`🧠 Personality set to **${mode}**.`); }
    if (sub === 'lockdown') { await lockGuild(interaction.guild,'Slash command by '+interaction.user.tag); return interaction.reply('🔒 Lockdown activated, sir.'); }
    if (sub === 'unlockdown') { await unlockGuild(interaction.guild,'Slash command by '+interaction.user.tag); return interaction.reply('🔓 Lockdown lifted, sir.'); }
    if (sub === 'automod' || sub === 'antispam' || sub === 'antilinks' || sub === 'antiraid') {
      const c=getConfig(interaction.guild.id); const action=interaction.options.getString('action');
      if(sub==='automod') c.automod.enabled=action==='on';
      if(sub==='antispam') c.automod.antiSpam=action==='on';
      if(sub==='antilinks') c.automod.antiLinks=action==='on';
      if(sub==='antiraid') c.antiRaid.enabled=action==='on';
      saveConfig(interaction.guild.id,c); return interaction.reply(`🛡 ${sub} **${action==='on'?'enabled':'disabled'}**.`);
    }
    if (sub === 'blockedwords') { const c=getConfig(interaction.guild.id); return interaction.reply(c.automod.blockedWords.length ? `🚫 ${c.automod.blockedWords.map(x=>`\`${x}\``).join(', ')}` : '🚫 No blocked words configured.'); }
    if (sub === 'joke') return interaction.reply('😂 Why do programmers prefer dark mode? Because light attracts bugs.');
    if (sub === 'fact') return interaction.reply('🧠 Octopuses have three hearts.');
    if (sub === 'quote') return interaction.reply('💬 “The best way to predict the future is to invent it.” — Alan Kay');
    if (sub === '8ball') return interaction.reply('🎱 Without a doubt, sir.');
    if (sub === 'wyr') return interaction.reply('🤔 Would you rather have unlimited coffee or unlimited sleep?');
    if (sub === 'roast') { const user=interaction.options.getUser('user',true); return interaction.reply(`🎩 Certainly, sir.\n\n<@${user.id}>, if confidence were competence, you would be unstoppable. Unfortunately, reality remains employed.`); }
    return interaction.reply({content:'❌ Unknown JARVIS function.',ephemeral:true});
  } catch(error) { console.error(`[SLASH ${sub}]`,error); const p={content:'❌ JARVIS encountered an internal error. The error has been logged.',ephemeral:true}; if(interaction.replied||interaction.deferred) return interaction.followUp(p); return interaction.reply(p); }
};
