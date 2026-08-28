const {PermissionsBitField}=require('discord.js');
const {normalizePermission,permissionName,resolveRole,resolveChannelAny}=require('./discordActionUtils');
const {resolveMember}=require('./resolver');
const {check}=require('./permissions');
const journal=require('./journal');

async function execute({message,action,target,destination,reason='',durationMs=10*60*1000,config,saveConfig,dryRun=false,skipJournal=false,role='',permissionChanges=[],targets=[],channel='',name=''}){
  const guild=message.guild; const actor=message.member; const bot=guild.members.me;
  const perm=check({guild,actor,bot,action,target});
  if(!perm.ok)return {ok:false,text:perm.message,code:perm.code};
  if(!actor?.permissions?.has(PermissionsBitField.Flags.Administrator) && actor?.id !== guild.ownerId) return {ok:false,text:'Only the server owner or an administrator may direct JARVIS to change server configuration.',code:'ACTOR_PERMISSION'};
  if(['role_permissions','role_add','role_remove','channel_edit'].includes(action)){
    if(!bot?.permissions?.has(action==='channel_edit'?PermissionsBitField.Flags.ManageChannels:PermissionsBitField.Flags.ManageRoles)) return {ok:false,text:`I need **${action==='channel_edit'?'Manage Channels':'Manage Roles'}** permission for that operation.`,code:'BOT_PERMISSION'};
    if(action==='channel_edit'){
      const resolved=resolveChannelAny(guild,channel); if(resolved.status==='ambiguous')return {ok:false,text:`I found multiple channels matching **${channel}**.`,code:'AMBIGUOUS_CHANNEL'}; if(!resolved.channel)return {ok:false,text:`I couldn't find channel **${channel}**.`,code:'MISSING_CHANNEL'};
      if(!resolved.channel.manageable)return {ok:false,text:`Discord will not let me manage **${resolved.channel.name}**.`,code:'CHANNEL_HIERARCHY'};
      const before={name:resolved.channel.name}; await resolved.channel.setName(String(name||'').trim().slice(0,100),`JARVIS V11: ${reason||'Owner-directed channel rename'}`); const entry=journal.record(config,{action:'CHANNEL_EDIT',actorId:message.author.id,targetId:resolved.channel.id,reason,before,after:{name:resolved.channel.name},reversible:false}); saveConfig(guild.id,config); return {ok:true,text:`Renamed **${before.name}** to **${resolved.channel.name}**.` ,case:entry,channelId:resolved.channel.id};
    }
    const rr=resolveRole(guild,role); if(rr.status==='ambiguous')return {ok:false,text:`I found multiple roles matching **${role}**. Please use the exact role name or mention.`,code:'AMBIGUOUS_ROLE'}; if(!rr.role)return {ok:false,text:`I couldn't find role **${role}**.`,code:'MISSING_ROLE'};
    const targetRole=rr.role;
    if(targetRole.managed)return {ok:false,text:`**${targetRole.name}** is managed by an integration and cannot be edited by JARVIS.`,code:'MANAGED_ROLE'};
    if(targetRole.position>=bot.roles.highest.position)return {ok:false,text:`**${targetRole.name}** is at or above my highest role, so Discord will not let me manage it.`,code:'ROLE_HIERARCHY'};
    if(action==='role_permissions'){
      const changes=Array.isArray(permissionChanges)?permissionChanges:[]; if(!changes.length)return {ok:false,text:'No permission changes were specified.',code:'NO_CHANGES'};
      const next=new PermissionsBitField(targetRole.permissions.bitfield);
      const changed=[];
      for(const change of changes){const flag=normalizePermission(change?.permission);if(!flag)return {ok:false,text:`I don't recognize the permission **${change?.permission||'unknown'}**.`,code:'UNKNOWN_PERMISSION'}; if(change.enabled)next.add(flag);else next.remove(flag);changed.push(`${change.enabled?'enabled':'disabled'} ${permissionName(flag)}`);}
      const before=targetRole.permissions.bitfield.toString(); await targetRole.setPermissions(next,`JARVIS V11: ${reason||'Owner-directed permission change'}`); const entry=journal.record(config,{action:'ROLE_PERMISSIONS',actorId:message.author.id,targetId:targetRole.id,reason,before:{permissions:before},after:{permissions:targetRole.permissions.bitfield.toString()},reversible:false}); saveConfig(guild.id,config); return {ok:true,text:`Updated **${targetRole.name}**: ${changed.join(', ')}.`,case:entry};
    }
    const memberRefs=Array.isArray(targets)?targets:[]; const results=[];
    for(const ref of memberRefs){const mr=await resolveMember(guild,ref);if(mr.status!=='resolved'){results.push(`✗ ${ref}: ${mr.status==='ambiguous'?'ambiguous':'not found'}`);continue;} if(mr.member.id===bot.id){results.push(`✗ ${mr.member.displayName}: I will not change my own roles.`);continue;} if(mr.member.roles.highest.position>=bot.roles.highest.position){results.push(`✗ ${mr.member.displayName}: role hierarchy prevents this.`);continue;} try {if(action==='role_add')await mr.member.roles.add(targetRole,`JARVIS V11: ${reason||'Owner-directed role assignment'}`);else await mr.member.roles.remove(targetRole,`JARVIS V11: ${reason||'Owner-directed role removal'}`);results.push(`✓ ${mr.member.displayName}`);}catch(e){results.push(`✗ ${mr.member.displayName}: ${String(e.message||e).slice(0,120)}`);}}
    saveConfig(guild.id,config); return {ok:true,text:`${action==='role_add'?'Added':'Removed'} **${targetRole.name}** ${action==='role_add'?'to':'from'} ${results.length} target(s).\n${results.join('\n')}`};
  }
  const before={}; const after={};
  if(target){before.voiceChannelId=target.voice?.channelId||null;before.communicationDisabledUntil=target.communicationDisabledUntil?.toISOString?.()||null;before.serverMute=Boolean(target.voice?.serverMute);before.serverDeaf=Boolean(target.voice?.serverDeaf);before.textMuted=Boolean(config.muteRoleId&&target.roles?.cache?.has(String(config.muteRoleId)));}
  if(destination)after.voiceChannelId=destination.id;
  if(dryRun)return {ok:true,simulated:true,before,after,text:`Simulation: **${action.toUpperCase()}** ${target?`on **${target.displayName}**`:''}${destination?` → **${destination.name}**`:''} would be allowed.`};
  try{
    switch(action){
      case 'voicemove': await target.voice.setChannel(destination,`JARVIS V11: ${reason||'Owner-directed voice move'}`); break;
      case 'voicedisconnect': await target.voice.disconnect(`JARVIS V11: ${reason||'Owner-directed voice disconnect'}`); break;
      case 'voicemute': await target.voice.setMute(true,`JARVIS V11: ${reason||'Owner-directed voice mute'}`); break;
      case 'voiceunmute': await target.voice.setMute(false,`JARVIS V11: ${reason||'Owner-directed voice unmute'}`); break;
      case 'voicedeafen': await target.voice.setDeaf(true,`JARVIS V11: ${reason||'Owner-directed voice deafen'}`); break;
      case 'voiceundeafen': await target.voice.setDeaf(false,`JARVIS V11: ${reason||'Owner-directed voice undeafen'}`); break;
      case 'textmute': { const role=guild.roles.cache.get(String(config.muteRoleId||'')); if(!role)return {ok:false,text:'No text-mute role is configured.'}; if(role.position>=bot.roles.highest.position)return {ok:false,text:'The text-mute role is above my highest role.'}; await target.roles.add(role,`JARVIS V11: ${reason||'Owner-directed text mute'}`); break; }
      case 'textunmute': { const role=guild.roles.cache.get(String(config.muteRoleId||'')); if(!role)return {ok:false,text:'No text-mute role is configured.'}; if(role.position>=bot.roles.highest.position)return {ok:false,text:'The text-mute role is above my highest role.'}; await target.roles.remove(role,`JARVIS V11: ${reason||'Owner-directed text unmute'}`); break; }
      case 'timeout': await target.timeout(Math.min(Math.max(Number(durationMs)||60000,1000),28*24*60*60*1000),`JARVIS V11: ${reason||'Owner-directed timeout'}`); break;
      case 'untimeout': await target.timeout(null,`JARVIS V11: ${reason||'Owner-directed timeout removal'}`); break;
      case 'kick': await target.kick(`JARVIS V11: ${reason||'Owner-directed kick'}`); break;
      case 'ban': await target.ban({reason:`JARVIS V11: ${reason||'Owner-directed ban'}`}); break;
      case 'warn': { config.warnings ??= {}; config.warnings[target.id] ??= []; config.warnings[target.id].push({reason:reason||'Owner-directed warning',moderator:message.author.tag,at:new Date().toISOString()}); if(config.warnings[target.id].length>100) config.warnings[target.id]=config.warnings[target.id].slice(-100); break; }
      default:return {ok:false,text:`Action **${action}** is not implemented by the V11 executor yet.`};
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
