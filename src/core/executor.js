const {PermissionsBitField}=require('discord.js');
const {check}=require('./permissions');
const journal=require('./journal');

async function execute({message,action,target,destination,reason='',durationMs=10*60*1000,config,saveConfig,dryRun=false,skipJournal=false}){
  const guild=message.guild; const actor=message.member; const bot=guild.members.me;
  const perm=check({guild,actor,bot,action,target});
  if(!perm.ok)return {ok:false,text:perm.message,code:perm.code};
  const before={}; const after={};
  if(target){before.voiceChannelId=target.voice?.channelId||null;before.communicationDisabledUntil=target.communicationDisabledUntil?.toISOString?.()||null;before.serverMute=Boolean(target.voice?.serverMute);before.serverDeaf=Boolean(target.voice?.serverDeaf);before.textMuted=Boolean(config.muteRoleId&&target.roles?.cache?.has(String(config.muteRoleId)));}
  if(destination)after.voiceChannelId=destination.id;
  if(dryRun)return {ok:true,simulated:true,before,after,text:`Simulation: **${action.toUpperCase()}** ${target?`on **${target.displayName}**`:''}${destination?` → **${destination.name}**`:''} would be allowed.`};
  try{
    switch(action){
      case 'voicemove': await target.voice.setChannel(destination,`JARVIS V9: ${reason||'Owner-directed voice move'}`); break;
      case 'voicedisconnect': await target.voice.disconnect(`JARVIS V9: ${reason||'Owner-directed voice disconnect'}`); break;
      case 'voicemute': await target.voice.setMute(true,`JARVIS V9: ${reason||'Owner-directed voice mute'}`); break;
      case 'voiceunmute': await target.voice.setMute(false,`JARVIS V9: ${reason||'Owner-directed voice unmute'}`); break;
      case 'voicedeafen': await target.voice.setDeaf(true,`JARVIS V9: ${reason||'Owner-directed voice deafen'}`); break;
      case 'voiceundeafen': await target.voice.setDeaf(false,`JARVIS V9: ${reason||'Owner-directed voice undeafen'}`); break;
      case 'textmute': { const role=guild.roles.cache.get(String(config.muteRoleId||'')); if(!role)return {ok:false,text:'No text-mute role is configured.'}; if(role.position>=bot.roles.highest.position)return {ok:false,text:'The text-mute role is above my highest role.'}; await target.roles.add(role,`JARVIS V9: ${reason||'Owner-directed text mute'}`); break; }
      case 'textunmute': { const role=guild.roles.cache.get(String(config.muteRoleId||'')); if(!role)return {ok:false,text:'No text-mute role is configured.'}; if(role.position>=bot.roles.highest.position)return {ok:false,text:'The text-mute role is above my highest role.'}; await target.roles.remove(role,`JARVIS V9: ${reason||'Owner-directed text unmute'}`); break; }
      case 'timeout': await target.timeout(Math.min(Math.max(Number(durationMs)||60000,1000),28*24*60*60*1000),`JARVIS V9: ${reason||'Owner-directed timeout'}`); break;
      case 'untimeout': await target.timeout(null,`JARVIS V9: ${reason||'Owner-directed timeout removal'}`); break;
      case 'kick': await target.kick(`JARVIS V9: ${reason||'Owner-directed kick'}`); break;
      case 'ban': await target.ban({reason:`JARVIS V9: ${reason||'Owner-directed ban'}`}); break;
      case 'warn': { config.warnings ??= {}; config.warnings[target.id] ??= []; config.warnings[target.id].push({reason:reason||'Owner-directed warning',moderator:message.author.tag,at:new Date().toISOString()}); if(config.warnings[target.id].length>100) config.warnings[target.id]=config.warnings[target.id].slice(-100); break; }
      default:return {ok:false,text:`Action **${action}** is not implemented by the V9 executor yet.`};
    }
    after.voiceChannelId=target?.voice?.channelId||after.voiceChannelId||null;
    const reversible=['voicemove','voicemute','voiceunmute','voicedeafen','voiceundeafen','timeout','textmute','textunmute'].includes(action);
    const entry=skipJournal?null:journal.record(config,{action:action.toUpperCase(),actorId:message.author.id,targetId:target?.id,destinationId:destination?.id,reason,before,after,reversible,undo:{action,targetId:target?.id,destinationId:before.voiceChannelId,previousMute:target?.voice?.serverMute,previousDeaf:target?.voice?.serverDeaf}});
    saveConfig(guild.id,config);
    return {ok:true,text:`Executed **${action.toUpperCase()}**${target?` on **${target.displayName}**`:''}${destination?` → **${destination.name}**`:''}.`,case:entry};
  }catch(error){return {ok:false,text:`Execution failed: ${String(error.message||error).slice(0,300)}`,error};}
}

async function undo({message,entry,config,saveConfig}){
  if(!entry?.reversible)return {ok:false,text:'That action cannot be reversed safely.'};
  const guild=message.guild; const target=await guild.members.fetch(entry.targetId).catch(()=>null); if(!target)return {ok:false,text:'The original target is no longer in this server.'};
  const bot=guild.members.me;
  if(entry.action==='VOICEMOVE' && entry.before?.voiceChannelId){const ch=guild.channels.cache.get(entry.before.voiceChannelId);if(!ch)return {ok:false,text:'The previous voice channel no longer exists.'};return execute({message,action:'voicemove',target,destination:ch,reason:`Undo action #${entry.id}`,config,saveConfig});}
  if(entry.action==='VOICEDISCONNECT')return {ok:false,text:"A voice disconnect cannot be safely undone because the previous channel may no longer represent the user's intent."};
  if(entry.action==='VOICEMUTE')return execute({message,action:'voiceunmute',target,reason:`Undo action #${entry.id}`,config,saveConfig});
  if(entry.action==='VOICEUNMUTE')return execute({message,action:'voicemute',target,reason:`Undo action #${entry.id}`,config,saveConfig});
  if(entry.action==='TEXTMUTE')return execute({message,action:'textunmute',target,reason:`Undo action #${entry.id}`,config,saveConfig});
  if(entry.action==='TEXTUNMUTE')return execute({message,action:'textmute',target,reason:`Undo action #${entry.id}`,config,saveConfig});
  if(entry.action==='VOICEDEAFEN')return execute({message,action:'voiceundeafen',target,reason:`Undo action #${entry.id}`,config,saveConfig});
  if(entry.action==='VOICEUNDEAFEN')return execute({message,action:'voicedeafen',target,reason:`Undo action #${entry.id}`,config,saveConfig});
  if(entry.action==='TIMEOUT')return execute({message,action:'untimeout',target,reason:`Undo action #${entry.id}`,config,saveConfig});
  if(entry.action==='UNTIMEOUT')return {ok:false,text:'Removing a timeout cannot restore its previous expiration safely.'};
  return {ok:false,text:'No safe undo handler exists for that action.'};
}
module.exports={execute,undo};
