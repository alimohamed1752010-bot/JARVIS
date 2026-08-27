const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('investigate').setDescription('Generate a JARVIS security profile for a member.').addUserOption(o=>o.setName('user').setDescription('Member to investigate').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction,{getConfig}){
    const user=interaction.options.getUser('user');
    const member=await interaction.guild.members.fetch(user.id).catch(()=>null);
    if(!member) return interaction.reply({content:'❌ That member is not in this server.',ephemeral:true});
    const cfg=getConfig(interaction.guild.id); const warnings=cfg.warnings?.[user.id]||[]; const cases=(cfg.cases||[]).filter(c=>c.userId===user.id).slice(-10).reverse();
    const risk=Math.min(100,warnings.length*15+cases.length*10+(Date.now()-user.createdTimestamp<86400000?35:0));
    const level=risk>=70?'HIGH':risk>=35?'MEDIUM':'LOW';
    return interaction.reply({embeds:[new EmbedBuilder().setTitle('🔎 JARVIS Security Investigation').setColor(risk>=70?0xff3333:risk>=35?0xffaa00:0x00cc66).setThumbnail(user.displayAvatarURL()).addFields(
      {name:'Member',value:`${member} • ${user.tag}`,inline:false},{name:'Account Age',value:`<t:${Math.floor(user.createdTimestamp/1000)}:R>`,inline:true},{name:'Joined Server',value:member.joinedTimestamp?`<t:${Math.floor(member.joinedTimestamp/1000)}:R>`:'Unknown',inline:true},{name:'Risk',value:`**${level}** (${risk}/100)`,inline:true},{name:'Warnings',value:String(warnings.length),inline:true},{name:'Cases',value:String(cases.length),inline:true},{name:'Roles',value:String(member.roles.cache.size-1),inline:true}
    ).setDescription(cases.length?cases.map(c=>`• **#${c.id}** ${c.action} — ${c.reason||'No reason'}`).join('\n'):'No recent moderation cases recorded.') ]});
  }
};
