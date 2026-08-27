// Maps natural-language permission phrases to Discord permission flag keys.
// scope: 'voice'  -> enforceable per-channel on voice/stage channels via PermissionOverwrites
//        'text'   -> enforceable per-channel on text/announcement/forum/thread channels via PermissionOverwrites
//        'any'    -> enforceable per-channel on any channel type via PermissionOverwrites
//        'guild'  -> only meaningful server-wide; not a channel overwrite. For a role target this
//                    edits the role's base permissions. For a member target, JARVIS manages a
//                    dedicated role ("JARVIS: <permission>") since Discord has no way to grant an
//                    individual member a guild-wide permission outside of a role.
const CATALOG = [
  { key: 'UseSoundboard', name: 'Use Soundboard', scope: 'voice', patterns: ['soundboard', 'sound board', 'sound boards', 'soundboards'] },
  { key: 'Speak', name: 'Speak', scope: 'voice', patterns: ['speak', 'speaking', 'talk in voice'] },
  { key: 'Stream', name: 'Video', scope: 'voice', patterns: ['stream', 'streaming', 'video', 'go live', 'screen share', 'screenshare'] },
  { key: 'Connect', name: 'Connect', scope: 'voice', patterns: ['connect', 'connecting', 'join voice', 'joining voice channels'] },
  { key: 'PrioritySpeaker', name: 'Priority Speaker', scope: 'voice', patterns: ['priority speaker'] },
  { key: 'UseEmbeddedActivities', name: 'Use Activities', scope: 'voice', patterns: ['activities', 'embedded activities', 'use activities'] },
  { key: 'UseVAD', name: 'Use Voice Activity', scope: 'voice', patterns: ['voice activity', 'voice activity detection'] },
  { key: 'RequestToSpeak', name: 'Request to Speak', scope: 'voice', patterns: ['request to speak', 'requesting to speak'] },
  { key: 'MuteMembers', name: 'Mute Members', scope: 'voice', patterns: ['mute members', 'muting members', 'server muting'] },
  { key: 'DeafenMembers', name: 'Deafen Members', scope: 'voice', patterns: ['deafen members', 'deafening members', 'server deafening'] },
  { key: 'MoveMembers', name: 'Move Members', scope: 'voice', patterns: ['move members', 'moving members'] },

  { key: 'SendMessages', name: 'Send Messages', scope: 'text', patterns: ['send messages', 'sending messages', 'messaging', 'texting', 'chatting'] },
  { key: 'CreatePublicThreads', name: 'Create Public Threads', scope: 'text', patterns: ['public threads', 'create threads', 'creating threads'] },
  { key: 'CreatePrivateThreads', name: 'Create Private Threads', scope: 'text', patterns: ['private threads'] },
  { key: 'EmbedLinks', name: 'Embed Links', scope: 'text', patterns: ['embed links', 'embedding links', 'links', 'embeds'] },
  { key: 'AttachFiles', name: 'Attach Files', scope: 'text', patterns: ['attach files', 'attaching files', 'uploading files', 'file uploads', 'uploads'] },
  { key: 'AddReactions', name: 'Add Reactions', scope: 'text', patterns: ['add reactions', 'reacting', 'reactions'] },
  { key: 'UseExternalEmojis', name: 'Use External Emojis', scope: 'text', patterns: ['external emojis', 'use external emojis'] },
  { key: 'UseExternalStickers', name: 'Use External Stickers', scope: 'text', patterns: ['external stickers', 'use external stickers'] },
  { key: 'MentionEveryone', name: 'Mention Everyone', scope: 'text', patterns: ['mention everyone', 'mentioning everyone', 'pinging everyone', 'at everyone'] },
  { key: 'ManageMessages', name: 'Manage Messages', scope: 'text', patterns: ['manage messages', 'deleting messages', 'pinning messages'] },
  { key: 'ManageThreads', name: 'Manage Threads', scope: 'text', patterns: ['manage threads', 'managing threads'] },
  { key: 'ReadMessageHistory', name: 'Read Message History', scope: 'text', patterns: ['read message history', 'reading history', 'message history'] },
  { key: 'SendVoiceMessages', name: 'Send Voice Messages', scope: 'text', patterns: ['voice messages', 'sending voice messages'] },

  { key: 'ViewChannel', name: 'View Channel', scope: 'any', patterns: ['viewing the channel', 'seeing the channel', 'access this channel', 'view channels', 'viewing channels'] },
  { key: 'ManageChannels', name: 'Manage Channels', scope: 'any', patterns: ['manage channels', 'managing channels'] },
  { key: 'CreateInstantInvite', name: 'Create Invite', scope: 'any', patterns: ['create invite', 'creating invites', 'inviting people', 'invites'] },
  { key: 'ManageWebhooks', name: 'Manage Webhooks', scope: 'any', patterns: ['manage webhooks', 'webhooks'] },
  { key: 'ManageEvents', name: 'Manage Events', scope: 'any', patterns: ['manage events', 'events'] },
  { key: 'UseApplicationCommands', name: 'Use Application Commands', scope: 'any', patterns: ['slash commands', 'application commands', 'using commands'] },

  { key: 'KickMembers', name: 'Kick Members', scope: 'guild', patterns: ['kick members', 'kicking members', 'kicking people'] },
  { key: 'BanMembers', name: 'Ban Members', scope: 'guild', patterns: ['ban members', 'banning members', 'banning people'] },
  { key: 'ManageNicknames', name: 'Manage Nicknames', scope: 'guild', patterns: ['manage nicknames', 'managing nicknames'] },
  { key: 'ChangeNickname', name: 'Change Nickname', scope: 'guild', patterns: ['change nickname', 'changing their nickname', 'changing nickname'] },
  { key: 'ManageRoles', name: 'Manage Roles', scope: 'guild', patterns: ['manage roles', 'managing roles'] },
  { key: 'ManageGuild', name: 'Manage Server', scope: 'guild', patterns: ['manage server', 'manage guild', 'managing the server', 'server settings'] },
  { key: 'ManageGuildExpressions', name: 'Manage Expressions', scope: 'guild', patterns: ['manage emojis', 'manage expressions', 'manage stickers', 'managing emojis'] },
  { key: 'ModerateMembers', name: 'Moderate Members (Timeout)', scope: 'guild', patterns: ['moderate members', 'timing out members', 'timeout members', 'timeouts'] },
  { key: 'ViewAuditLog', name: 'View Audit Log', scope: 'guild', patterns: ['view audit log', 'audit log'] },
  { key: 'MentionEveryone', name: 'Mention Everyone', scope: 'text', patterns: ['mentioning roles'] },
  { key: 'Administrator', name: 'Administrator', scope: 'guild', patterns: ['administrator', 'admin', 'full control', 'everything', 'all permissions', 'superior', 'super admin', 'god mode'] }
];

function normalizePhrase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\bany\b/g, ' ')
    .replace(/\busing\b/g, ' ')
    .replace(/\buse\b/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findPermission(phrase) {
  const norm = normalizePhrase(phrase);
  if (!norm) return null;
  let best = null, bestLen = -1;
  for (const entry of CATALOG) {
    for (const p of entry.patterns) {
      if (norm === p || norm.includes(p) || p.includes(norm)) {
        if (p.length > bestLen) { bestLen = p.length; best = entry; }
      }
    }
  }
  return best;
}

module.exports = { CATALOG, findPermission };
