const { PermissionsBitField } = require('discord.js');

function has(member, permission) {
  return Boolean(member?.permissions?.has(permission));
}

function check({guild, actor, bot, action, target}) {
  const required = {
    ban: PermissionsBitField.Flags.BanMembers,
    kick: PermissionsBitField.Flags.KickMembers,
    timeout: PermissionsBitField.Flags.ModerateMembers,
    untimeout: PermissionsBitField.Flags.ModerateMembers,
    textmute: PermissionsBitField.Flags.ManageRoles,
    textunmute: PermissionsBitField.Flags.ManageRoles,
    voicemute: PermissionsBitField.Flags.MuteMembers,
    voiceunmute: PermissionsBitField.Flags.MuteMembers,
    voicedeafen: PermissionsBitField.Flags.DeafenMembers,
    voiceundeafen: PermissionsBitField.Flags.DeafenMembers,
    voicedisconnect: PermissionsBitField.Flags.MoveMembers,
    voicemove: PermissionsBitField.Flags.MoveMembers,
    role_add: PermissionsBitField.Flags.ManageRoles,
    role_remove: PermissionsBitField.Flags.ManageRoles,
    channel_edit: PermissionsBitField.Flags.ManageChannels,
    lockdown: PermissionsBitField.Flags.ManageChannels,
    permgrant: PermissionsBitField.Flags.ManageRoles,
    permdeny: PermissionsBitField.Flags.ManageRoles
  }[action];
  if (required && !has(bot, required)) return {ok:false,code:'BOT_PERMISSION',message:`I need **${({[PermissionsBitField.Flags.BanMembers]:'Ban Members',[PermissionsBitField.Flags.KickMembers]:'Kick Members',[PermissionsBitField.Flags.ModerateMembers]:'Moderate Members',[PermissionsBitField.Flags.ManageRoles]:'Manage Roles',[PermissionsBitField.Flags.MuteMembers]:'Mute Members',[PermissionsBitField.Flags.DeafenMembers]:'Deafen Members',[PermissionsBitField.Flags.MoveMembers]:'Move Members',[PermissionsBitField.Flags.ManageChannels]:'Manage Channels'}[required]||'the required permission')}** permission to perform that action.`};
  if (target && bot && ['ban','kick','timeout','untimeout','voicemute','voiceunmute','voicedeafen','voiceundeafen','textmute','textunmute'].includes(action)) {
    if (target.id===bot.id) return {ok:false,code:'SELF_TARGET',message:'I will not perform moderation actions against myself.'};
    if (target.id===guild.ownerId) return {ok:false,code:'OWNER_TARGET',message:'I cannot moderate the server owner.'};
    if (bot.id !== guild.ownerId && target.roles?.highest?.position >= bot.roles.highest.position) return {ok:false,code:'ROLE_HIERARCHY',message:'Discord role hierarchy prevents me from acting on that member.'};
  }
  if (target && actor && ['ban','kick','timeout','untimeout','voicemute','voiceunmute','voicedeafen','voiceundeafen','textmute','textunmute'].includes(action)) {
    if (target.id===actor.id) return {ok:false,code:'SELF_TARGET',message:'I will not perform that moderation action against you.'};
  }
  return {ok:true};
}

module.exports={check,has};
