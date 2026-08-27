const {PermissionsBitField,ChannelType}=require('discord.js');
const {check}=require('./permissions');
const journal=require('./journal');

const VOICE_CHANNEL_TYPES=new Set([ChannelType.GuildVoice,ChannelType.GuildStageVoice]);
const TEXT_CHANNEL_TYPES=new Set([ChannelType.GuildText,ChannelType.GuildAnnouncement,ChannelType.GuildForum,ChannelType.AnnouncementThread,ChannelType.PublicThread,ChannelType.PrivateThread]);
function channelMatchesScope(channel,scope){
  if(scope==='voice')return VOICE_CHANNEL_TYPES.has(channel.type);
  if(scope==='text')return TEXT_CHANNEL_TYPES.has(channel.type);
  if(scope==='any')return VOICE_CHANNEL_TYPES.has(channel.type)||TEXT_CHANNEL_TYPES.has(channel.type);
  return false;
}

// Grants or denies a named permission for a role or member. Channel-scoped permissions
// (voice/text/any) are applied as PermissionOverwrites across every matching channel, or a single
// channel if one was given. Guild-scoped permissions (kick, ban, administrator, ...) are only
// meaningful server-wide: for a role target this edits the role's base permissions directly; for a
// member target JARVIS manages a dedicated "JARVIS: <permission>" role, since Discord has no way to
// grant an individual member a guild-wide permission outside of a role.
async function executePermissionChange({message,action,entityKind,targetEntity,permission,channel=null,reason='',config,saveConfig}){
  const guild=message.guild; const bot=guild.members.me; const actor=message.member;
  const perm=check({guild,actor,bot,action,target:entityKind==='member'?targetEntity:null});
  if(!perm.ok)return {ok:false,text:perm.message,code:perm.code};
  const grant=action==='permgrant';
  const verb=grant?'grant':'deny';
  const auditReason=`JARVIS V11: ${reason||`Owner-directed permission ${verb}`}`;
  try{
    if(entityKind==='role'){
      const role=targetEntity;
      if(role.id===guild.id)return {ok:false,text:'I will not edit the @everyone role this way, sir — that changes defaults for the entire server. Target a specific role instead.'};
      if(bot.roles.highest.position<=role.position)return {ok:false,text:`**${role.name}** is above my highest role, sir — Discord will not let me edit it.`};
      if(grant && !bot.permissions.has(permission.key))return {ok:false,text:`I can't grant **${permission.name}** because I don't hold that permission myself.`};
      const hadBefore=role.permissions.has(permission.key);
      const newPermissions=grant?role.permissions.add(permission.key):role.permissions.remove(permission.key);
      await role.setPermissions(newPermissions,auditReason);
      const entry=journal.record(config,{action:action.toUpperCase(),actorId:message.author.id,targetId:role.id,targetKind:'role',reason,before:{hadPermission:hadBefore},after:{hadPermission:grant},reversible:true,undo:{action,entityKind:'role',targetId:role.id,permission:permission.key,hadBefore}});
      saveConfig(guild.id,config);
      return {ok:true,text:`🔐 **${permission.name}** ${grant?'granted to':'removed from'} role **${role.name}**, server-wide.`,case:entry};
    }
    // member target
    if(permission.scope==='guild'){
      const roleName=`JARVIS: ${permission.name}`;
      let managedRole=guild.roles.cache.find(r=>r.name===roleName);
      if(grant){
        if(!managedRole){
          if(!bot.permissions.has(permission.key))return {ok:false,text:`I can't grant **${permission.name}** because I don't hold that permission myself.`};
          managedRole=await guild.roles.create({name:roleName,permissions:[permission.key],reason:`JARVIS V11: created to grant ${permission.name} to individual members`});
        }
        const already=targetEntity.roles.cache.has(managedRole.id);
        if(!already)await targetEntity.roles.add(managedRole,auditReason);
        const entry=journal.record(config,{action:action.toUpperCase(),actorId:message.author.id,targetId:targetEntity.id,targetKind:'member',reason,before:{hadManagedRole:already},after:{hadManagedRole:true},reversible:true,undo:{action,entityKind:'member',targetId:targetEntity.id,permission:permission.key,managedRoleId:managedRole.id,hadBefore:already}});
        saveConfig(guild.id,config);
        return {ok:true,text:`🔐 **${permission.name}** granted to **${targetEntity.displayName}** server-wide (via **${roleName}**).`,case:entry};
      }
      if(!managedRole||!targetEntity.roles.cache.has(managedRole.id))return {ok:false,text:`**${targetEntity.displayName}** doesn't hold **${permission.name}** through a role I manage, sir — I can't strip a permission granted by another role.`};
      await targetEntity.roles.remove(managedRole,auditReason);
      const entry=journal.record(config,{action:action.toUpperCase(),actorId:message.author.id,targetId:targetEntity.id,targetKind:'member',reason,before:{hadManagedRole:true},after:{hadManagedRole:false},reversible:true,undo:{action,entityKind:'member',targetId:targetEntity.id,permission:permission.key,managedRoleId:managedRole.id,hadBefore:true}});
      saveConfig(guild.id,config);
      return {ok:true,text:`🔐 **${permission.name}** revoked from **${targetEntity.displayName}**.`,case:entry};
    }
    // channel-scoped permission on a member
    const channels=channel?[channel]:[...guild.channels.cache.values()].filter(c=>channelMatchesScope(c,permission.scope));
    if(!channels.length)return {ok:false,text:'I could not find any matching channels to apply that to, sir.'};
    let applied=0;const failures=[];
    for(const ch of channels){
      try{await ch.permissionOverwrites.edit(targetEntity,{[permission.key]:grant},{reason:auditReason});applied++;}
      catch(e){failures.push(ch.name);}
    }
    if(!applied)return {ok:false,text:`I couldn't update **${permission.name}** on any channel: ${failures.slice(0,3).join(', ')}.`};
    const entry=journal.record(config,{action:action.toUpperCase(),actorId:message.author.id,targetId:targetEntity.id,targetKind:'member',reason,before:{},after:{channelsUpdated:applied},reversible:true,undo:{action,entityKind:'member',targetId:targetEntity.id,permission:permission.key,channelIds:channels.map(c=>c.id)}});
    saveConfig(guild.id,config);
    return {ok:true,text:`🔐 **${permission.name}** ${grant?'granted to':'denied for'} **${targetEntity.displayName}** across **${applied}** channel${applied===1?'':'s'}${failures.length?` (${failures.length} failed)`:''}.`,case:entry};
  }catch(error){return {ok:false,text:`Permission update failed: ${String(error.message||error).slice(0,300)}`,error};}
}

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
  if(entry.action==='PERMGRANT'||entry.action==='PERMDENY')return undoPermissionChange({message,entry,config,saveConfig});
  return {ok:false,text:'No safe undo handler exists for that action.'};
}

