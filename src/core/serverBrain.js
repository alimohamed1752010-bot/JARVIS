const {PermissionsBitField,ChannelType}=require('discord.js');
async function analyze(guild){
  await guild.members.fetch().catch(()=>{});
  const bot=guild.members.me; const issues=[]; const everyone=guild.roles.everyone;
  const adminRoles=[...guild.roles.cache.values()].filter(r=>r.id!==everyone.id&&!r.managed&&r.permissions.has(PermissionsBitField.Flags.Administrator));
  if(adminRoles.length) issues.push({severity:'HIGH',text:`${adminRoles.length} non-managed role(s) have Administrator.`});
  if(!bot?.permissions.has(PermissionsBitField.Flags.ManageRoles)) issues.push({severity:'HIGH',text:'JARVIS lacks Manage Roles.'});
  if(!bot?.permissions.has(PermissionsBitField.Flags.ManageChannels)) issues.push({severity:'HIGH',text:'JARVIS lacks Manage Channels.'});
  if(!bot?.permissions.has(PermissionsBitField.Flags.MoveMembers)) issues.push({severity:'MEDIUM',text:'JARVIS lacks Move Members, limiting voice management.'});
  const inaccessible=[]; for(const c of guild.channels.cache.values()) if(c.isTextBased()&&!c.permissionsFor(bot)?.has(PermissionsBitField.Flags.ViewChannel)) inaccessible.push(c.name);
  if(inaccessible.length) issues.push({severity:'MEDIUM',text:`JARVIS cannot view ${inaccessible.length} text channel(s).`});
  const everyoneAdmin=everyone.permissions.has(PermissionsBitField.Flags.Administrator); if(everyoneAdmin) issues.push({severity:'CRITICAL',text:'@everyone has Administrator.'});
  const roleAboveBot=[...guild.roles.cache.values()].filter(r=>!r.managed&&r.position>=bot?.roles?.highest?.position&&r.id!==everyone.id);
  if(roleAboveBot.length) issues.push({severity:'MEDIUM',text:`${roleAboveBot.length} editable-looking role(s) are at/above JARVIS's highest role.`});
  const summary={members:guild.memberCount,roles:guild.roles.cache.size,channels:guild.channels.cache.size,voiceChannels:guild.channels.cache.filter(c=>c.isVoiceBased()).size,textChannels:guild.channels.cache.filter(c=>c.type===ChannelType.GuildText).size,administratorRoles:adminRoles.length,rolesAboveBot:roleAboveBot.length};
  const score=Math.max(0,100-issues.reduce((n,x)=>n+(x.severity==='CRITICAL'?30:x.severity==='HIGH'?15:x.severity==='MEDIUM'?7:3),0));
  return {score,summary,issues,generatedAt:new Date().toISOString()};
}
function format(a){return `**JARVIS SERVER ANALYSIS**\nHealth score: **${a.score}/100**\n• Members: **${a.summary.members}**\n• Roles: **${a.summary.roles}**\n• Channels: **${a.summary.channels}**\n• Text: **${a.summary.textChannels}**\n• Voice: **${a.summary.voiceChannels}**\n• Administrator roles: **${a.summary.administratorRoles}**\n• Roles at/above JARVIS: **${a.summary.rolesAboveBot}**\n\n${a.issues.length?a.issues.map(x=>`${x.severity==='CRITICAL'?'🚨':x.severity==='HIGH'?'🔴':'🟡'} ${x.text}`).join('\n'):'🟢 No obvious structural issues detected.'}`;}
module.exports={analyze,format};
