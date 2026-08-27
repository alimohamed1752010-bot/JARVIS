const journal=require('../core/journal');
function start(client,{getConfig,saveConfig,logEvent}){
  const enabled=guild=>getConfig(guild.id).v9?.eventAwareness?.enabled;
  const shouldLog=(guild,key)=>enabled(guild)&&getConfig(guild.id).v9.eventAwareness[key];
  client.on('voiceStateUpdate',async(oldState,newState)=>{
    if(!newState.guild||oldState.channelId===newState.channelId||!shouldLog(newState.guild,'voiceMoves'))return;
    const cfg=getConfig(newState.guild.id);const entry=journal.record(cfg,{action:'VOICE_EVENT',actorId:'unknown',targetId:newState.id,before:{voiceChannelId:oldState.channelId},after:{voiceChannelId:newState.channelId},reversible:false,metadata:{from:oldState.channel?.name||null,to:newState.channel?.name||null}});saveConfig(newState.guild.id,cfg);
    if(cfg.v9.eventAwareness.logVoiceMoves) await logEvent(newState.guild,`🔊 **JARVIS EVENT:** <@${newState.id}> moved ${oldState.channel?`from **${oldState.channel.name}**`:'into voice'} ${newState.channel?`to **${newState.channel.name}**`:'out of voice'} • Event #${entry.id}`);
  });
  client.on('channelCreate',channel=>{if(channel.guild&&shouldLog(channel.guild,'channels'))logEvent(channel.guild,`📡 **JARVIS EVENT:** Channel created: **${channel.name}**`);});
  client.on('channelDelete',channel=>{if(channel.guild&&shouldLog(channel.guild,'channels'))logEvent(channel.guild,`📡 **JARVIS EVENT:** Channel deleted: **${channel.name}**`);});
  client.on('roleCreate',role=>{if(role.guild&&shouldLog(role.guild,'roles'))logEvent(role.guild,`📡 **JARVIS EVENT:** Role created: **${role.name}**`);});
  client.on('roleDelete',role=>{if(role.guild&&shouldLog(role.guild,'roles'))logEvent(role.guild,`📡 **JARVIS EVENT:** Role deleted: **${role.name}**`);});
  client.on('guildMemberAdd',member=>{if(shouldLog(member.guild,'members'))logEvent(member.guild,`👤 **JARVIS EVENT:** Member joined: **${member.user.tag}**`);});
  client.on('guildMemberRemove',member=>{if(shouldLog(member.guild,'members'))logEvent(member.guild,`👋 **JARVIS EVENT:** Member left: **${member.user.tag}**`);});
  client.on('guildBanAdd',ban=>{if(shouldLog(ban.guild,'moderation'))logEvent(ban.guild,`🔨 **JARVIS EVENT:** Member banned: **${ban.user.tag}**`);});
  client.on('guildBanRemove',ban=>{if(shouldLog(ban.guild,'moderation'))logEvent(ban.guild,`♻️ **JARVIS EVENT:** Ban removed: **${ban.user.tag}**`);});
}
module.exports={start};