async function undoPermissionChange({message,entry,config,saveConfig}){
  const u=entry.undo||{}; const guild=message.guild;
  const {CATALOG}=require('./permissionCatalog');
  const permission=CATALOG.find(p=>p.key===u.permission);
  if(!permission)return {ok:false,text:'I no longer recognize that permission; it cannot be safely undone.'};
  if(u.entityKind==='role'){
    const role=guild.roles.cache.get(u.targetId); if(!role)return {ok:false,text:'That role no longer exists.'};
    // Reverse: if we had granted and it wasn't there before, deny it back; if we had denied and it was there before, grant it back.
    const nextAction=entry.action==='PERMGRANT'?(u.hadBefore?null:'permdeny'):(u.hadBefore?'permgrant':null);
    if(!nextAction)return {ok:true,text:`No change needed, sir — **${role.name}** already had that permission state.`};
    return executePermissionChange({message,action:nextAction,entityKind:'role',targetEntity:role,permission,reason:`Undo action #${entry.id}`,config,saveConfig});
  }
  const target=await guild.members.fetch(u.targetId).catch(()=>null); if(!target)return {ok:false,text:'The original target is no longer in this server.'};
  if(u.channelIds){
    const channels=u.channelIds.map(id=>guild.channels.cache.get(id)).filter(Boolean);
    const grantBack=entry.action==='PERMDENY';
    let applied=0;
    for(const ch of channels){try{await ch.permissionOverwrites.edit(target,{[permission.key]:grantBack},{reason:`JARVIS V11: Undo action #${entry.id}`});applied++;}catch{}}
    return {ok:true,text:`Reverted **${permission.name}** on **${applied}** channel${applied===1?'':'s'} for **${target.displayName}**.`};
  }
  if(u.managedRoleId){
    const managedRole=guild.roles.cache.get(u.managedRoleId); if(!managedRole)return {ok:false,text:'The role JARVIS created for that permission no longer exists.'};
    const nextAction=entry.action==='PERMGRANT'?(u.hadBefore?null:'permdeny'):(u.hadBefore?'permgrant':null);
    if(!nextAction)return {ok:true,text:`No change needed, sir — **${target.displayName}** already had that permission state.`};
    return executePermissionChange({message,action:nextAction,entityKind:'member',targetEntity:target,permission,reason:`Undo action #${entry.id}`,config,saveConfig});
  }
  return {ok:false,text:'No safe undo handler exists for that permission change.'};
}
module.exports={execute,undo,executePermissionChange};
