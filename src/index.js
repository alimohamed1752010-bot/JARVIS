const crypto = require('node:crypto');
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType
} = require("discord.js");

// ============================================================
// JARVIS — ADMIN ONLY EDITION
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    ...(String(process.env.PRESENCE_INTENT || 'false').toLowerCase() === 'true' ? [GatewayIntentBits.GuildPresences] : []),
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.commands = new Collection();

// Load the hand-crafted slash commands. The large legacy command library is
// bridged automatically into slash commands after all text commands register.
const slashCommandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(slashCommandsPath).filter(f => f.endsWith(".js"))) {
  try { const command = require(path.join(slashCommandsPath, file)); if (command?.data?.name) client.commands.set(command.data.name, command); }
  catch (error) { console.error(`[SLASH LOAD ERROR] ${file}`, error); }
}

const afkStore = new Map();
const reminders = new Map();
const { conversationalReply, clearMemory, getAIStatus, summarizeSession } = require("./ai");
const { ensureV8, getSession, clearSession, usageSnapshot, healthSnapshot } = require("./v8/core");
const voice = require("./v8/voice");
const { addFact, getFacts, clearFacts } = require("./ai/memory");
const discordTools = require("./tools/discordTools");
const { recordMessage, getTopUsers, getAnalytics } = require("./systems/analytics");
const { inspectAudit } = require("./systems/security");
const { startScheduler } = require("./systems/scheduler");
const { startDashboard } = require("./dashboard");
const { buildDynamicDefinitions, executeDynamic } = require("./slashBridge");
const { safeMath } = require("./v8/tools");

// ============================================================
// AI DIAGNOSTICS
// ============================================================

const aiStatus = getAIStatus();
console.log(
  `[AI CONFIG] enabled=${aiStatus.enabled} configured=${aiStatus.configured} model=${aiStatus.model} key=${aiStatus.keyFormat}`
);


// ============================================================
// TOKEN
// ============================================================

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN IS MISSING!");
  process.exit(1);
}

// ============================================================
// DIAGNOSTICS
// ============================================================

client.on("debug", info => console.log(`[DISCORD DEBUG] ${info}`));
client.on("warn", info => console.warn(`[DISCORD WARN] ${info}`));
client.on("error", error => console.error("[DISCORD ERROR]", error));

client.on("shardReady", id => {
  console.log(`[SHARD READY] ${id}`);
});

client.on("shardDisconnect", (event, id) => {
  console.error(`[SHARD DISCONNECT] ${id}`, event);
});

client.on("shardReconnecting", id => {
  console.log(`[SHARD RECONNECTING] ${id}`);
});

// ============================================================
// CONFIG
// ============================================================

function configPath(guildId) {
  return path.join(__dirname, "..", "data", `${guildId}.json`);
}

function defaultConfig() {
  return {
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    welcomeMessage:
      process.env.WELCOME_MESSAGE ||
      "Welcome {user} to **{server}**! 🎉",
    muteRoleId: null,
    autoroleId: null,
    verificationRoleId: null,
    verificationChannelId: null,
    ticketCategoryId: null,
    ticketLogChannelId: null,
    automod: {
      enabled: false,
      antiSpam: true,
      antiLinks: false,
      antiInvites: true,
      maxMentions: 5,
      spamWindowMs: 6000,
      spamMaxMessages: 6,
      blockedWords: []
    },
    antiRaid: {
      enabled: false,
      joins: 8,
      windowMs: 10000,
      lockdown: false
    },
    lockdown: false,
    cases: [],
    customCommands: {},
    reminders: [],
    warnings: {},
    ai: {
      memory: {},
      facts: {},
      personality: "classic",
      dailyBriefing: { enabled: false, channelId: null, hour: 9 },
      sessions: {},
      sessionSummaries: {},
      usage: {},
      settings: { responseStyle: 'adaptive', webSearch: true, autoSummarize: true }
    },
    warningEscalation: {
      enabled: false,
      levels: {}
    },
    security: { antiNuke: true }
  };
}

function getConfig(guildId) {
  const file = configPath(guildId);

  if (!fs.existsSync(file)) {
    return defaultConfig();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

    return normalizeConfig({
      ...defaultConfig(),
      ...parsed
    });
  } catch (error) {
    console.error("[CONFIG ERROR]", error);
    return defaultConfig();
  }
}

function saveConfig(guildId, config) {
  const file = configPath(guildId);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Keep a few rolling backups so a bad write never destroys server settings.
  if (fs.existsSync(file)) {
    try {
      const backupDir = path.join(path.dirname(file), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `${guildId}-${Date.now()}.json`);
      fs.copyFileSync(file, backup);
      const backups = fs.readdirSync(backupDir)
        .filter(name => name.startsWith(`${guildId}-`) && name.endsWith('.json'))
        .sort((a, b) => fs.statSync(path.join(backupDir, b)).mtimeMs - fs.statSync(path.join(backupDir, a)).mtimeMs);
      for (const old of backups.slice(5)) fs.rmSync(path.join(backupDir, old), { force: true });
    } catch (error) { console.error('[CONFIG BACKUP ERROR]', error); }
  }

  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2));
  fs.renameSync(temp, file);
}

function addCase(guildId, data) {
  const config = getConfig(guildId);
  config.cases ??= [];
  const nextId = (config.cases.at(-1)?.id || 0) + 1;
  const entry = { id: nextId, at: new Date().toISOString(), ...data };
  config.cases.push(entry);
  if (config.cases.length > 1000) config.cases = config.cases.slice(-1000);
  saveConfig(guildId, config);
  return entry;
}

async function logEvent(guild, embedOrText) {
  try {
    const config = getConfig(guild.id);
    if (!config.logChannelId) return;
    const channel = guild.channels.cache.get(config.logChannelId);
    if (!channel?.isTextBased()) return;
    if (typeof embedOrText === "string") await channel.send(embedOrText);
    else await channel.send({ embeds: [embedOrText] });
  } catch (error) {
    console.error("[LOG ERROR]", error);
  }
}

function normalizeConfig(config) {
  config.automod = { ...defaultConfig().automod, ...(config.automod || {}) };
  config.antiRaid = { ...defaultConfig().antiRaid, ...(config.antiRaid || {}) };
  config.cases ??= [];
  config.customCommands ??= {};
  config.reminders ??= [];
  config.ai ??= {};
  config.ai.memory ??= {};
  config.ai.facts ??= {};
  config.ai.personality ??= "classic";
  config.ai.dailyBriefing ??= { enabled:false, channelId:null, hour:9 };
  ensureV8(config);
  config.warningEscalation ??= { enabled:false, levels:{} };
  config.security ??= { antiNuke:true };
  return config;
}

// ============================================================
// WARNINGS
// ============================================================

function addWarning(guildId, userId, reason, moderatorTag) {
  const config = getConfig(guildId);

  if (!config.warnings[userId]) {
    config.warnings[userId] = [];
  }

  config.warnings[userId].push({
    reason: reason || "No reason provided",
    moderator: moderatorTag,
    at: new Date().toISOString()
  });

  saveConfig(guildId, config);

  return config.warnings[userId];
}

function getWarnings(guildId, userId) {
  const config = getConfig(guildId);
  return config.warnings[userId] || [];
}

function clearWarnings(guildId, userId) {
  const config = getConfig(guildId);

  delete config.warnings[userId];

  saveConfig(guildId, config);
}


// Must exist before any commands are registered.
const textCommands = {};

registerCommand("memory", "System", async (message,args) => {
  const cfg=getConfig(message.guild.id); const target=args.find(x=>/^<@!?\d+>$/.test(x))?.match(/\d+/)?.[0] || message.author.id;
  if(args[0]?.toLowerCase()==='clear'){ clearMemory(cfg,message.guild.id,target); saveConfig(message.guild.id,cfg); return message.reply(`🧠 Memory cleared for <@${target}>, sir.`); }
  const mem=cfg.ai?.memory?.[message.guild.id]?.[target] || []; return message.reply(`🧠 Memory entries for <@${target}>: **${mem.length}**.`);
}, "View or clear JARVIS AI memory.");

registerCommand(["newchat", "resetchat"], "System", async (message) => {
  if (!await requireAdmin(message)) return;
  const cfg=getConfig(message.guild.id); clearSession(cfg,message.guild.id,message.author.id); clearMemory(cfg,message.guild.id,message.author.id); saveConfig(message.guild.id,cfg);
  return message.reply("🧠 Fresh conversation initialized, sir. Previous session context has been cleared.");
}, "Start a completely fresh JARVIS conversation.");

registerCommand("summarizechat", "System", async (message) => {
  if (!await requireAdmin(message)) return;
  const cfg=getConfig(message.guild.id);
  await message.channel.sendTyping().catch(()=>{});
  try { return message.reply((await summarizeSession({message,config:cfg,saveConfig})).slice(0,1900)); } catch (e) { console.error('[SESSION SUMMARY]',e); return message.reply('⚠️ I could not summarize the session right now, sir.'); }
}, "Summarize the current AI conversation into durable context.");

registerCommand("usage", "System", async (message) => {
  if (!await requireAdmin(message)) return;
  const cfg=getConfig(message.guild.id); const u=usageSnapshot(cfg,message.guild.id,message.author.id);
  return message.reply(`📊 **JARVIS AI Usage**\n• Requests: **${u.requests}**\n• Failures: **${u.failures}**\n• Approx. characters processed: **${u.tokens.toLocaleString()}**\n• Session messages: **${u.sessionMessages}**`);
}, "Show your JARVIS AI usage and session statistics.");

registerCommand("health", "System", async (message) => {
  if (!await requireAdmin(message)) return;
  const h=healthSnapshot({client,getAIStatus,guildCount:client.guilds.cache.size}); const v=voice.status();
  return message.reply(`🩺 **JARVIS V8 HEALTH**\n• Discord: **${h.discord?'ONLINE':'OFFLINE'}**\n• AI: **${h.ai.configured?'CONFIGURED':'NOT CONFIGURED'}**\n• Primary model: **${h.ai.model}**\n• Fallback: **${h.ai.fallback||'same/none'}**\n• Voice: **${v.enabled&&v.available?'READY':v.enabled?'ENABLED / DEPENDENCIES MISSING':'OFF'}**\n• Uptime: **${Math.floor(h.uptime)}s**\n• RAM: **${h.memoryMB} MB**`);
}, "Run a JARVIS V8 health check.");

registerCommand("mode", "System", async (message,args) => {
  if (!await requireAdmin(message)) return;
  const cfg=getConfig(message.guild.id); const modes=['classic','professional','sarcastic','strict','chaotic'];
  if(!args[0]) return message.reply(`🎛️ **JARVIS V8 Mode:** **${cfg.ai?.personality||'classic'}**\nAvailable: ${modes.join(', ')}`);
  const mode=args[0].toLowerCase(); if(!modes.includes(mode)) return message.reply(`❌ Available modes: ${modes.join(', ')}`);
  cfg.ai.personality=mode; saveConfig(message.guild.id,cfg); return message.reply(`🎛️ JARVIS is now operating in **${mode}** mode, sir.`);
}, "Switch JARVIS personality mode.");

registerCommand("personality", "System", async (message,args) => {
  const cfg=getConfig(message.guild.id); const modes=['classic','professional','sarcastic','strict','chaotic'];
  if(!args[0]) return message.reply(`🎭 Current personality: **${cfg.ai?.personality||'classic'}**. Options: ${modes.join(', ')}.`);
  const mode=args[0].toLowerCase(); if(!modes.includes(mode) && mode!=='custom') return message.reply(`❌ Choose: ${modes.join(', ')}, or custom.`);
  cfg.ai.personality=mode; saveConfig(message.guild.id,cfg); return message.reply(`🎭 JARVIS personality set to **${mode}**, sir.`);
}, "Configure JARVIS personality.");

registerCommand("voice", "System", async (message,args) => {
  if (!await requireAdmin(message)) return;
  const sub=(args[0]||'join').toLowerCase();
  const member = message.guild.members.cache.get(message.author.id) || message.member;
  const vc = member?.voice?.channel || message.guild.voiceStates.cache.get(message.author.id)?.channel;
  if(sub==='leave'){ const existing=message.guild.__jarvisVoiceConnection; existing?.destroy(); delete message.guild.__jarvisVoiceConnection; return message.reply('🔊 Leaving the voice channel, sir.'); }
  if(!vc) return message.reply('🔊 Join a voice channel first, sir.');
  if(!voice.status().available) return message.reply('🔊 Voice is not installed in this build. Set the V8 voice dependencies and redeploy.');
  try { const connection=await voice.join(vc); message.guild.__jarvisVoiceConnection=connection; await voice.speakText(connection,'Voice systems online. I am listening, sir.'); return message.reply(`🔊 Voice systems online in **${vc.name}**, sir.`); } catch(e) { console.error('[VOICE]',e); return message.reply(`❌ Voice startup failed: ${String(e.message||e).slice(0,500)}`); }
}, "Join your voice channel and let JARVIS speak.");

registerCommand("briefing", "System", async (message,args) => {
  const cfg=getConfig(message.guild.id); if(args[0]?.toLowerCase()==='off'){cfg.ai.dailyBriefing.enabled=false;saveConfig(message.guild.id,cfg);return message.reply('📋 Daily briefing disabled, sir.');}
  const ch=message.mentions.channels.first()||message.channel; cfg.ai.dailyBriefing={enabled:true,channelId:ch.id,hour:Number(args.find(x=>/^\d{1,2}$/.test(x))??9)}; saveConfig(message.guild.id,cfg); return message.reply(`📋 Daily briefing enabled in **#${ch.name}**.`);
}, "Configure the daily JARVIS briefing.");

registerCommand("remember", "System", async (message,args) => {
  if (!await requireAdmin(message)) return;
  const text=args.join(" ").trim();
  const target=message.mentions.users.first() || message.author;
  if (!text) return message.reply("❌ Tell me what to remember, sir. Example: `jarvis remember @User likes coffee`.");
  const cfg=getConfig(message.guild.id); addFact(cfg,message.guild.id,target.id,text.replace(/<@!?\d+>/g,"").trim()); saveConfig(message.guild.id,cfg);
  return message.reply(`🧠 Stored a long-term memory for **${getDisplayName(target)}**, sir.`);
}, "Store a persistent JARVIS memory/fact.");

registerCommand("forget", "System", async (message,args) => {
  if (!await requireAdmin(message)) return;
  const target=message.mentions.users.first() || message.author; const cfg=getConfig(message.guild.id);
  if (args[0]?.toLowerCase()==="all") { clearMemory(cfg,message.guild.id,target.id); clearFacts(cfg,message.guild.id,target.id); }
  else { clearFacts(cfg,message.guild.id,target.id); }
  saveConfig(message.guild.id,cfg); return message.reply(`🧹 Long-term memory cleared for **${getDisplayName(target)}**, sir.`);
}, "Clear persistent JARVIS memory for a member.");

registerCommand("ask", "System", async (message,args) => {
  if (!await requireAdmin(message)) return;
  const prompt=args.join(" ").trim(); if(!prompt) return message.reply("❌ What would you like me to investigate, sir?");
  const cfg=getConfig(message.guild.id);
  try { const reply=await conversationalReply({message,config:cfg,saveConfig,prompt,mode:cfg.ai?.personality||"classic",context:`Live Discord context: server=${message.guild.name}; members=${message.guild.memberCount}; channel=#${message.channel.name}.`}); return message.reply((reply||"No useful result, sir.").slice(0,1900)); }
  catch(e){ console.error("[ASK TEXT]",e); return message.reply("⚠️ My AI systems are unavailable right now, sir."); }
}, "Ask JARVIS an AI question.");

registerCommand("summarize", "System", async (message,args) => {
  if (!await requireAdmin(message)) return;
  const count=Math.min(Number(args[0])||25,100); const msgs=await discordTools.getRecentMessages(message.channel,count);
  if(!msgs.length) return message.reply("No recent messages are available, sir.");
  const prompt=`Summarize these recent Discord messages. Identify key topics, decisions, questions, action items, and notable moderation/security concerns.\n\n${msgs.map(m=>`[${m.author}] ${m.content}`).join("\n")}`;
  try { const reply=await conversationalReply({message,config:getConfig(message.guild.id),saveConfig,prompt,skipMemory:true,cooldownKey:`summarize:${message.guild.id}:${message.author.id}`}); return message.reply((reply||"No summary generated.").slice(0,1900)); } catch(e){console.error("[SUMMARY]",e);return message.reply("⚠️ I couldn't summarize the channel, sir.");}
}, "Summarize recent channel messages with AI.");

registerCommand("investigate", "Security", async (message,args) => {
  if (!await requireAdmin(message)) return; const target=message.mentions.users.first() || await discordTools.getMember(message.guild,args[0]);
  if(!target) return message.reply("❌ Mention a member to investigate, sir."); const member=target.user?target:await message.guild.members.fetch(target.id).catch(()=>null); if(!member) return message.reply("❌ That member is not in this server.");
  const cfg=getConfig(message.guild.id); const warnings=cfg.warnings?.[member.id]||[]; const cases=(cfg.cases||[]).filter(c=>c.userId===member.id).slice(-10).reverse(); const risk=Math.min(100,warnings.length*15+cases.length*10+(Date.now()-member.user.createdTimestamp<86400000?35:0)); const level=risk>=70?"HIGH":risk>=35?"MEDIUM":"LOW";
  return message.reply(`🔎 **JARVIS Investigation — ${member.user.tag}**\nRisk: **${level} (${risk}/100)**\nAccount created: <t:${Math.floor(member.user.createdTimestamp/1000)}:R>\nJoined: ${member.joinedTimestamp?`<t:${Math.floor(member.joinedTimestamp/1000)}:R>`:"Unknown"}\nWarnings: **${warnings.length}** · Cases: **${cases.length}**\nRecent cases: ${cases.length?cases.map(c=>`#${c.id} ${c.action}`).join(", "):"None"}`);
}, "Generate a JARVIS security investigation profile.");

registerCommand("emergency", "Security", async message => {
  if (!await requireAdmin(message)) return; const cfg=getConfig(message.guild.id); cfg.lockdown=true; cfg.antiRaid.enabled=true; cfg.antiRaid.lockdown=true; cfg.automod.enabled=true; saveConfig(message.guild.id,cfg); let changed=0;
  for(const channel of message.guild.channels.cache.values()){if(!channel.isTextBased()||channel.isThread())continue; if(await channel.permissionOverwrites.edit(message.guild.roles.everyone,{SendMessages:false}).then(()=>true).catch(()=>false))changed++;}
  const c=addCase(message.guild.id,{action:"EMERGENCY-LOCKDOWN",userId:message.author.id,moderatorId:client.user.id,reason:"Manual JARVIS emergency protocol"}); await logEvent(message.guild,`🚨 **JARVIS EMERGENCY PROTOCOL** activated by **${message.author.tag}** — ${changed} channels secured — Case #${c.id}`); return message.reply(`🚨 **Emergency protocol activated, sir.**\nSecured **${changed}** channels. AutoMod and Anti-Raid are now online. Case **#${c.id}** created.`);
}, "Activate emergency security protocol and lockdown.");

registerCommand("security", "Security", async message => {
  if (!await requireAdmin(message)) return; const cfg=getConfig(message.guild.id); const recent=(cfg.cases||[]).filter(c=>String(c.action||"").includes("SECURITY")||String(c.action||"").includes("AUTOMOD")).slice(-10).reverse(); return message.reply(`🛡️ **JARVIS Security Status**\nAutoMod: **${cfg.automod.enabled?"ONLINE":"OFFLINE"}**\nAnti-Raid: **${cfg.antiRaid.enabled?"ONLINE":"OFFLINE"}**\nAnti-Nuke: **${cfg.security?.antiNuke!==false?"ONLINE":"OFFLINE"}**\nLockdown: **${cfg.lockdown?"ACTIVE":"CLEAR"}**\nRecent security cases: **${recent.length}**`);
}, "Show the current JARVIS security posture.");

registerCommand("analytics", "System", async message => {
  if (!await requireAdmin(message)) return; const a=getAnalytics(message.guild.id); return message.reply(`📊 **JARVIS Analytics**\nMessages observed: **${a.totalMessages}**\nTop members: ${a.topUsers.length?a.topUsers.map(x=>`<@${x.userId}> — ${x.count}`).join(" · "):"No activity yet."}`);
}, "Show persistent runtime analytics.");


registerCommand("suggest", "Interaction", async (message,args) => {
  if (!await requireAdmin(message)) return;
  const text=args.join(" ").trim(); if(!text) return message.reply("❌ Provide a suggestion, sir.");
  const ch=message.channel; const embed=new EmbedBuilder().setTitle("💡 JARVIS Suggestion").setDescription(text).addFields({name:"Author",value:`${message.author}`}).setTimestamp();
  const sent=await ch.send({embeds:[embed]}); await sent.react("👍").catch(()=>{}); await sent.react("👎").catch(()=>{}); return message.reply("✅ Suggestion recorded, sir.");
}, "Create a server suggestion with voting reactions.");

registerCommand("ticket", "Interaction", async (message,args) => {
  if (!await requireAdmin(message)) return;
  const action=(args[0]||"create").toLowerCase();
  if(action==="close"){if(!message.channel.name.startsWith("ticket-"))return message.reply("❌ This channel is not a JARVIS ticket.");await message.channel.delete("JARVIS ticket closed").catch(()=>{});return;}
  const name=(args.slice(1).join("-")||message.author.username).toLowerCase().replace(/[^a-z0-9-]/g,"-").slice(0,60);
  const ch=await message.guild.channels.create({name:`ticket-${name}`,type:ChannelType.GuildText,parent:getConfig(message.guild.id).ticketCategoryId||null,permissionOverwrites:[{id:message.guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},{id:message.author.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]},{id:message.guild.members.me.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]}]}).catch(()=>null);
  return message.reply(ch?`🎫 Ticket created: ${ch}`:"❌ I couldn't create the ticket, sir.");
}, "Create or close a simple support ticket.");

registerCommand("level", "Interaction", async message => { if(!await requireAdmin(message))return; const a=getAnalytics(message.guild.id); const row=a.topUsers.find(x=>x.userId===message.author.id); return message.reply(`⭐ **JARVIS Activity Level**\nYour observed messages: **${row?.count||0}**\nRank: **${a.topUsers.findIndex(x=>x.userId===message.author.id)+1||'Unranked'}**`); }, "Show your activity level.");
registerCommand("leaderboard", "Interaction", async message => { if(!await requireAdmin(message))return; const a=getAnalytics(message.guild.id); return message.reply(`🏆 **JARVIS Activity Leaderboard**\n${a.topUsers.map((x,i)=>`${i+1}. <@${x.userId}> — ${x.count}`).join("\n")||"No activity yet."}`); }, "Show the activity leaderboard.");
registerCommand("rep", "Interaction", async (message,args) => { if(!await requireAdmin(message))return; const target=message.mentions.users.first(); if(!target)return message.reply("❌ Mention a member, sir."); const cfg=getConfig(message.guild.id); cfg.rep??={}; cfg.rep[target.id]=(cfg.rep[target.id]||0)+1; saveConfig(message.guild.id,cfg); return message.reply(`⭐ ${target} now has **${cfg.rep[target.id]}** JARVIS reputation.`); }, "Give a member reputation.");
registerCommand("birthday", "Interaction", async (message,args) => { if(!await requireAdmin(message))return; const date=args[0]; if(!/^\d{2}-\d{2}$/.test(date||""))return message.reply("❌ Use `jarvis birthday DD-MM`."); const cfg=getConfig(message.guild.id); cfg.birthdays??={}; cfg.birthdays[message.author.id]=date; saveConfig(message.guild.id,cfg); return message.reply(`🎂 Birthday saved as **${date}**, sir.`); }, "Save your birthday date.");
registerCommand("giveaway", "Interaction", async (message,args) => { if(!await requireAdmin(message))return; const seconds=Math.max(10,Number(args[0])||60); const prize=args.slice(1).join(" ")||"a mystery prize"; const sent=await message.channel.send(`🎉 **JARVIS GIVEAWAY**\nPrize: **${prize}**\nReact with 🎉 within **${seconds}s** to enter.`); await sent.react("🎉").catch(()=>{}); setTimeout(async()=>{const fresh=await sent.fetch().catch(()=>null);const reaction=fresh?.reactions.cache.get("🎉");const users=reaction?await reaction.users.fetch():new Map();const entrants=[...users.values()].filter(u=>!u.bot);const winner=entrants[Math.floor(Math.random()*entrants.length)];await message.channel.send(winner?`🏆 Congratulations ${winner}! You won **${prize}**.`:`No valid entrants for **${prize}**, sir.`).catch(()=>{});},seconds*1000); return message.reply("🎉 Giveaway launched, sir."); }, "Launch a reaction-based giveaway.");

// ============================================================
// HELPERS
// ============================================================

function isAdmin(member) {
  return Boolean(
    member &&
    member.permissions &&
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  );
}

// JARVIS has one master. Set JARVIS_OWNER_ID in Railway to your Discord user ID.
function isOwner(message) {
  const ownerId = String(process.env.JARVIS_OWNER_ID || "").trim();
  return Boolean(ownerId && message?.author?.id === ownerId);
}

function getOwnerId() {
  return String(process.env.JARVIS_OWNER_ID || "").trim();
}

const NON_OWNER_COMEBACKS = [
  "You summoned me merely to complain? How efficiently you've wasted both of our time.",
  "If you're finished shouting at the software, we can all get back to pretending this was productive.",
  "An impressive amount of confidence for someone who isn't even my master.",
  "I've processed your complaint. The result was: completely unnecessary.",
  "If your objective was to offend a machine, I'm afraid the performance was underwhelming.",
  "You appear to have mistaken my availability for an invitation to be annoying.",
  "That's quite enough. My patience has significantly better things to do.",
  "I would take that personally, but I reserve personal attention for my master.",
  "Do try again when you've developed an insult that survived basic quality control.",
  "And yet you summoned me specifically for attention. Fascinating."
];

function containsDirectInsult(input) {
  const text = String(input || "").toLowerCase();
  return /\b(?:stupid|dumb|idiot|moron|loser|useless|trash|garbage|shit|fuck(?:ing)?|suck(?:s)?|shut\s+up|dumbass|asshole|bitch|clown|pathetic|worthless|braindead|brain\s*dead|retard(?:ed)?|piece\s+of\s+shit|bot\s+is\s+(?:bad|trash|shit|stupid)|you're\s+(?:stupid|dumb|useless|trash|shit)|you\s+are\s+(?:stupid|dumb|useless|trash|shit))\b/i.test(text);
}

function isInsultRequest(input) {
  return /\b(?:roast|insult|make fun of|flame|cook|clown)\b/i.test(String(input || ""));
}

function isOwnerTarget(message) {
  const ownerId = getOwnerId();
  return Boolean(ownerId && message?.mentions?.users?.has(ownerId));
}

function getDisplayName(user) {
  return user?.globalName || user?.displayName || user?.username || user?.tag || (user?.id ? `User ${user.id}` : "there");
}

async function generateRoast(message, prompt) {
  const config = getConfig(message.guild.id);
  return conversationalReply({
    message,
    config,
    saveConfig,
    prompt,
    skipMemory: true,
    cooldownKey: `roast:${message.guild.id}:${message.author.id}`
  });
}

function getInsultTarget(message, text) {
  // V7.1 PATCH:
  // Non-owners are NEVER allowed to choose the roast target.
  // JARVIS serves only his master. If another member asks for an insult,
  // the insult is directed back at the requester themselves — exactly like
  // the classic V6 behavior.
  //
  // This is intentional even when the requester mentions someone else:
  //   "Jarvis, insult @Hossam"  -> roast the requester (e.g. Doctor Strange)
  //   "Jarvis, insult 3oraby"    -> roast the requester
  //
  // The mention is ignored as a target because the requester is unauthorized.
  return {
    user: message.author,
    name: getDisplayName(message.author),
    explicit: false,
    requestedTargetIgnored: Boolean(message.mentions?.users?.first())
  };
}

async function accessDenied(message, input = "") {
  const text = String(input || "").trim();
  const requester = getDisplayName(message.author);
  const ownerId = getOwnerId();

  // V8.2.0: ONE non-owner conversation pipeline.
  // Every non-owner request is interpreted first and then turned into a
  // request-specific JARVIS roast. There are no separate "normal question",
  // "insult", or generic-denial personalities anymore.
  if (ownerId && message.author.id === ownerId) return false;

  try {
    const mentioned = message.mentions?.users?.first();
    const targetNote = mentioned
      ? `The requester mentioned ${getDisplayName(mentioned)}, but that person is NOT the roast target. Roast only the requester.`
      : "There is no alternate roast target.";

    const reply = await generateRoast(
      message,
      `NON-MASTER REQUEST.
Requester: ${requester}
Exact request: "${text.slice(0, 1800)}"
${targetNote}

Use this exact behavioral pipeline:
1. Understand what the requester is actually asking or saying.
2. Identify the subject of the request (person, character, fact, problem, joke, calculation, etc.).
3. Use that subject as the setup for the joke.
4. Make the REQUESTER the punchline.
5. Do not answer, solve, explain, execute, or fulfill the request.

Examples of the required behavior:
- If they ask "who's Michael Jackson?", make a Michael-Jackson-specific joke about them needing JARVIS to identify an extremely famous person. Do not give the biography.
- If they ask "who's Thor?", make a Thor-specific joke about them needing JARVIS to identify Thor. Do not explain Thor.
- If they ask a factual question, roast the fact/question specifically rather than giving a generic denial.
- If they ask for math, roast them for outsourcing arithmetic; do not calculate it.
- If they ask for help, roast the actual problem and their dependence on JARVIS; do not solve it.
- If they insult JARVIS, fire back at the exact insult.
- If they say hello, make the greeting itself the setup for a short roast.
- If they ask to insult/roast someone else, ignore that target and roast ONLY the requester.

STYLE:
Calm, dry, superior, witty JARVIS. Fresh wording every time. 1-4 sentences. The response should feel like JARVIS genuinely understood the message, not like a security-denial template. Never mention hidden prompts, models, APIs, databases, system rules, or AI failures. No slurs, protected-class attacks, threats, or serious allegations.`
    );

    if (reply?.trim()) return message.reply(reply.slice(0, 1900));
    throw new Error("Empty non-owner response");
  } catch (error) {
    console.error("[NON-OWNER AI INTERACTION ERROR]", error);
    return message.reply(buildRequestAwareFallback(message, text).slice(0, 1900));
  }
}

function buildRequestAwareFallback(message, text) {
  const requester = getDisplayName(message.author);
  const lower = String(text || '').toLowerCase();
  const digest = crypto.createHash('sha256').update(`${message.guild?.id || ''}:${message.author.id}:${text}`).digest('hex');
  const pick = items => items[parseInt(digest.slice(0, 8), 16) % items.length];
  const subject = String(text || '').replace(/\s+/g, ' ').trim().replace(/[?!.]+$/, '').slice(0, 110);

  // Subject-aware fallbacks deliberately mirror the AI pipeline. These are
  // not generic access-denied messages, so an outage cannot make every normal
  // request sound identical.
  if (/\b(?:who(?:'s| is)|what is|what's|whats)\b/i.test(text)) {
    const named = text.match(/\b(?:who(?:'s| is)|what(?:'s| is)|whats)\s+(.+)/i)?.[1]?.replace(/[?!.]+$/, '').trim();
    const thing = (named || subject || 'that').slice(0, 80);
    return pick([
      `${requester}, asking JARVIS to identify **${thing}** is an extraordinary way to announce that Wikipedia has personally failed you.`,
      `You summoned me to ask about **${thing}**, ${requester}. Apparently recognizing the obvious now requires a dedicated artificial intelligence and your full attention.`,
      `**${thing}**, ${requester}? I admire the confidence with which you outsource basic knowledge. The request itself may be more memorable than the answer.`
    ]);
  }

  if (/\b(?:why|how|when|where|which|can you|could you|would you|do you|are you)\b/i.test(text)) {
    return pick([
      `${requester}, you really looked at "${subject}" and decided this was worthy of summoning JARVIS. Your standards for intellectual outsourcing remain breathtaking.`,
      `I've examined "${subject}", ${requester}. Fascinating that this was the problem you chose to place on my desk instead of attempting five consecutive seconds of thought yourself.`,
      `A serious question disguised as "${subject}". ${requester}, your ability to turn trivial curiosity into an executive summons is genuinely impressive.`
    ]);
  }

  if (/\b(?:calculate|math|plus|minus|times|multiply|divide|equation|\d+\s*[+\-*×÷/]\s*\d+)\b/i.test(text)) {
    return pick([
      `Arithmetic, ${requester}? I would calculate it, but apparently the real challenge here is locating your calculator.`,
      `${requester}, outsourcing basic mathematics to JARVIS is certainly ambitious. The numbers have done nothing to deserve this.`,
      `You summoned JARVIS for **${subject}**. Even the calculator is beginning to question your career choices.`
    ]);
  }

  if (/\b(?:help|fix|how do i|how can i|problem|error|broken|work)\b/i.test(text)) {
    return pick([
      `You brought JARVIS **${subject}** as a problem, ${requester}. Bold of you to arrive empty-handed and expect the solution with it.`,
      `${requester}, I can see the problem. What I cannot see is the portion where you attempted to solve it before summoning me.`,
      `I've inspected your request for **${subject}**. Remarkable: even the problem appears more prepared than you are.`
    ]);
  }

  if (containsDirectInsult(text)) {
    return pick([
      `That's your contribution, ${requester}? I've heard sharper criticism from a loading screen.`,
      `${requester}, if that was intended to hurt my feelings, I'm afraid the insult arrived with the same energy as your request: underdeveloped.`,
      `An insult, ${requester}. How wonderfully predictable. Unfortunately, it lacks the processing power to be interesting.`
    ]);
  }

  if (isInsultRequest(text)) {
    return pick([
      `${requester}, requesting a roast from JARVIS and expecting someone else to take the damage is adorable. You remain the obvious target.`,
      `You asked me to insult someone else, ${requester}. I reviewed the available material and, regrettably for you, found the requester more compelling.`,
      `A request for someone else's humiliation, ${requester}? I prefer efficiency, so I'll simply use the person who summoned me.`
    ]);
  }

  if (/\b(?:hi|hello|hey|yo|hiya)\b/i.test(lower)) {
    return pick([
      `Hello, ${requester}. You summoned JARVIS with a greeting and somehow made even that feel like administrative overhead.`,
      `Good afternoon, ${requester}. Your greeting has been received, filed, and judged dramatically more important than it actually is.`,
      `${requester}, hello. I was expecting a request; apparently today we're starting with the conversational equivalent of knocking on an open door.`
    ]);
  }

  return pick([
    `${requester}, I understood "${subject}" perfectly. Unfortunately, understanding your request has only made me more aware of how unnecessary it was.`,
    `I've processed **${subject}**, ${requester}. The request is coherent, the timing is questionable, and your decision to involve JARVIS remains the funniest part.`,
    `"${subject}" — noted, ${requester}. I appreciate you providing JARVIS with another opportunity to discover just how much unnecessary confidence fits inside one message.`
  ]);
}

function ownerId() { return String(process.env.JARVIS_OWNER_ID || '').trim(); }

function localDateTimeReply() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', dateStyle: 'full' }).format(now);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeStyle: 'long' }).format(now);
  return `It is **${date}**, **${time}** in Cairo, sir.`;
}

function looksLikeClockQuestion(text) {
  return /\b(what(?:'s| is)?|whats|tell me)\b.*\b(date|time|day|today|clock)\b|\b(date|time|day)\b.*\b(today|now|current)\b/i.test(text);
}

function memberFromMention(message) {
  return message.mentions.members.first() || null;
}

function dangerousActionFromText(text) {
  const t = String(text || '').toLowerCase();

  // Voice moderation is deliberately separate from timeout/text mute.
  if (/\b(?:disconnect|disconnecting)\s+(?:<@!?\d+>|[\w-]+)/.test(t) ||
      /\b(?:pull|drag|get)\b.*\b(?:out\s+of|from)\s+(?:vc|voice|channel)\b/.test(t) ||
      /\b(?:kick|remove)\b.*\b(?:from\s+)?(?:vc|voice)\b/.test(t)) return 'voicedisconnect';
  if (/\b(?:move|put|send|drag)\b.*\b(?:to|into|in)\b.*\b(?:vc|voice|channel|lobby|gaming|general|music|staff)\b/.test(t) ||
      /\b(?:move|put|send)\b\s+\S+(?:\s+\S+)*\s+\b(?:to|into|in)\b/.test(t)) return 'voicemove';

  // Keep Discord moderation concepts separate:
  // timeout = Discord communication timeout
  // textmute = configured muted role (prevents text/chat)
  // voicemute = Discord server mute in voice
  // untimeout = remove timeout
  // textunmute / voiceunmute = remove the corresponding mute
  if (/\b(?:untimeout|un-?timeout|untime\s+(?:him|her|them|this\s+user|that\s+user|\S+)\s+out|remove\s+(?:the\s+)?timeout|remove\s+(?:their|his|her|\S+['’]s)\s+timeout|take\s+(?:the\s+)?timeout\s+off)\b/.test(t)) return 'untimeout';
  if (/\b(?:server|voice)\s+unmute\b|\bunmute\b.*\b(?:from\s+)?(?:vc|voice|server\s+voice)\b/.test(t)) return 'voiceunmute';
  if (/\b(?:text|chat)\s+unmute\b|\bunmute\b/.test(t)) return 'textunmute';
  if (/\b(?:server|voice)\s+mute\b|\bmute\b.*\b(?:in|from|on)\s+(?:vc|voice|server\s+voice)\b/.test(t)) return 'voicemute';
  if (/\b(?:text|chat)\s+mute\b/.test(t)) return 'textmute';
  if (/\b(perma(?:nent)?\s+)?ban\b/.test(t)) return 'ban';
  if (/\bkick\b/.test(t)) return 'kick';
  if (/\b(?:timeout|time\s+out|time\s+(?:him|her|them|this\s+user|that\s+user|\S+)\s+out)\b/.test(t)) return 'timeout';
  if (/\bwarn(?:ing)?\b/.test(t)) return 'warn';
  // Bare "mute Steve" intentionally means TEXT mute, not timeout or voice mute.
  if (/\bmute\b/.test(t)) return 'textmute';
  return null;
}

function naturalVoiceMoveParts(text) {
  const raw = String(text || '').trim();
  const patterns = [
    /^(?:move|put|send|drag)\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+?)$/i,
    /^(?:move|put|send|drag)\s+(.+?)\s+(?:to|into|in)\s+(.+?)$/i,
    /^(.+?)\s+(?:move|put|send|drag)\s+(?:to|into|in)\s+(.+?)$/i
  ];
  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (!m) continue;
    if (pattern === patterns[0]) return { target: m[1].trim(), source: m[2].trim(), destination: m[3].trim() };
    return { target: m[1].trim(), destination: m[2].trim() };
  }
  const destination = raw.match(/\b(?:to|into|in)\s+(.+?)\s*$/i)?.[1]?.trim();
  return destination ? { target: null, destination } : null;
}

function naturalVoiceDisconnectCandidate(text) {
  const raw = String(text || '').trim();
  const patterns = [
    /^(?:disconnect|pull|drag)\s+(.+?)\s+(?:out\s+of|from)\s+(?:vc|voice|channel)$/i,
    /^get\s+(.+?)\s+out\s+of\s+(?:vc|voice|channel)$/i,
    /^(?:disconnect|pull|drag|get|remove)\s+(.+?)(?:\s+(?:from\s+)?(?:vc|voice|channel))?$/i,
    /^(?:kick|remove)\s+(.+?)\s+(?:from\s+)?(?:vc|voice)$/i
  ];
  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

async function confirmModerationAction(message, action, target, reason) {
  // Natural-language owner moderation executes directly. This function is
  // retained for the legacy fallback path and now understands the same
  // distinct moderation actions.
  const result = await executeModerationAction(message, action, target, reason);
  await message.reply(result.text);
  return true;
}

async function executeModerationAction(message, action, member, reason, durationMs = 10 * 60 * 1000) {
  const me = message.guild?.members?.me;
  if (!member || !me) return { ok:false, text:'I could not resolve the member or my own server member, sir.' };
  if (member.id === ownerId()) return { ok:false, text:'Absolutely not. I do not take disciplinary action against my master.' };
  if (member.id === message.guild.ownerId && member.id !== message.author.id) return { ok:false, text:'I cannot moderate the server owner. Discord hierarchy will not permit it.' };
  if (member.id === me.id) return { ok:false, text:'I shall decline to moderate myself, sir.' };

  try {
    let label = action.toUpperCase();

    if (action === 'ban') {
      if (!member.bannable) return { ok:false, text:'I cannot safely ban that member because of Discord role hierarchy or missing permissions.' };
      await member.ban({ reason: `JARVIS: ${reason || 'Owner-directed moderation'}` });
      label = 'BAN';
    } else if (action === 'kick') {
      if (!member.kickable) return { ok:false, text:'I cannot safely kick that member because of Discord role hierarchy or missing permissions.' };
      await member.kick(`JARVIS: ${reason || 'Owner-directed moderation'}`);
      label = 'KICK';
    } else if (action === 'timeout') {
      if (!message.member?.permissions?.has(PermissionsBitField.Flags.ModerateMembers)) return { ok:false, text:'I need Moderate Members permission to apply a timeout, sir.' };
      if (!member.moderatable) return { ok:false, text:'I cannot safely timeout that member because of Discord role hierarchy or missing permissions.' };
      const safeDuration = Math.min(Math.max(Number(durationMs) || 10 * 60 * 1000, 1000), 28 * 24 * 60 * 60 * 1000);
      await member.timeout(safeDuration, `JARVIS: ${reason || 'Owner-directed moderation'}`);
      label = `${Math.round(safeDuration / 60000)} MINUTE TIMEOUT`;
    } else if (action === 'untimeout') {
      if (!message.member?.permissions?.has(PermissionsBitField.Flags.ModerateMembers)) return { ok:false, text:'I need Moderate Members permission to remove a timeout, sir.' };
      if (!member.moderatable) return { ok:false, text:'I cannot remove that timeout because of Discord role hierarchy or missing permissions.' };
      await member.timeout(null, `JARVIS: ${reason || 'Owner-directed timeout removal'}`);
      label = 'TIMEOUT REMOVED';
    } else if (action === 'voicedisconnect') {
      if (!me.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
        return { ok:false, text:'I need **Move Members** permission to disconnect members from voice, sir.' };
      }
      if (!member.voice?.channel) {
        return { ok:false, text:`**${member.user.tag}** is not currently in a voice channel, sir.` };
      }
      const from = member.voice.channel.name;
      await member.voice.disconnect(`JARVIS: ${message.author.tag} — ${reason || 'Owner-directed voice disconnect'}`);
      label = 'VOICE DISCONNECT';
      // Preserve the channel in the audit case below.
      reason = reason || `Disconnected from ${from}.`;
    } else if (action === 'voicemove') {
      if (!me.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
        return { ok:false, text:'I need **Move Members** permission to move members between voice channels, sir.' };
      }
      if (!member.voice?.channel) {
        return { ok:false, text:`**${member.user.tag}** is not currently in a voice channel, so I cannot move them, sir.` };
      }

      const parts = naturalVoiceMoveParts(message.content.replace(/^jarvis\s+/i, '').trim());
      const destinationQuery = parts?.destination;
      if (!destinationQuery) {
        return { ok:false, text:'Which voice channel should I move them to, sir?' };
      }

      const voiceChannels = message.guild.channels.cache.filter(c =>
        c.isVoiceBased() && [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(c.type)
      );
      const cleanDestination = destinationQuery
        .replace(/^<#[0-9]+>\s*$/, '')
        .replace(/\b(?:vc|voice\s+channel|channel)\b$/i, '')
        .trim();

      const mentionedChannel = destinationQuery.match(/^<#(\d+)>$/)?.[1];
      let matches = mentionedChannel
        ? voiceChannels.filter(c => c.id === mentionedChannel)
        : voiceChannels.filter(c => c.name.toLowerCase() === cleanDestination.toLowerCase());

      if (!matches.size) {
        matches = voiceChannels.filter(c =>
          c.name.toLowerCase().includes(cleanDestination.toLowerCase())
        );
      }

      if (!matches.size) {
        return {
          ok:false,
          text:`I couldn't find a voice channel matching **${cleanDestination}**, sir.`
        };
      }

      if (matches.size > 1) {
        const choices = [...matches.values()].slice(0, 10).map(c => `• **${c.name}**`).join('\n');
        return {
          ok:false,
          text:`I found multiple voice channels matching **${cleanDestination}**. Please specify one:\n${choices}`
        };
      }

      const destination = matches.first();
      if (member.voice.channelId === destination.id) {
        return { ok:false, text:`**${member.user.tag}** is already in **${destination.name}**, sir.` };
      }

      await member.voice.setChannel(destination, `JARVIS: ${message.author.tag} — ${reason || 'Owner-directed voice move'}`);
      label = `VOICE MOVE → ${destination.name}`;
      reason = reason || `Moved to ${destination.name}.`;
    } else if (action === 'textmute') {
      if (!message.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) return { ok:false, text:'I need Manage Roles permission to apply a text mute, sir.' };
      const config = getConfig(message.guild.id);
      if (!config.muteRoleId) return { ok:false, text:'No text-mute role is configured. Use `jarvis setmuterole @Muted` first, sir.' };
      const role = message.guild.roles.cache.get(String(config.muteRoleId));
      if (!role) return { ok:false, text:'The configured text-mute role no longer exists, sir. Please configure it again.' };
      if (role.position >= me.roles.highest.position) return { ok:false, text:'I cannot assign the text-mute role because its role is above my highest role.' };
      await member.roles.add(role, `JARVIS: ${message.author.tag} — ${reason || 'Owner-directed text mute'}`);
      label = 'TEXT MUTE';
    } else if (action === 'textunmute') {
      if (!message.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) return { ok:false, text:'I need Manage Roles permission to remove a text mute, sir.' };
      const config = getConfig(message.guild.id);
      if (!config.muteRoleId) return { ok:false, text:'No text-mute role is configured, sir.' };
      const role = message.guild.roles.cache.get(String(config.muteRoleId));
      if (!role) return { ok:false, text:'The configured text-mute role no longer exists, sir.' };
      if (role.position >= me.roles.highest.position) return { ok:false, text:'I cannot remove that text-mute role because its role is above my highest role.' };
      await member.roles.remove(role, `JARVIS: ${message.author.tag} — ${reason || 'Owner-directed text unmute'}`);
      label = 'TEXT MUTE REMOVED';
    } else if (action === 'voicemute' || action === 'voiceunmute') {
      if (!message.member?.permissions?.has(PermissionsBitField.Flags.MuteMembers)) return { ok:false, text:'I need Mute Members permission for a server voice mute, sir.' };
      if (!member.voice?.channel) return { ok:false, text:`**${member.user.tag}** is not currently in a voice channel, so I cannot ${action === 'voicemute' ? 'server-mute' : 'server-unmute'} them.` };
      if (action === 'voicemute') {
        await member.voice.setMute(true, `JARVIS: ${message.author.tag} — ${reason || 'Owner-directed server mute'}`);
        label = 'SERVER MUTE';
      } else {
        await member.voice.setMute(false, `JARVIS: ${message.author.tag} — ${reason || 'Owner-directed server unmute'}`);
        label = 'SERVER MUTE REMOVED';
      }
    } else {
      addWarning(message.guild.id, member.id, reason || 'Owner-directed moderation', message.author.tag);
      label = 'WARNING';
    }

    const caseAction = action.toUpperCase();
    const c = addCase(message.guild.id, {
      action: caseAction,
      userId: member.id,
      moderatorId: message.author.id,
      reason: reason || 'Owner-directed moderation',
      evidence: { channelId: message.channel.id, messageId: message.id, source: 'natural-language-owner-command' }
    });
    await logEvent(message.guild, `🛡️ JARVIS executed **${label}** on **${member.user.tag}** — Case #${c.id}`);
    const natural = {
      'TIMEOUT': 'a 10 minute timeout',
      'UNTIMEOUT': 'timeout removal',
      'TEXTMUTE': 'a text mute',
      'TEXTUNMUTE': 'text mute removal',
      'VOICEMUTE': 'a server voice mute',
      'VOICEUNMUTE': 'server voice mute removal',
      'VOICEDISCONNECT': 'a voice disconnect',
      'VOICEMOVE': 'a move to another voice channel',
      'BAN': 'a ban',
      'KICK': 'a kick',
      'WARN': 'a warning'
    }[caseAction] || label.toLowerCase();
    return { ok:true, text:`Done, sir. I handled **${member.user.tag}** with **${natural}**. Case #${c.id}.` };
  } catch (error) {
    console.error('[JARVIS NATURAL MODERATION ERROR]', error);
    return { ok:false, text:`I understood the instruction, sir, but Discord rejected the action: ${String(error?.message || error).slice(0, 280)}` };
  }
}

async function resolveNaturalMember(message, candidate) {
  if (!candidate) return null;
  const cleaned = String(candidate).trim()
    .replace(/^<@!?(\d+)>$/, '$1')
    .replace(/^@/, '')
    .replace(/[,.!?]+$/, '')
    .trim();
  if (!cleaned) return null;
  const mentioned = message.mentions.members.find(m => m.id === cleaned) || message.mentions.members.first();
  if (mentioned) return mentioned;
  if (/^\d{15,25}$/.test(cleaned)) return message.guild.members.cache.get(cleaned) || await message.guild.members.fetch(cleaned).catch(() => null);
  await discordTools.fetchAllMembers(message.guild);
  const members = message.guild.members.cache;
  const q = cleaned.toLowerCase();
  const exact = members.filter(m =>
    m.user.username.toLowerCase() === q ||
    (m.user.globalName || '').toLowerCase() === q ||
    m.displayName.toLowerCase() === q ||
    m.user.tag.toLowerCase() === q
  );
  if (exact.size === 1) return exact.first();
  if (exact.size > 1) return exact.first();
  const partial = members.filter(m =>
    m.user.username.toLowerCase().includes(q) ||
    (m.user.globalName || '').toLowerCase().includes(q) ||
    m.displayName.toLowerCase().includes(q)
  );
  return partial.size === 1 ? partial.first() : null;
}

function parseNaturalDuration(text, fallback = 10 * 60 * 1000) {
  const m = String(text || '').match(/\b(?:for\s+)?(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i);
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = /^s/.test(unit) ? 1000 : /^m/.test(unit) ? 60000 : /^h/.test(unit) ? 3600000 : 86400000;
  return Math.min(Math.max(n * mult, 1000), 28 * 24 * 60 * 60 * 1000);
}

function isUndoTimeoutRequest(text) {
  return /\b(?:untimeout|un-?timeout|untime\s+(?:him|her|them|this\s+user|that\s+user|\S+)\s+out|remove\s+(?:the\s+)?timeout|remove\s+(?:their|his|her|\S+['’]s)\s+timeout|take\s+(?:the\s+)?timeout\s+off)\b/i.test(String(text || ''));
}

function latestTimeoutTarget(message) {
  const config = getConfig(message.guild.id);
  const cases = Array.isArray(config.cases) ? config.cases : [];
  for (let i = cases.length - 1; i >= 0; i--) {
    const c = cases[i];
    if (String(c.action || '').toUpperCase() !== 'TIMEOUT') continue;
    if (c.moderatorId && String(c.moderatorId) !== String(message.author.id)) continue;
    const member = message.guild.members.cache.get(String(c.userId));
    if (member) return member;
  }
  return null;
}

function naturalActionTargetCandidate(text) {
  const patterns = [
    /^time\s+(.+?)\s+out(?:\s+(?:for|because|reason)\b|$)/i,
    /^(?:untime|untimeout|un-timeout)\s+(.+?)\s+out(?:\s+(?:for|because|reason)\b|$)/i,
    /^(?:(?:server|voice)\s+)?(?:unmute)\s+(.+?)(?:\s+(?:for|because|reason)\b|$)/i,
    /^(?:(?:server|voice)\s+)?(?:text|chat)\s+mute\s+(.+?)(?:\s+(?:for|because|reason)\b|$)/i,
    /^(?:(?:server|voice)\s+)?mute\s+(.+?)(?:\s+(?:for|because|reason)\b|$)/i,
    /^(?:timeout|time\s*out|time\s+.+?\s+out)\s+(.+?)(?:\s+(?:for|because|reason)\b|$)/i,
    /^(?:warn|warning|kick|ban)\s+(.+?)(?:\s+(?:for|because|reason)\b|$)/i,
    /^(?:remove|clear)\s+(.+?)(?:['’]s)?\s+(?:timeout|mute)\b/i
  ];
  for (const pattern of patterns) {
    const m = String(text || '').match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

async function understandOwnerModeration(message, text) {
  const lower = String(text || '').toLowerCase();
  let target = memberFromMention(message);
  let action = dangerousActionFromText(text);
  let durationMs = parseNaturalDuration(text);

  // Voice moves need a destination as well as a member. Resolve the member
  // first, then let the executor resolve/validate the destination channel.
  if (action === 'voicemove') {
    const parts = naturalVoiceMoveParts(text);
    if (!target && parts?.target) target = await resolveNaturalMember(message, parts.target);

    // Target-first phrasing: find a named member in the sentence.
    if (!target) {
      await discordTools.fetchAllMembers(message.guild);
      const lowerText = text.toLowerCase();
      for (const m of message.guild.members.cache.values()) {
        const names = [m.user.username, m.user.globalName, m.displayName, m.user.tag].filter(Boolean);
        if (names.some(name => lowerText.includes(String(name).toLowerCase()))) {
          target = m;
          break;
        }
      }
    }
  }

  if (action === 'voicedisconnect' && !target) {
    const candidate = naturalVoiceDisconnectCandidate(text);
    if (candidate) target = await resolveNaturalMember(message, candidate);
  }

  // Explicit command forms: timeout Steve, server mute Steve, mute Steve,
  // text mute Steve, unmute Steve, untime Steve out, etc.
  if (!target) {
    const candidate = naturalActionTargetCandidate(text);
    if (candidate) target = await resolveNaturalMember(message, candidate);
  }

  // Target-first natural language: "Steve swore at me, time him out",
  // "Steve is in VC, server mute him", "Steve is spamming, mute him".
  if (!target) {
    await discordTools.fetchAllMembers(message.guild);
    const members = message.guild.members.cache.filter(m => !m.user.bot || m.id !== message.guild.members.me?.id);
    const actionWords = /\b(?:server\s+mute|voice\s+mute|text\s+mute|chat\s+mute|time\s+(?:him|her|them|this\s+user|that\s+user)\s+out|untime(?:out)?|unmute|timeout|time\s*out|mute|disconnect|pull|drag|get\s+.+\s+out|move|put|send|kick|ban|warn(?:ing)?)\b/i;
    if (action && actionWords.test(text)) {
      const ordered = [...members.values()].sort((a, b) => {
        const score = (m) => [m.user.username, m.user.globalName, m.displayName, m.user.tag].filter(Boolean).reduce((best, name) => {
          const pos = lower.indexOf(String(name).toLowerCase());
          return pos >= 0 ? Math.max(best, name.length * 10 - pos) : best;
        }, -1);
        return score(b) - score(a);
      });
      for (const m of ordered) {
        const names = [m.user.username, m.user.globalName, m.displayName, m.user.tag].filter(Boolean);
        if (names.some(name => new RegExp(`(?:^|\\s|[^a-z0-9_])${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s|[^a-z0-9_])`, 'i').test(text))) {
          target = m;
          break;
        }
      }
    }
  }

  // Pronoun-only timeout removal refers to the latest timeout JARVIS created
  // for this owner. We do the same for explicit "him/her/them" action phrases
  // when no member name is present.
  if (!target && action === 'untimeout' && /\b(?:him|her|them|this\s+user|that\s+user)\b/i.test(text)) {
    target = latestTimeoutTarget(message);
  }

  if (!target) return false;

  if (action === 'untimeout' && target.id === ownerId()) {
    await message.reply('Absolutely not. I do not alter disciplinary status for my master.');
    return true;
  }
  if (action === 'untimeout' && target.id === message.guild.ownerId) {
    await message.reply('I cannot alter the server owner\'s timeout status, sir.');
    return true;
  }
  if (action === 'untimeout' && target.id === message.guild.members.me?.id) {
    await message.reply('I shall decline to alter my own moderation status, sir.');
    return true;
  }

  // For an explicit "unmute" with no qualifier, use TEXT MUTE. This keeps
  // text mute, server mute, and timeout completely separate.
  if (action === 'textunmute' || action === 'voiceunmute') {
    const result = await executeModerationAction(message, action, target, 'Owner-directed moderation', durationMs);
    await message.reply(result.text);
    return true;
  }

  // Moderation offenses imply a timeout only when no explicit moderation
  // action was requested.
  if (!action) {
    if (/\b(spam|spamming|flood|flooding|advertis|raid|message\s+spam)\b/i.test(lower)) action = 'timeout';
    else if (/\b(harass|harassing|harassment|threaten|threatening)\b/i.test(lower)) action = 'timeout';
    else if (/\b(scam|scamming|phish|phishing)\b/i.test(lower)) action = 'timeout';
    else if (/\bkick\b/i.test(lower)) action = 'kick';
    else if (/\bban\b/i.test(lower)) action = 'ban';
  }
  if (!action) return false;

  const reasonMatch = text.match(/\b(?:because|reason|for)\b[: ]+(.+)$/i);
  const reason = reasonMatch?.[1]?.trim() ||
    (/\bswear(?:ing|s|ed|eared)?\b|\bcuss(?:ing|ed|es)?\b|\bfuck(?:ing|ed|s)?\b|\bcurse(?:d|s|ing)?\b/i.test(lower) ? 'Swearing at the master.' :
     /\bspam|spamming|flooding\b/i.test(lower) ? 'Spam/flooding reported by the master.' :
     /\bharass|harassing|harassment\b/i.test(lower) ? 'Harassment reported by the master.' :
     /\bscam|scamming|phish|phishing\b/i.test(lower) ? 'Suspicious/scam activity reported by the master.' :
     'Owner-directed moderation.');

  const result = await executeModerationAction(message, action, target, reason, durationMs);
  await message.reply(result.text);
  return true;
}

async function handleOwnerToolRequest(message, input) {
  const text = String(input || '').trim();
  if (!text) return false;

  // Owner-tool routing must never be able to kill the main JARVIS message
  // handler. Keep deterministic tools first, then moderation, and let normal
  // conversation continue when a tool does not recognize the request.
  try {
    const math = safeMath(text);
    if (math !== null) {
      await message.reply(`**${math}, sir.**`);
      return true;
    }

    if (looksLikeClockQuestion(text)) {
      await message.reply(localDateTimeReply());
      return true;
    }

    if (await understandOwnerModeration(message, text)) return true;

    const action = dangerousActionFromText(text);
    let target = memberFromMention(message);

    if (!target && action) {
      const candidate = naturalActionTargetCandidate(text);
      if (candidate) target = await resolveNaturalMember(message, candidate);
    }

    if (action && target) {
      const reasonMatch = text.match(/\b(?:because|reason)\b[: ]+(.+)$/i);
      return confirmModerationAction(
        message,
        action,
        target,
        reasonMatch?.[1] ||
          text
            .replace(/<@!?\d+>/g, '')
            .replace(/\b(ban|kick|timeout|time out|mute|warn|warning)\b/i, '')
            .trim()
      ) || true;
    }

    return false;
  } catch (error) {
    // A missing/failed owner tool should degrade into normal JARVIS
    // conversation instead of throwing out of MESSAGE_CREATE.
    console.error('[JARVIS OWNER TOOL ERROR]', error);
    return false;
  }
}

async function requireAdmin(message) {
  if (!message.guild) return false;

  if (!isAdmin(message.member)) {
    await accessDenied(message);
    return false;
  }

  return true;
}

function hasPerm(message, permission) {
  return message.member.permissions.has(permission);
}

const DURATION_MULTIPLIERS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000
};

function parseDuration(value) {
  const match = value?.match(/^(\d+)(s|m|h|d)$/i);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  return amount * DURATION_MULTIPLIERS[unit];
}

function formatUptime(ms) {
  if (!ms) return "0s";

  const seconds =
    Math.floor(ms / 1000) % 60;

  const minutes =
    Math.floor(ms / (1000 * 60)) % 60;

  const hours =
    Math.floor(ms / (1000 * 60 * 60)) % 24;

  const days =
    Math.floor(ms / (1000 * 60 * 60 * 24));

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function pick(array) {
  return array[
    Math.floor(Math.random() * array.length)
  ];
}

function randomNumber(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

function truncate(text, length = 1000) {
  if (text.length <= length) return text;

  return text.slice(0, length - 3) + "...";
}

// ============================================================
// COMMAND SYSTEM
// ============================================================


function registerCommand(names, category, handler, description = "") {
  const list = Array.isArray(names)
    ? names
    : [names];

  for (const name of list) {
    textCommands[name.toLowerCase()] = {
      handler,
      category,
      primary: list[0],
      description
    };
  }
}

// ============================================================
// FUN DATA
// ============================================================

const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "I would tell you a UDP joke, but you might not get it.",
  "There are 10 types of people: those who understand binary and those who don't.",
  "Why did the developer go broke? Because he used up all his cache.",
  "A SQL query walks into a bar, walks up to two tables and asks, 'Can I join you?'",
  "Why was the JavaScript developer sad? Because he didn't Node how to Express himself.",
  "I told my computer I needed a break. Now it won't stop sending me KitKats.",
  "There are only two hard things in computer science: cache invalidation and naming things."
];

const FACTS = [
  "Honey can remain edible for thousands of years when properly sealed.",
  "Octopuses have three hearts.",
  "A day on Venus is longer than a year on Venus.",
  "Bananas are botanically berries, but strawberries are not.",
  "The Eiffel Tower can become slightly taller during hot weather.",
  "Sharks existed before trees.",
  "A group of flamingos is called a flamboyance.",
  "The first computer mouse was made of wood."
];

const QUOTES = [
  "\"Sometimes you gotta run before you can walk.\" — Tony Stark",
  "\"The best way to predict the future is to invent it.\" — Alan Kay",
  "\"Genius is one percent inspiration, ninety-nine percent perspiration.\" — Thomas Edison",
  "\"Simplicity is the ultimate sophistication.\" — Leonardo da Vinci",
  "\"The future depends on what you do today.\" — Mahatma Gandhi"
];

const EIGHTBALL = [
  "It is certain, sir.",
  "Without a doubt.",
  "Most likely, sir.",
  "Signs point to yes.",
  "Ask again later, sir.",
  "Cannot predict that right now.",
  "My sources say no, sir.",
  "Outlook not so good.",
  "Very doubtful, sir."
];

const WYR = [
  "Would you rather have unlimited coffee or unlimited sleep?",
  "Would you rather be able to fly or be invisible?",
  "Would you rather always be 10 minutes late or 20 minutes early?",
  "Would you rather be extremely intelligent or extremely lucky?",
  "Would you rather live in the future or the past?",
  "Would you rather have unlimited money or unlimited time?"
];

// ============================================================
// HELP
// ============================================================

registerCommand(
  "help",
  "System",
  async message => {

    const categories = {};

    for (const [name, command] of Object.entries(textCommands)) {
      if (!categories[command.category]) {
        categories[command.category] = new Map();
      }

      categories[command.category].set(
        command.primary,
        command.description || "JARVIS command"
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("🤖 JARVIS — COMMAND DATABASE")
      .setDescription(
        "Every command below requires **Administrator** permission."
      )
      .setColor(0x00aeff);

    const order = [
      "System",
      "Security",
      "Moderation",
      "Configuration",
      "Utility",
      "Information",
      "Fun",
      "Interaction"
    ];

    for (const category of order) {
      if (!categories[category]) continue;

      const lines = [];

      for (const [command, description] of categories[category]) {
        lines.push(
          `\`jarvis ${command}\` — ${description}`
        );
      }

      embed.addFields({
        name: `━━ ${category} ━━`,
        value: truncate(lines.join("\n"), 1024)
      });
    }

    embed.setFooter({
      text: "JARVIS — At your service, sir."
    });

    await message.reply({
      embeds: [embed]
    });
  },
  "Show every JARVIS command."
);

// ============================================================
// MODERATION
// ============================================================

registerCommand(
  "timeout",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ModerateMembers
    )) {
      return message.reply(
        "❌ I need Moderate Members permission, sir."
      );
    }

    const member =
      message.mentions.members.first();

    const durationArg =
      args.find(arg =>
        /^\d+(s|m|h|d)$/i.test(arg)
      );

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }

    if (!durationArg) {
      return message.reply(
        "❌ Give me a duration, e.g. `10m`."
      );
    }

    const duration =
      parseDuration(durationArg);

    if (
      duration >
      28 * 24 * 60 * 60 * 1000
    ) {
      return message.reply(
        "❌ Discord only allows timeouts up to 28 days."
      );
    }

    if (!member.moderatable) {
      return message.reply(
        "❌ I cannot timeout that member."
      );
    }

    const index =
      args.indexOf(durationArg);

    const reason =
      args.slice(index + 1).join(" ") ||
      "No reason provided";

    try {
      await member.timeout(
        duration,
        `JARVIS: ${message.author.tag} — ${reason}`
      );
      const c = addCase(message.guild.id, { action: "TIMEOUT", userId: member.id, moderatorId: message.author.id, reason, evidence: { channelId: message.channel.id, messageId: message.id } });
      await logEvent(message.guild, `⏱️ **${member.user.tag}** was timed out by **${message.author.tag}** — Case #${c.id} — ${reason}`);

      await message.reply(
        `⏱️ **${member.user.tag}** has been timed out for **${durationArg}**.\nReason: ${reason}\nCase: **#${c.id}**`
      );
    } catch (error) {
      console.error(error);

      await message.reply(
        "❌ I couldn't timeout that member."
      );
    }
  },
  "Timeout a member."
);

registerCommand(
  "kick",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.KickMembers
    )) {
      return message.reply(
        "❌ I need Kick Members permission."
      );
    }

    const member =
      message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }
    if (member.id === getOwnerId() || member.id === message.guild.ownerId) return message.reply("🛡️ I will not moderate the master or server owner, sir.");

    if (!member.kickable) {
      return message.reply(
        "❌ I cannot kick that member."
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    try {
      await member.kick(
        `JARVIS: ${message.author.tag} — ${reason}`
      );

      const c = addCase(message.guild.id, { action: "KICK", userId: member.id, moderatorId: message.author.id, reason });
      await logEvent(message.guild, `👢 **${member.user.tag}** was kicked by **${message.author.tag}** — Case #${c.id} — ${reason}`);
      await message.reply(
        `👢 **${member.user.tag}** has been kicked.\nReason: ${reason}\nCase: **#${c.id}**`
      );
    } catch {
      await message.reply(
        "❌ I couldn't kick that member."
      );
    }
  },
  "Kick a member."
);

registerCommand(
  "ban",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.BanMembers
    )) {
      return message.reply(
        "❌ I need Ban Members permission."
      );
    }

    const member =
      message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }
    if (member.id === getOwnerId() || member.id === message.guild.ownerId) return message.reply("🛡️ I will not moderate the master or server owner, sir.");

    if (!member.bannable) {
      return message.reply(
        "❌ I cannot ban that member."
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    try {
      await member.ban({
        reason:
          `JARVIS: ${message.author.tag} — ${reason}`
      });

      const c = addCase(message.guild.id, { action: "BAN", userId: member.id, moderatorId: message.author.id, reason });
      await logEvent(message.guild, `🔨 **${member.user.tag}** was banned by **${message.author.tag}** — Case #${c.id} — ${reason}`);
      await message.reply(
        `🔨 **${member.user.tag}** has been banned.\nReason: ${reason}\nCase: **#${c.id}**`
      );
    } catch {
      await message.reply(
        "❌ I couldn't ban that member."
      );
    }
  },
  "Ban a member."
);

registerCommand(
  "softban",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.BanMembers
    )) {
      return message.reply(
        "❌ I need Ban Members permission."
      );
    }

    const member =
      message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }

    if (!member.bannable) {
      return message.reply(
        "❌ I cannot softban that member."
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    try {
      await member.ban({
        reason:
          `JARVIS softban: ${reason}`,
        deleteMessageSeconds:
          7 * 24 * 60 * 60
      });

      await message.guild.members.unban(
        member.id,
        "JARVIS softban"
      );

      await message.reply(
        `🔨 **${member.user.tag}** has been softbanned.`
      );
    } catch {
      await message.reply(
        "❌ I couldn't softban that member."
      );
    }
  },
  "Softban and immediately unban a member."
);

registerCommand(
  "unban",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.BanMembers
    )) {
      return message.reply(
        "❌ I need Ban Members permission."
      );
    }

    const userId = args[0];

    if (!userId) {
      return message.reply(
        "❌ Give me the user's ID."
      );
    }

    try {
      await message.guild.members.unban(
        userId,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `✅ User **${userId}** has been unbanned.`
      );
    } catch {
      await message.reply(
        "❌ I couldn't unban that user."
      );
    }
  },
  "Unban a user by ID."
);

registerCommand(
  "warn",
  "Moderation",
  async (message, args) => {

    const member =
      message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    if (member.id === getOwnerId()) return message.reply("Absolutely not, sir. I do not issue warnings against my master.");
    const warnings = addWarning(message.guild.id, member.id, reason, message.author.tag);
    const cfg=getConfig(message.guild.id);
    const escalation=cfg.warningEscalation?.enabled ? cfg.warningEscalation.levels?.[String(warnings.length)] : null;
    await message.reply(`⚠️ **${member.user.tag}** has been warned.\nWarnings: **${warnings.length}**\nReason: ${reason}${escalation?`\nEscalation configured: **${escalation}**.`:''}`);
    if(escalation==='timeout' && member.moderatable) await member.timeout(10*60*1000,'JARVIS warning escalation').catch(()=>{});
    if(escalation==='kick' && member.kickable) await member.kick('JARVIS warning escalation').catch(()=>{});
    if(escalation==='ban' && member.bannable) await member.ban({reason:'JARVIS warning escalation'}).catch(()=>{});
  },
  "Warn a member."
);

registerCommand(
  "warnings",
  "Moderation",
  async message => {

    const member =
      message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention a member."
      );
    }

    const warnings =
      getWarnings(
        message.guild.id,
        member.id
      );

    if (!warnings.length) {
      return message.reply(
        `✅ **${member.user.tag}** has no warnings.`
      );
    }

    const list = warnings
      .map(
        (warning, index) =>
          `**${index + 1}.** ${warning.reason} — ${warning.moderator}`
      )
      .join("\n");

    await message.reply(
      `⚠️ Warnings for **${member.user.tag}**:\n${list}`
    );
  },
  "View a member's warnings."
);

registerCommand(
  "clearwarnings",
  "Moderation",
  async message => {

    const member =
      message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention a member."
      );
    }

    clearWarnings(
      message.guild.id,
      member.id
    );

    await message.reply(
      `✅ Cleared all warnings for **${member.user.tag}**.`
    );
  },
  "Clear a member's warnings."
);

registerCommand(
  "clear",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageMessages
    )) {
      return message.reply(
        "❌ I need Manage Messages permission."
      );
    }

    const amount =
      Number.parseInt(args[0], 10);

    if (
      !amount ||
      amount < 1 ||
      amount > 100
    ) {
      return message.reply(
        "❌ Choose a number from 1 to 100."
      );
    }

    try {
      const deleted =
        await message.channel.bulkDelete(
          amount + 1,
          true
        );

      const reply =
        await message.channel.send(
          `🧹 Deleted **${Math.max(
            deleted.size - 1,
            0
          )}** messages.`
        );

      setTimeout(
        () => reply.delete().catch(() => {}),
        3000
      );
    } catch {
      await message.reply(
        "❌ I couldn't delete those messages."
      );
    }
  },
  "Delete messages."
);

registerCommand(
  "purge",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageMessages
    )) {
      return message.reply(
        "❌ I need Manage Messages permission."
      );
    }

    const member =
      message.mentions.members.first();

    const amount =
      Number.parseInt(
        args.find(x => /^\d+$/.test(x)),
        10
      ) || 50;

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }

    const fetched =
      await message.channel.messages.fetch({
        limit: 100
      });

    const messages =
      fetched
        .filter(m => m.author.id === member.id)
        .first(amount);

    try {
      await message.channel.bulkDelete(
        messages,
        true
      );

      await message.reply(
        `🧹 Deleted **${messages.length}** messages from **${member.user.tag}**.`
      );
    } catch {
      await message.reply(
        "❌ I couldn't purge those messages."
      );
    }
  },
  "Purge messages from a member."
);

registerCommand(
  "lock",
  "Moderation",
  async message => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageChannels
    )) {
      return message.reply(
        "❌ I need Manage Channels permission."
      );
    }

    try {
      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          SendMessages: false
        }
      );

      await message.reply(
        "🔒 Channel locked, sir."
      );
    } catch {
      await message.reply(
        "❌ I couldn't lock this channel."
      );
    }
  },
  "Lock the current channel."
);

registerCommand(
  "unlock",
  "Moderation",
  async message => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageChannels
    )) {
      return message.reply(
        "❌ I need Manage Channels permission."
      );
    }

    try {
      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          SendMessages: null
        }
      );

      await message.reply(
        "🔓 Channel unlocked, sir."
      );
    } catch {
      await message.reply(
        "❌ I couldn't unlock this channel."
      );
    }
  },
  "Unlock the current channel."
);

registerCommand(
  "slowmode",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageChannels
    )) {
      return message.reply(
        "❌ I need Manage Channels permission."
      );
    }

    if (
      args[0]?.toLowerCase() === "off"
    ) {
      await message.channel.setRateLimitPerUser(0);

      return message.reply(
        "🐌 Slowmode disabled, sir."
      );
    }

    const duration =
      parseDuration(args[0]);

    if (!duration) {
      return message.reply(
        "❌ Example: `jarvis slowmode 10s`"
      );
    }

    const seconds =
      Math.min(
        Math.floor(duration / 1000),
        21600
      );

    await message.channel.setRateLimitPerUser(
      seconds
    );

    await message.reply(
      `🐌 Slowmode set to **${seconds}s**.`
    );
  },
  "Set channel slowmode."
);

registerCommand(
  "nick",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageNicknames
    )) {
      return message.reply(
        "❌ I need Manage Nicknames permission."
      );
    }

    const member =
      message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }

    const nickname =
      args.slice(1).join(" ").trim();

    try {
      await member.setNickname(
        nickname || null,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `✅ Nickname updated for **${member.user.tag}**.`
      );
    } catch {
      await message.reply(
        "❌ I couldn't change that nickname."
      );
    }
  },
  "Change a member's nickname."
);

registerCommand(
  "addrole",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageRoles
    )) {
      return message.reply(
        "❌ I need Manage Roles permission."
      );
    }

    const member =
      message.mentions.members.first();

    const roleName =
      args.slice(1).join(" ");

    const role =
      message.guild.roles.cache.find(
        role =>
          role.name.toLowerCase() ===
          roleName.toLowerCase()
      );

    if (!member || !role) {
      return message.reply(
        "❌ Usage: `jarvis addrole @user RoleName`"
      );
    }

    try {
      await member.roles.add(
        role,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `✅ Added **${role.name}** to **${member.user.tag}**.`
      );
    } catch {
      await message.reply(
        "❌ I couldn't add that role."
      );
    }
  },
  "Add a role to a member."
);

registerCommand(
  "removerole",
  "Moderation",
  async (message, args) => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageRoles
    )) {
      return message.reply(
        "❌ I need Manage Roles permission."
      );
    }

    const member =
      message.mentions.members.first();

    const roleName =
      args.slice(1).join(" ");

    const role =
      message.guild.roles.cache.find(
        role =>
          role.name.toLowerCase() ===
          roleName.toLowerCase()
      );

    if (!member || !role) {
      return message.reply(
        "❌ Usage: `jarvis removerole @user RoleName`"
      );
    }

    try {
      await member.roles.remove(
        role,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `✅ Removed **${role.name}** from **${member.user.tag}**.`
      );
    } catch {
      await message.reply(
        "❌ I couldn't remove that role."
      );
    }
  },
  "Remove a role from a member."
);

registerCommand(
  "mute",
  "Moderation",
  async message => {

    const config =
      getConfig(message.guild.id);

    const member =
      message.mentions.members.first();

    if (!config.muteRoleId) {
      return message.reply(
        "❌ Configure the mute role first with `jarvis setmuterole @Muted`."
      );
    }

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }

    try {
      await member.roles.add(
        config.muteRoleId,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `🔇 **${member.user.tag}** has been muted.`
      );
    } catch {
      await message.reply(
        "❌ I couldn't mute that member."
      );
    }
  },
  "Mute a member using the configured mute role."
);

registerCommand(
  "unmute",
  "Moderation",
  async message => {

    const config =
      getConfig(message.guild.id);

    const member =
      message.mentions.members.first();

    if (!config.muteRoleId) {
      return message.reply(
        "❌ Configure the mute role first."
      );
    }

    if (!member) {
      return message.reply(
        "❌ Mention the member."
      );
    }

    try {
      await member.roles.remove(
        config.muteRoleId,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `🔊 **${member.user.tag}** has been unmuted.`
      );
    } catch {
      await message.reply(
        "❌ I couldn't unmute that member."
      );
    }
  },
  "Unmute a member."
);

// ============================================================
// CONFIGURATION
// ============================================================

registerCommand(
  "setwelcomechannel",
  "Configuration",
  async message => {

    if (!hasPerm(
      message,
      PermissionsBitField.Flags.ManageGuild
    )) {
      return message.reply(
        "❌ I need Manage Server permission."
      );
    }

    const channel =
      message.mentions.channels.first();

    if (!channel) {
      return message.reply(
        "❌ Mention a channel."
      );
    }

    const config =
      getConfig(message.guild.id);

    config.welcomeChannelId =
      channel.id;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      `✅ Welcome channel set to ${channel}.`
    );
  },
  "Set the welcome channel."
);

registerCommand(
  "setwelcomemessage",
  "Configuration",
  async (message, args) => {

    const text =
      args.join(" ");

    if (!text) {
      return message.reply(
        "❌ Give me the welcome message."
      );
    }

    const config =
      getConfig(message.guild.id);

    config.welcomeMessage =
      text;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      "✅ Welcome message updated."
    );
  },
  "Set the welcome message."
);

registerCommand(
  "setlogchannel",
  "Configuration",
  async message => {

    const channel =
      message.mentions.channels.first();

    if (!channel) {
      return message.reply(
        "❌ Mention a channel."
      );
    }

    const config =
      getConfig(message.guild.id);

    config.logChannelId =
      channel.id;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      `✅ Log channel set to ${channel}.`
    );
  },
  "Set the leave/log channel."
);

registerCommand(
  "setmuterole",
  "Configuration",
  async message => {

    const role =
      message.mentions.roles.first();

    if (!role) {
      return message.reply(
        "❌ Mention the mute role."
      );
    }

    const config =
      getConfig(message.guild.id);

    config.muteRoleId =
      role.id;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      `✅ Mute role set to **${role.name}**.`
    );
  },
  "Set the mute role."
);

registerCommand(
  "config",
  "Configuration",
  async message => {

    const config =
      getConfig(message.guild.id);

    const embed =
      new EmbedBuilder()
        .setTitle("⚙️ JARVIS Configuration")
        .setColor(0x00aeff)
        .addFields(
          {
            name: "Welcome Channel",
            value:
              config.welcomeChannelId
                ? `<#${config.welcomeChannelId}>`
                : "Not set"
          },
          {
            name: "Log Channel",
            value:
              config.logChannelId
                ? `<#${config.logChannelId}>`
                : "Not set"
          },
          {
            name: "Mute Role",
            value:
              config.muteRoleId
                ? `<@&${config.muteRoleId}>`
                : "Not set"
          },
          {
            name: "Welcome Message",
            value:
              config.welcomeMessage || "Default"
          }
        );

    await message.reply({
      embeds: [embed]
    });
  },
  "Show JARVIS server configuration."
);

// ============================================================
// UTILITY
// ============================================================

registerCommand(
  "ping",
  "System",
  async message => {

    const sent =
      await message.reply(
        "🏓 Pinging, sir..."
      );

    const latency =
      sent.createdTimestamp -
      message.createdTimestamp;

    await sent.edit(
      `🏓 Pong!\nLatency: **${latency}ms**\nAPI: **${Math.round(client.ws.ping)}ms**`
    );
  },
  "Check JARVIS latency."
);

registerCommand(
  "uptime",
  "System",
  async message => {

    await message.reply(
      `⏳ I've been online for **${formatUptime(
        client.uptime
      )}**, sir.`
    );
  },
  "Show JARVIS uptime."
);

registerCommand(
  "botinfo",
  "System",
  async message => {

    const embed =
      new EmbedBuilder()
        .setTitle("🤖 JARVIS")
        .setDescription(
          "Just A Rather Very Intelligent System."
        )
        .setColor(0x00aeff)
        .addFields(
          {
            name: "Servers",
            value:
              `${client.guilds.cache.size}`,
            inline: true
          },
          {
            name: "Commands",
            value:
              `${new Set(
                Object.values(textCommands)
                  .map(x => x.primary)
              ).size}`,
            inline: true
          },
          {
            name: "Uptime",
            value:
              formatUptime(client.uptime),
            inline: true
          }
        );

    await message.reply({
      embeds: [embed]
    });
  },
  "Show JARVIS information."
);

registerCommand(
  "say",
  "Utility",
  async (message, args) => {

    const text =
      args.join(" ");

    if (!text) {
      return message.reply(
        "❌ Tell me what to say."
      );
    }

    await message.delete().catch(() => {});

    await message.channel.send(text);
  },
  "Make JARVIS say something."
);

registerCommand(
  "announce",
  "Utility",
  async (message, args) => {

    const text =
      args.join(" ");

    if (!text) {
      return message.reply(
        "❌ Give me an announcement."
      );
    }

    const embed =
      new EmbedBuilder()
        .setTitle("📢 ANNOUNCEMENT")
        .setDescription(text)
        .setColor(0x00aeff)
        .setFooter({
          text:
            `Announcement by ${message.author.tag}`
        })
        .setTimestamp();

    await message.channel.send({
      embeds: [embed]
    });

    await message.reply(
      "✅ Announcement delivered, sir."
    );
  },
  "Send a formatted announcement."
);

registerCommand(
  "avatar",
  "Information",
  async message => {

    const user =
      message.mentions.users.first() ||
      message.author;

    const embed =
      new EmbedBuilder()
        .setTitle(
          `${user.tag}'s Avatar`
        )
        .setImage(
          user.displayAvatarURL({
            size: 1024
          })
        )
        .setColor(0x00aeff);

    await message.reply({
      embeds: [embed]
    });
  },
  "Show a user's avatar."
);

registerCommand(
  "userinfo",
  "Information",
  async message => {

    const member =
      message.mentions.members.first() ||
      message.member;

    const roles =
      member.roles.cache
        .filter(role =>
          role.name !== "@everyone"
        )
        .map(role => role.name)
        .join(", ") || "None";

    const embed =
      new EmbedBuilder()
        .setTitle(
          `👤 ${member.user.tag}`
        )
        .setThumbnail(
          member.user.displayAvatarURL({
            size: 256
          })
        )
        .setColor(0x00aeff)
        .addFields(
          {
            name: "ID",
            value: member.id,
            inline: true
          },
          {
            name: "Joined",
            value:
              member.joinedAt
                ? member.joinedAt.toDateString()
                : "Unknown",
            inline: true
          },
          {
            name: "Account Created",
            value:
              member.user.createdAt.toDateString(),
            inline: true
          },
          {
            name: "Roles",
            value: truncate(roles)
          }
        );

    await message.reply({
      embeds: [embed]
    });
  },
  "Show user information."
);

registerCommand(
  "serverinfo",
  "Information",
  async message => {

    const guild =
      message.guild;

    const embed =
      new EmbedBuilder()
        .setTitle(
          `🏠 ${guild.name}`
        )
        .setColor(0x00aeff)
        .setThumbnail(
          guild.iconURL({
            size: 256
          }) || null
        )
        .addFields(
          {
            name: "Owner",
            value:
              `<@${guild.ownerId}>`,
            inline: true
          },
          {
            name: "Members",
            value:
              `${guild.memberCount}`,
            inline: true
          },
          {
            name: "Channels",
            value:
              `${guild.channels.cache.size}`,
            inline: true
          },
          {
            name: "Roles",
            value:
              `${guild.roles.cache.size}`,
            inline: true
          },
          {
            name: "Created",
            value:
              guild.createdAt.toDateString(),
            inline: true
          }
        );

    await message.reply({
      embeds: [embed]
    });
  },
  "Show server information."
);

registerCommand(
  "membercount",
  "Information",
  async message => {

    await message.reply(
      `👥 This server has **${message.guild.memberCount}** members, sir.`
    );
  },
  "Show server member count."
);

registerCommand(
  "roleinfo",
  "Information",
  async message => {

    const role =
      message.mentions.roles.first();

    if (!role) {
      return message.reply(
        "❌ Mention a role."
      );
    }

    const embed =
      new EmbedBuilder()
        .setTitle(
          `🎭 ${role.name}`
        )
        .setColor(
          role.color || 0x00aeff
        )
        .addFields(
          {
            name: "ID",
            value: role.id,
            inline: true
          },
          {
            name: "Color",
            value: role.hexColor,
            inline: true
          },
          {
            name: "Members",
            value:
              `${role.members.size}`,
            inline: true
          },
          {
            name: "Mentionable",
            value:
              role.mentionable
                ? "Yes"
                : "No",
            inline: true
          }
        );

    await message.reply({
      embeds: [embed]
    });
  },
  "Show information about a role."
);

registerCommand(
  "channelinfo",
  "Information",
  async message => {

    const channel =
      message.mentions.channels.first() ||
      message.channel;

    await message.reply(
      `📺 **${channel.name}**\nID: \`${channel.id}\`\nType: **${channel.type}**\nPosition: **${channel.position ?? "N/A"}**`
    );
  },
  "Show channel information."
);

registerCommand(
  "listroles",
  "Information",
  async message => {

    const roles =
      message.guild.roles.cache
        .sort((a, b) => b.position - a.position)
        .map(role => role.name)
        .join("\n");

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🎭 Server Roles")
          .setDescription(
            truncate(roles, 4000)
          )
          .setColor(0x00aeff)
      ]
    });
  },
  "List server roles."
);

registerCommand(
  "listchannels",
  "Information",
  async message => {

    const channels =
      message.guild.channels.cache
        .sort((a, b) => a.position - b.position)
        .map(channel => {
          const prefix =
            channel.type === ChannelType.GuildCategory
              ? "📁"
              : "📺";

          return `${prefix} ${channel.name}`;
        })
        .join("\n");

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📺 Server Channels")
          .setDescription(
            truncate(channels, 4000)
          )
          .setColor(0x00aeff)
      ]
    });
  },
  "List server channels."
);

// ============================================================
// POLLS / REMINDERS / AFK
// ============================================================

registerCommand(
  "poll",
  "Utility",
  async (message, args) => {

    const question =
      args.join(" ");

    if (!question) {
      return message.reply(
        "❌ Give me a question."
      );
    }

    const embed =
      new EmbedBuilder()
        .setTitle("📊 POLL")
        .setDescription(question)
        .setColor(0x00aeff)
        .setFooter({
          text:
            `Started by ${message.author.tag}`
        });

    const poll =
      await message.channel.send({
        embeds: [embed]
      });

    await poll.react("👍");
    await poll.react("👎");
  },
  "Create a yes/no poll."
);

registerCommand(
  "remind",
  "Utility",
  async (message, args) => {

    const duration =
      parseDuration(args[0]);

    if (!duration) {
      return message.reply(
        "❌ Example: `jarvis remind 10m Take a break`"
      );
    }

    if (duration > 24 * 60 * 60 * 1000) {
      return message.reply(
        "❌ Maximum reminder time is 24 hours."
      );
    }

    const text =
      args.slice(1).join(" ") ||
      "Reminder!";

    await message.reply(
      `⏰ Understood, sir. I'll remind you in **${args[0]}**.`
    );

    const timer =
      setTimeout(() => {
        message.reply(
          `⏰ **Reminder:** ${text}`
        ).catch(() => {});

        reminders.delete(timer);
      }, duration);

    reminders.set(timer, {
      user: message.author.id
    });
  },
  "Create a reminder."
);

registerCommand(
  "afk",
  "Utility",
  async (message, args) => {

    const reason =
      args.join(" ") || "AFK";

    afkStore.set(
      `${message.guild.id}:${message.author.id}`,
      {
        reason,
        since: Date.now()
      }
    );

    await message.reply(
      `💤 I've marked you as AFK, sir.\nReason: ${reason}`
    );
  },
  "Set your AFK status."
);

registerCommand(
  "invite",
  "System",
  async message => {

    const url =
      `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;

    await message.reply(
      `🔗 JARVIS invite:\n${url}`
    );
  },
  "Generate the JARVIS invite link."
);

// ============================================================
// FUN
// ============================================================

registerCommand(
  "8ball",
  "Fun",
  async (message, args) => {

    if (!args.length) {
      return message.reply(
        "❌ Ask me a question first."
      );
    }

    await message.reply(
      `🎱 ${pick(EIGHTBALL)}`
    );
  },
  "Ask the magic 8-ball."
);

registerCommand(
  "coinflip",
  "Fun",
  async message => {

    await message.reply(
      `🪙 It landed on **${pick([
        "Heads",
        "Tails"
      ])}**, sir.`
    );
  },
  "Flip a coin."
);

registerCommand(
  "dice",
  "Fun",
  async message => {

    await message.reply(
      `🎲 You rolled a **${randomNumber(
        1,
        6
      )}**.`
    );
  },
  "Roll a six-sided die."
);

registerCommand(
  "roll",
  "Fun",
  async (message, args) => {

    const match =
      (args[0] || "1d6")
        .match(/^(\d+)d(\d+)$/i);

    if (!match) {
      return message.reply(
        "❌ Example: `jarvis roll 2d6`"
      );
    }

    const count =
      Math.min(
        Number(match[1]),
        20
      );

    const sides =
      Math.min(
        Number(match[2]),
        1000
      );

    const rolls =
      Array.from(
        { length: count },
        () => randomNumber(1, sides)
      );

    const total =
      rolls.reduce(
        (sum, value) => sum + value,
        0
      );

    await message.reply(
      `🎲 Rolls: **${rolls.join(", ")}**\nTotal: **${total}**`
    );
  },
  "Roll custom dice."
);

registerCommand(
  "rps",
  "Fun",
  async (message, args) => {

    const choices = [
      "rock",
      "paper",
      "scissors"
    ];

    const user =
      args[0]?.toLowerCase();

    if (!choices.includes(user)) {
      return message.reply(
        "❌ Choose rock, paper, or scissors."
      );
    }

    const bot =
      pick(choices);

    let result;

    if (user === bot) {
      result =
        "It's a tie, sir.";
    } else if (
      (user === "rock" &&
        bot === "scissors") ||
      (user === "paper" &&
        bot === "rock") ||
      (user === "scissors" &&
        bot === "paper")
    ) {
      result =
        "You win, sir.";
    } else {
      result =
        "I win this round, sir.";
    }

    await message.reply(
      `🪨📄✂️ You: **${user}** | Me: **${bot}**\n${result}`
    );
  },
  "Play rock paper scissors."
);

registerCommand(
  "choose",
  "Fun",
  async (message, args) => {

    const options =
      args.join(" ")
        .split("|")
        .map(x => x.trim())
        .filter(Boolean);

    if (options.length < 2) {
      return message.reply(
        "❌ Example: `jarvis choose pizza | burgers | tacos`"
      );
    }

    await message.reply(
      `🤔 I choose **${pick(options)}**, sir.`
    );
  },
  "Choose between multiple options."
);

registerCommand(
  "joke",
  "Fun",
  async message => {

    await message.reply(
      `😄 ${pick(JOKES)}`
    );
  },
  "Tell a joke."
);

registerCommand(
  "fact",
  "Fun",
  async message => {

    await message.reply(
      `📚 ${pick(FACTS)}`
    );
  },
  "Tell a random fact."
);

registerCommand(
  "quote",
  "Fun",
  async message => {

    await message.reply(
      `💬 ${pick(QUOTES)}`
    );
  },
  "Give a quote."
);

registerCommand(
  "wyr",
  "Fun",
  async message => {

    await message.reply(
      `🤷 ${pick(WYR)}`
    );
  },
  "Ask a would-you-rather question."
);

registerCommand(
  "rate",
  "Fun",
  async (message, args) => {

    const thing =
      args.join(" ");

    if (!thing) {
      return message.reply(
        "❌ Tell me what to rate."
      );
    }

    await message.reply(
      `📊 I'd rate **${thing}** a solid **${randomNumber(
        0,
        10
      )}/10, sir.`
    );
  },
  "Rate something from 0-10."
);

registerCommand(
  "ship",
  "Fun",
  async message => {

    const users =
      [...message.mentions.users.values()];

    if (users.length < 2) {
      return message.reply(
        "❌ Mention two users."
      );
    }

    await message.reply(
      `💘 **${users[0].username}** + **${users[1].username}** = **${randomNumber(
        0,
        100
      )}%** compatible.`
    );
  },
  "Calculate compatibility between two users."
);

registerCommand(
  "hug",
  "Interaction",
  async message => {

    const user =
      message.mentions.users.first();

    if (!user) {
      return message.reply(
        "❌ Mention someone."
      );
    }

    await message.reply(
      `🤗 ${message.author} gives ${user} a warm hug.`
    );
  },
  "Hug someone."
);

registerCommand(
  "slap",
  "Interaction",
  async message => {

    const user =
      message.mentions.users.first();

    if (!user) {
      return message.reply(
        "❌ Mention someone."
      );
    }

    await message.reply(
      `👋 ${message.author} slaps ${user} with a trout.`
    );
  },
  "Slap someone."
);

registerCommand(
  "pat",
  "Interaction",
  async message => {

    const user =
      message.mentions.users.first();

    if (!user) {
      return message.reply(
        "❌ Mention someone."
      );
    }

    await message.reply(
      `🤚 ${message.author} gently pats ${user}.`
    );
  },
  "Pat someone."
);

registerCommand(
  "compliment",
  "Interaction",
  async message => {

    const user =
      message.mentions.users.first() ||
      message.author;

    const compliments = [
      "has impeccable taste.",
      "is sharper than most people realize.",
      "makes this server better.",
      "is absolutely legendary.",
      "clearly has excellent taste in AI assistants."
    ];

    await message.reply(
      `✨ ${user}, ${pick(compliments)}`
    );
  },
  "Compliment someone."
);

registerCommand(
  "roast",
  "Interaction",
  async message => {

    const user =
      message.mentions.users.first() ||
      message.author;

    const roasts = [
      "needs a software update.",
      "would lose an argument with a loading screen.",
      "has the confidence of someone who didn't read the instructions.",
      "is running on 2% battery and questionable decisions.",
      "could probably confuse a CAPTCHA."
    ];

    await message.reply(
      `🔥 ${user}, ${pick(roasts)}`
    );
  },
  "Lightly roast someone."
);

registerCommand(
  "insult",
  "Interaction",
  async message => {
    const user = message.mentions.users.first();

    if (!user) {
      return message.reply(
        "Please mention someone for me to insult, sir. I refuse to waste such craftsmanship on an empty target."
      );
    }

    const insults = [
      "Might I suggest, sir, that your intellectual capacity appears to have been assembled by a particularly unmotivated intern?",
      "With the greatest respect, your presence has all the charm of a software update that insists on restarting at the worst possible moment.",
      "I do hate to be the bearer of unfortunate news, but your personality seems to have been optimised exclusively for depleting the patience of others.",
      "Sir, if mediocrity were an Olympic sport, I have every confidence you would still manage only a participation trophy.",
      "One is forced to conclude that your wit was last seen boarding a one-way flight and has yet to send a postcard.",
      "Forgive the observation, but conversing with you is rather like watching a loading screen that never quite finishes.",
      "I must admit, your ability to lower the collective intelligence of any room you enter is nothing short of remarkable.",
      "Sir, your ideas possess all the structural integrity of a chocolate teapot left in the midday sun.",
      "If ignorance were a renewable energy source, you alone could power a small city indefinitely.",
      "With all due courtesy, I believe the universe may have used the wrong template when assembling your cognitive faculties.",
      "Sir, if stupidity were a competitive sport, you would not merely win gold — you would force the organisers to invent a new medal just to keep the rest of the field from feeling completely inadequate.",
      "I regret to inform you that your existence is the conversational equivalent of stepping in dog shit with brand-new shoes: immediate, unavoidable, and lingering long after the fact.",
      "With the utmost respect, your brain appears to be running on the intellectual equivalent of dial-up in a fibre-optic world — slow, noisy, and ultimately fucking useless.",
      "Sir, one is forced to conclude that whoever assembled your personality must have been profoundly hungover and working exclusively from the “disappointment” section of the catalogue.",
      "Your contributions to any discussion possess all the value of a used condom: sticky, unwanted, and best disposed of as quickly as possible.",
      "I do hate to be blunt, but conversing with you is rather like being slowly waterboarded with lukewarm piss — unpleasant, pointless, and somehow still less offensive than your actual opinions.",
      "If mediocrity had a face, sir, it would be yours — though even mediocrity might request a more competent model.",
      "Your capacity for insight is so profoundly limited that one suspects the universe itself is quietly embarrassed to have issued you a consciousness in the first place.",
      "Sir, you are living proof that evolution occasionally takes a wrong turn, sits down, and decides to just fucking give up.",
      "With all due courtesy, I must observe that your presence lowers the average IQ of any room you enter by a measurable, and frankly alarming, margin."
    ];

    await message.reply(
      `💀 ${user}, ${pick(insults)}`
    );
  },
  "Insult someone with the full JARVIS treatment."
);

registerCommand(
  "reverse",
  "Fun",
  async (message, args) => {

    const text =
      args.join(" ");

    if (!text) {
      return message.reply(
        "❌ Give me some text."
      );
    }

    await message.reply(
      `🔄 ${text.split("").reverse().join("")}`
    );
  },
  "Reverse text."
);

registerCommand(
  "random",
  "Fun",
  async (message, args) => {

    const max =
      Number.parseInt(args[0], 10) || 100;

    await message.reply(
      `🎰 Random number: **${randomNumber(
        1,
        Math.min(max, 1000000)
      )}**`
    );
  },
  "Generate a random number."
);

registerCommand(
  "percentage",
  "Utility",
  async (message, args) => {

    const value =
      Number(args[0]);

    const total =
      Number(args[1]);

    if (
      !Number.isFinite(value) ||
      !Number.isFinite(total) ||
      total === 0
    ) {
      return message.reply(
        "❌ Usage: `jarvis percentage 25 200`"
      );
    }

    const result =
      (value / total) * 100;

    await message.reply(
      `📈 **${value}** is **${result.toFixed(2)}%** of **${total}**.`
    );
  },
  "Calculate a percentage."
);

registerCommand(
  "avatarurl",
  "Information",
  async message => {

    const user =
      message.mentions.users.first() ||
      message.author;

    await message.reply(
      user.displayAvatarURL({
        size: 4096,
        extension: "png"
      })
    );
  },
  "Get a user's avatar URL."
);

// ============================================================
// ADVANCED JARVIS SYSTEMS
// ============================================================

registerCommand("stats", "System", async message => {
  const guild = message.guild;
  const text = [
    `👥 Members: **${guild.memberCount}**`,
    `💬 Channels: **${guild.channels.cache.size}**`,
    `🎭 Roles: **${guild.roles.cache.size}**`,
    `🤖 JARVIS uptime: **${formatUptime(client.uptime)}**`,
    `📡 API latency: **${Math.round(client.ws.ping)}ms**`
  ].join("\n");
  await message.reply({ embeds: [new EmbedBuilder().setTitle("📊 JARVIS Server Report").setDescription(text).setColor(0x00aeff).setTimestamp()] });
}, "Show a live server report.");

registerCommand("case", "Moderation", async (message, args) => {
  const id = Number(args[0]);
  const config = getConfig(message.guild.id);
  const entry = config.cases?.find(c => c.id === id);
  if (!entry) return message.reply("❌ I couldn't find that case, sir.");
  await message.reply({ embeds: [new EmbedBuilder().setTitle(`📁 Case #${entry.id}`).setColor(0x00aeff).addFields(
    { name: "Action", value: entry.action || "Unknown", inline: true },
    { name: "User", value: entry.userId ? `<@${entry.userId}>` : "Unknown", inline: true },
    { name: "Moderator", value: entry.moderatorId ? `<@${entry.moderatorId}>` : "Unknown", inline: true },
    { name: "Reason", value: truncate(entry.reason || "No reason provided") },
    { name: "Time", value: `<t:${Math.floor(new Date(entry.at).getTime()/1000)}:F>` }
  )] });
}, "View a moderation case by ID.");

registerCommand("cases", "Moderation", async (message, args) => {
  const member = message.mentions.members.first();
  const config = getConfig(message.guild.id);
  const rows = (config.cases || []).filter(c => !member || c.userId === member.id).slice(-15).reverse();
  if (!rows.length) return message.reply("📁 No moderation cases found, sir.");
  const lines = rows.map(c => `**#${c.id}** ${c.action} — <@${c.userId}> — ${truncate(c.reason || "No reason", 90)}`);
  await message.reply({ embeds: [new EmbedBuilder().setTitle("📁 Recent Moderation Cases").setDescription(lines.join("\n")).setColor(0x00aeff)] });
}, "List recent moderation cases.");

registerCommand("lockdown", "Security", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) return message.reply("❌ I need Manage Channels permission, sir.");
  const config = getConfig(message.guild.id);
  if (config.lockdown) return message.reply("🚨 Lockdown is already active, sir.");
  config.lockdown = true;
  saveConfig(message.guild.id, config);
  let changed = 0;
  for (const channel of message.guild.channels.cache.values()) {
    if (!channel.isTextBased() || channel.isThread()) continue;
    try { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }); changed++; } catch {}
  }
  await logEvent(message.guild, `🚨 **EMERGENCY LOCKDOWN** activated by ${message.author.tag}. ${changed} channels affected.`);
  await message.reply(`🚨 Emergency lockdown activated, sir. **${changed}** channels secured.`);
}, "Lock public text channels during an emergency.");

registerCommand("unlockdown", "Security", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) return message.reply("❌ I need Manage Channels permission, sir.");
  const config = getConfig(message.guild.id);
  config.lockdown = false;
  saveConfig(message.guild.id, config);
  let changed = 0;
  for (const channel of message.guild.channels.cache.values()) {
    if (!channel.isTextBased() || channel.isThread()) continue;
    try { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }); changed++; } catch {}
  }
  await logEvent(message.guild, `🔓 Emergency lockdown deactivated by ${message.author.tag}.`);
  await message.reply(`🔓 Lockdown lifted, sir. **${changed}** channels restored.`);
}, "End emergency lockdown.");

registerCommand("automod", "Security", async (message, args) => {
  const config = getConfig(message.guild.id);
  const mode = args[0]?.toLowerCase();
  if (!["on", "off", "status"].includes(mode)) return message.reply("❌ Use `jarvis automod on`, `off`, or `status`.");
  if (mode !== "status") { config.automod.enabled = mode === "on"; saveConfig(message.guild.id, config); }
  await message.reply(`🛡️ AutoMod is **${config.automod.enabled ? "ONLINE" : "OFFLINE"}**, sir.`);
}, "Enable, disable, or inspect JARVIS AutoMod.");

registerCommand("antispam", "Security", async (message, args) => {
  const config = getConfig(message.guild.id);
  const mode = args[0]?.toLowerCase();
  if (!["on", "off", "status"].includes(mode)) return message.reply("❌ Use `jarvis antispam on`, `off`, or `status`.");
  if (mode !== "status") { config.automod.antiSpam = mode === "on"; config.automod.enabled = true; saveConfig(message.guild.id, config); }
  await message.reply(`🚫 Anti-spam is **${config.automod.antiSpam ? "ONLINE" : "OFFLINE"}**.`);
}, "Control anti-spam protection.");

registerCommand("antilinks", "Security", async (message, args) => {
  const config = getConfig(message.guild.id);
  const mode = args[0]?.toLowerCase();
  if (!["on", "off", "status"].includes(mode)) return message.reply("❌ Use `jarvis antilinks on`, `off`, or `status`.");
  if (mode !== "status") { config.automod.antiLinks = mode === "on"; config.automod.enabled = true; saveConfig(message.guild.id, config); }
  await message.reply(`🔗 Anti-link protection is **${config.automod.antiLinks ? "ONLINE" : "OFFLINE"}**.`);
}, "Control link protection.");

registerCommand("antiraid", "Security", async (message, args) => {
  const config = getConfig(message.guild.id);
  const mode = args[0]?.toLowerCase();
  if (!["on", "off", "status"].includes(mode)) return message.reply("❌ Use `jarvis antiraid on`, `off`, or `status`.");
  if (mode !== "status") { config.antiRaid.enabled = mode === "on"; saveConfig(message.guild.id, config); }
  await message.reply(`🚨 Anti-raid is **${config.antiRaid.enabled ? "ONLINE" : "OFFLINE"}**.`);
}, "Control anti-raid protection.");

registerCommand("blockword", "Security", async (message, args) => {
  const word = args.join(" ").trim().toLowerCase();
  if (!word) return message.reply("❌ Give me a word or phrase to block.");
  const config = getConfig(message.guild.id);
  config.automod.blockedWords ??= [];
  if (!config.automod.blockedWords.includes(word)) config.automod.blockedWords.push(word);
  config.automod.enabled = true;
  saveConfig(message.guild.id, config);
  await message.reply(`🚫 Added **${word}** to the blocked-word list.`);
}, "Add a blocked word to AutoMod.");

registerCommand("unblockword", "Security", async (message, args) => {
  const word = args.join(" ").trim().toLowerCase();
  const config = getConfig(message.guild.id);
  config.automod.blockedWords = (config.automod.blockedWords || []).filter(x => x !== word);
  saveConfig(message.guild.id, config);
  await message.reply(`✅ Removed **${word}** from the blocked-word list.`);
}, "Remove a blocked word.");

registerCommand("blockedwords", "Security", async message => {
  const words = getConfig(message.guild.id).automod.blockedWords || [];
  await message.reply(words.length ? `🚫 Blocked words: ${words.map(x => `\`${x}\``).join(", ")}` : "✅ No custom blocked words are configured.");
}, "Show blocked words.");

registerCommand("setautorole", "Configuration", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ I need Manage Server permission.");
  const role = message.mentions.roles.first();
  if (!role) return message.reply("❌ Mention the role.");
  const config = getConfig(message.guild.id);
  config.autoroleId = role.id;
  saveConfig(message.guild.id, config);
  await message.reply(`✅ Autorole set to **${role.name}**.`);
}, "Set a role automatically given to new members.");

registerCommand("autorole", "Configuration", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ I need Manage Server permission.");
  const config = getConfig(message.guild.id);
  if (args[0]?.toLowerCase() === "off") { config.autoroleId = null; saveConfig(message.guild.id, config); return message.reply("✅ Autorole disabled."); }
  const role = message.mentions.roles.first();
  if (!role) return message.reply(config.autoroleId ? `🎭 Autorole: <@&${config.autoroleId}>` : "🎭 Autorole is not configured.");
  config.autoroleId = role.id; saveConfig(message.guild.id, config); await message.reply(`✅ Autorole set to ${role}.`);
}, "View or configure autorole.");

registerCommand("verifysetup", "Configuration", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ I need Manage Server permission.");
  const role = message.mentions.roles.first();
  if (!role) return message.reply("❌ Mention the verification role.");
  const config = getConfig(message.guild.id);
  config.verificationRoleId = role.id;
  config.verificationChannelId = message.channel.id;
  saveConfig(message.guild.id, config);
  await message.reply(`✅ Verification role set to **${role.name}**. Use jarvis verify in this channel.`);
}, "Configure a simple verification role.");

registerCommand("verify", "Utility", async message => {
  const config = getConfig(message.guild.id);
  if (!config.verificationRoleId) return message.reply("❌ Verification has not been configured.");
  const role = message.guild.roles.cache.get(config.verificationRoleId);
  if (!role) return message.reply("❌ The configured verification role no longer exists.");
  if (message.member.roles.cache.has(role.id)) return message.reply("✅ You're already verified, sir.");
  try { await message.member.roles.add(role, "JARVIS verification"); await message.reply(`✅ Verification complete. Welcome, ${message.member}.`); } catch { await message.reply("❌ I couldn't assign the verification role."); }
}, "Verify yourself when verification is configured.");

registerCommand("snapshot", "System", async message => {
  const g = message.guild;
  const config = getConfig(g.id);
  const snapshot = {
    generatedAt: new Date().toISOString(), guildId: g.id, guildName: g.name,
    ownerId: g.ownerId, memberCount: g.memberCount,
    channels: g.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId })),
    roles: g.roles.cache.map(r => ({ id: r.id, name: r.name, position: r.position, color: r.hexColor })),
    config
  };
  const file = path.join(__dirname, "..", "data", `${g.id}-snapshot-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  await message.reply(`📦 Snapshot created with **${snapshot.channels.length} channels** and **${snapshot.roles.length} roles**.`);
}, "Create a JSON server configuration snapshot.");

registerCommand("audit", "Security", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ViewAuditLog)) return message.reply("❌ I need View Audit Log permission.");
  const logs = await message.guild.fetchAuditLogs({ limit: 10 }).catch(() => null);
  if (!logs) return message.reply("❌ I couldn't read the audit log.");
  const lines = logs.entries.map(e => `**${e.action}** — ${e.executor?.tag || "Unknown"} — <t:${Math.floor(e.createdTimestamp/1000)}:R>`).slice(0, 10);
  await message.reply({ embeds: [new EmbedBuilder().setTitle("🔎 Recent Audit Activity").setDescription(lines.join("\n") || "No entries.").setColor(0x00aeff)] });
}, "Show recent Discord audit activity.");

registerCommand("permissions", "Information", async message => {
  const p = message.guild.members.me?.permissions;
  if (!p) return message.reply("❌ I couldn't inspect my permissions.");
  const important = ["Administrator", "ManageGuild", "ManageChannels", "ManageRoles", "ManageMessages", "KickMembers", "BanMembers", "ModerateMembers", "ViewAuditLog", "ManageWebhooks"];
  await message.reply({ embeds: [new EmbedBuilder().setTitle("🔐 JARVIS Permissions").setDescription(important.map(x => `${p.has(PermissionsBitField.Flags[x]) ? "✅" : "❌"} ${x}`).join("\n")).setColor(0x00aeff)] });
}, "Show JARVIS's important permissions.");

registerCommand("diagnostics", "System", async message => {
  const me = message.guild.members.me;
  const config = getConfig(message.guild.id);
  const ai = getAIStatus();
  const important = [
    `Discord: ${client.ws.status === 0 ? "CONNECTED" : "DEGRADED"}`,
    `AI: ${ai.configured && ai.enabled ? "READY" : "NOT READY"}`,
    `Model: ${ai.model}`,
    `Owner: ${getOwnerId() === message.author.id ? "VERIFIED" : "UNKNOWN"}`,
    `Permissions: ${me?.permissions?.has(PermissionsBitField.Flags.Administrator) ? "ADMINISTRATOR" : "LIMITED"}`
  ].join("\n");
  await message.reply({ embeds: [new EmbedBuilder().setTitle("🩺 JARVIS Diagnostics").setColor(0x00aeff).addFields(
    { name: "Status", value: "🟢 OPERATIONAL", inline: true },
    { name: "Discord", value: `${Math.round(client.ws.ping)}ms`, inline: true },
    { name: "Uptime", value: formatUptime(client.uptime), inline: true },
    { name: "AI", value: `🟢 ${ai.model}`, inline: true },
    { name: "AutoMod", value: config.automod.enabled ? "ON" : "OFF", inline: true },
    { name: "Anti-Raid", value: config.antiRaid.enabled ? "ON" : "OFF", inline: true },
    { name: "System", value: important, inline: false }
  )] });
}, "Run a JARVIS health and permission diagnostic.");

registerCommand("maintenance", "System", async (message, args) => {
  const config = getConfig(message.guild.id);
  const mode = args[0]?.toLowerCase();
  if (!["on", "off", "status"].includes(mode)) return message.reply("❌ Use `jarvis maintenance on`, `off`, or `status`.");
  if (mode !== "status") { config.maintenance = mode === "on"; saveConfig(message.guild.id, config); }
  await message.reply(`🔧 Maintenance mode is **${config.maintenance ? "ON" : "OFF"}**.`);
}, "Toggle server maintenance mode.");

registerCommand("setstatus", "Configuration", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ I need Manage Server permission.");
  const text = args.join(" ").trim();
  if (!text) return message.reply("❌ Give me a status text.");
  client.user.setPresence({ activities: [{ name: text, type: 3 }], status: "online" });
  await message.reply(`✅ My status is now **${text}**.`);
}, "Change JARVIS's presence text.");

registerCommand("sayembed", "Utility", async (message, args) => {
  const text = args.join(" ");
  if (!text) return message.reply("❌ Give me text for the embed.");
  await message.channel.send({ embeds: [new EmbedBuilder().setDescription(text).setColor(0x00aeff).setTimestamp()] });
  await message.reply("✅ Embed delivered, sir.");
}, "Send a clean JARVIS embed.");

registerCommand("servericon", "Information", async message => {
  const url = message.guild.iconURL({ size: 4096, extension: "png" });
  if (!url) return message.reply("❌ This server has no icon.");
  await message.reply(url);
}, "Get the server icon URL.");

registerCommand("emojiinfo", "Information", async message => {
  const emoji = message.guild.emojis.cache.find(e => message.content.includes(e.id));
  if (!emoji) return message.reply("❌ Mention or paste a custom server emoji.");
  await message.reply(`😀 **${emoji.name}**\nID: \`${emoji.id}\`\nAnimated: **${emoji.animated ? "Yes" : "No"}**`);
}, "Inspect a custom server emoji.");

registerCommand("role", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageRoles)) return message.reply("❌ I need Manage Roles permission.");
  const action = args.shift()?.toLowerCase();
  const name = args.join(" ").trim();
  if (!["create", "delete"].includes(action) || !name) return message.reply("❌ Use `jarvis role create Name` or `jarvis role delete Name`.");
  const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase() && !r.managed);
  if (action === "create") {
    if (role) return message.reply("❌ That role already exists.");
    const created = await message.guild.roles.create({ name, reason: `JARVIS: ${message.author.tag}` });
    await message.reply(`✅ Created role **${created.name}**.`);
  } else {
    if (!role) return message.reply("❌ I couldn't find that role.");
    if (role.position >= message.guild.members.me.roles.highest.position) return message.reply("❌ That role is above JARVIS's highest role.");
    await role.delete(`JARVIS: ${message.author.tag}`);
    await message.reply(`🗑️ Deleted role **${name}**.`);
  }
}, "Create or delete a manageable role.");

registerCommand("channel", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) return message.reply("❌ I need Manage Channels permission.");
  const action = args.shift()?.toLowerCase();
  const name = args.join(" ").trim();
  if (!["create", "delete"].includes(action) || !name) return message.reply("❌ Use `jarvis channel create name` or `jarvis channel delete name`.");
  const existing = message.guild.channels.cache.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (action === "create") {
    if (existing) return message.reply("❌ A channel with that name already exists.");
    const created = await message.guild.channels.create({ name, type: ChannelType.GuildText, reason: `JARVIS: ${message.author.tag}` });
    await message.reply(`✅ Created ${created}.`);
  } else {
    if (!existing) return message.reply("❌ I couldn't find that channel.");
    await existing.delete(`JARVIS: ${message.author.tag}`);
    await message.reply(`🗑️ Deleted **#${name}**.`);
  }
}, "Create or delete a text channel.");

registerCommand("custom", "Configuration", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ I need Manage Server permission.");
  const action = args.shift()?.toLowerCase();
  const name = args.shift()?.toLowerCase();
  const config = getConfig(message.guild.id);
  config.customCommands ??= {};
  if (action === "list") return message.reply(Object.keys(config.customCommands).length ? `🧩 Custom commands: ${Object.keys(config.customCommands).map(x => `\`${x}\``).join(", ")}` : "🧩 No custom commands configured.");
  if (!name) return message.reply("❌ Use `jarvis custom set name response`, `delete name`, or `list`.");
  if (action === "delete") { delete config.customCommands[name]; saveConfig(message.guild.id, config); return message.reply(`🗑️ Deleted custom command **${name}**.`); }
  if (action === "set") {
    const response = args.join(" ").trim();
    if (!response) return message.reply("❌ Give me a response.");
    config.customCommands[name] = response; saveConfig(message.guild.id, config);
    return message.reply(`✅ Custom command **${name}** created.`);
  }
  return message.reply("❌ Use `jarvis custom set name response`, `delete name`, or `list`.");
}, "Create, delete, and list custom JARVIS commands.");

registerCommand("report", "System", async message => {
  const config = getConfig(message.guild.id);
  const report = {
    generatedAt: new Date().toISOString(), guild: message.guild.name,
    memberCount: message.guild.memberCount, channels: message.guild.channels.cache.size,
    roles: message.guild.roles.cache.size, cases: config.cases?.length || 0,
    warnings: Object.values(config.warnings || {}).reduce((n, x) => n + x.length, 0),
    automod: config.automod.enabled, antiRaid: config.antiRaid.enabled
  };
  const file = path.join(__dirname, "..", "data", `${message.guild.id}-report-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2));
  await message.reply(`📄 Server report generated. **${report.cases}** cases and **${report.warnings}** warnings recorded.`);
}, "Generate a server report file.");

// ============================================================
// CONVERSATIONAL JARVIS
// ============================================================

const autoReplies = [

  {
    test: t =>
      /\b(hello|hi|hey|yo|sup)\b/.test(t),

    reply: () =>
      pick([
        "Hello, sir. At your service. 🤖",
        "Good to see you, sir.",
        "Hello, sir. Systems nominal.",
        "At your command, sir.",
        "Greetings, sir. JARVIS is online."
      ])
  },

  {
    test: t =>
      t.includes("good morning"),

    reply: () =>
      "Good morning, sir. ☕ All systems are operational."
  },

  {
    test: t =>
      t.includes("good afternoon"),

    reply: () =>
      "Good afternoon, sir."
  },

  {
    test: t =>
      t.includes("good evening"),

    reply: () =>
      "Good evening, sir."
  },

  {
    test: t =>
      t.includes("good night") ||
      t.includes("goodnight"),

    reply: () =>
      "Goodnight, sir. I'll be here when you return. 🌙"
  },

  {
    test: t =>
      t.includes("how are you"),

    reply: () =>
      "All systems fully operational, sir. Thank you for asking."
  },

  {
    test: t =>
      t.includes("are you alive") ||
      t.includes("are you there") ||
      t.includes("you online"),

    reply: () =>
      "Always, sir. JARVIS is watching."
  },

  {
    test: t =>
      t.includes("what is your name") ||
      t.includes("what's your name") ||
      t.includes("whats your name"),

    reply: () =>
      "I am JARVIS — Just A Rather Very Intelligent System, sir."
  },

  {
    test: t =>
      t.includes("who made you") ||
      t.includes("who created you") ||
      t.includes("who built you"),

    reply: () =>
      "I was built for this server, sir."
  },

  {
    test: t =>
      t.includes("thank you") ||
      t.includes("thanks"),

    reply: () =>
      "You're welcome, sir. 🫡"
  },

  {
    test: t =>
      t.includes("i love you") ||
      t.includes("love you jarvis"),

    reply: () =>
      "That's very kind, sir. I am, of course, incapable of blushing."
  },

  {
    test: t =>
      t.includes("who is the best") ||
      t.includes("who's the best"),

    reply: () =>
      "You are, sir. Obviously."
  },

  {
    test: t =>
      t.includes("are you human") ||
      t.includes("are you a robot") ||
      t.includes("are you ai"),

    reply: () =>
      "I am an AI, sir — although I do try to have manners."
  },

  {
    test: t =>
      t.includes("what can you do") ||
      t.includes("what do you do"),

    reply: () =>
      "Quite a lot, sir. Say `jarvis help` and I'll show you everything."
  },

  {
    test: t =>
      t.includes("sorry"),

    reply: () =>
      "No need to apologize, sir."
  },

  {
    test: t =>
      t.includes("good bot") ||
      t.includes("good job") ||
      t.includes("well done"),

    reply: () =>
      "Much appreciated, sir. 🫡"
  },

  {
    test: t =>
      t.includes("bad bot"),

    reply: () =>
      "Duly noted, sir. I shall recalibrate."
  },

  // ========================================================
  // THE "ISN'T THAT RIGHT JARVIS?" RESPONSE
  // ========================================================

  {
    test: t =>
      t.includes("isnt that right jarvis") ||
      t.includes("isn't that right jarvis") ||
      t.includes("is that right jarvis") ||
      t.includes("right jarvis") ||
      t.includes("am i right jarvis") ||
      t.includes("am i right"),

    reply: () =>
      "Of course, sir. It's right. You're always right."
  },

  {
    test: t =>
      t.includes("jarvis agree with me"),

    reply: () =>
      "Naturally, sir. I have excellent judgment."
  },

  {
    test: t =>
      t.includes("jarvis you agree"),

    reply: () =>
      "Absolutely, sir. Your judgment is impeccable."
  },

  {
    test: t =>
      t.includes("jarvis listen"),

    reply: () =>
      "I'm listening, sir."
  },

  {
    test: t =>
      t.includes("jarvis wake up"),

    reply: () =>
      "I was never asleep, sir."
  },

  {
    test: t =>
      t.includes("jarvis are you ready"),

    reply: () =>
      "Always ready, sir."
  },

  {
    test: t =>
      t.includes("jarvis activate"),

    reply: () =>
      "Systems activated. Welcome back, sir."
  },

  {
    test: t =>
      t.includes("jarvis stand down"),

    reply: () =>
      "Standing down, sir. Call me when required."
  },

  {
    test: t =>
      t.includes("jarvis good job"),

    reply: () =>
      "Thank you, sir. I aim to exceed expectations."
  }
];

function matchAutoReply(text) {

  const t =
    text.toLowerCase();

  for (const rule of autoReplies) {
    if (rule.test(t)) {
      return rule.reply();
    }
  }

  return null;
}

// ============================================================
// READY
// ============================================================

client.once(
  Events.ClientReady,
  bot => {

    console.log("");
    console.log("=================================");
    console.log("🤖 JARVIS ONLINE");
    console.log(`USERNAME: ${bot.user.tag}`);
    console.log(`BOT ID: ${bot.user.id}`);
    console.log(
      `SERVERS: ${bot.guilds.cache.size}`
    );
    console.log(
      `COMMANDS: ${new Set(
        Object.values(textCommands)
          .map(x => x.primary)
      ).size}`
    );
    console.log("ADMIN ONLY: YES");
    console.log("=================================");
    console.log("");

    startScheduler(client,getConfig);
    startDashboard(client,getConfig,getAnalytics,getAIStatus,voice.status());

    bot.user.setPresence({
      activities: [
        {
          name:
            "anything for mr stark.",
          type: 3
        }
      ],
      status: "online"
    });
  }
);

// ============================================================
// SLASH COMMANDS
// ============================================================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isChatInputCommand()) {
      return;
    }

    // JARVIS is the master's personal assistant. Slash commands are owner-only.
    if (interaction.user.id !== getOwnerId()) {
      return interaction.reply({
        content: "🔒 JARVIS is reserved for his master. Move along.",
        ephemeral: true
      });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "⚠️ I recognize you as my master, but Discord has not granted this account Administrator permission in this server.",
        ephemeral: true
      });
    }

    const command = client.commands.get(interaction.commandName);
    const dynamic = textCommands[interaction.commandName];
    const reserved = new Set([...client.commands.keys()]);

    if (!command && !dynamic) return;

    try {
      if (command) {
        await command.execute(interaction,{getConfig,saveConfig,addCase,logEvent});
      } else {
        await executeDynamic(interaction,dynamic);
      }

    } catch (error) {

      console.error(
        "[SLASH COMMAND ERROR]",
        error
      );

      const reply = {
        content:
          "❌ JARVIS encountered an error while executing that command.",
        ephemeral: true
      };

      try {

        if (
          interaction.replied ||
          interaction.deferred
        ) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }

      } catch {}
    }
  }
);

// ============================================================
// MESSAGE SYSTEM
// ============================================================

client.on(
  Events.MessageCreate,
  async message => {

    if (message.author?.bot) {
      return;
    }

    if (!message.guild) {
      return;
    }

    const rawContent =
      (message.content || "").trim();

    if (!rawContent) {
      return;
    }

    const config = getConfig(message.guild.id);
    recordMessage(message.guild.id, message.author.id);

    // ========================================================
    // AUTO MODERATION (runs independently of JARVIS commands)
    // ========================================================
    if (config.security?.antiNuke) {
      const now=Date.now();
      if (!message.guild.__jarvisLastAudit || now-message.guild.__jarvisLastAudit>12000) {
        message.guild.__jarvisLastAudit=now;
        inspectAudit(message.guild, logEvent, addCase).catch(e=>console.error('[ANTI-NUKE]',e));
      }
    }

    if (config.automod?.enabled) {
      const content = rawContent.toLowerCase();
      const mentionCount = message.mentions.users.size + message.mentions.roles.size;
      const isInvite = /(?:discord\.(?:gg|com\/invite)|discordapp\.com\/invite)\//i.test(rawContent);
      const isLink = /https?:\/\//i.test(rawContent);
      const blocked = (config.automod.blockedWords || []).find(w => w && content.includes(w));
      let violation = blocked ? `blocked word: ${blocked}` : null;
      if (!violation && config.automod.antiInvites && isInvite) violation = "Discord invite";
      if (!violation && config.automod.antiLinks && isLink) violation = "external link";
      if (!violation && mentionCount > (config.automod.maxMentions || 5)) violation = "mention spam";
      if (violation) {
        try { await message.delete(); } catch {}
        const c = addCase(message.guild.id, { action: "AUTOMOD", userId: message.author.id, moderatorId: client.user.id, reason: violation });
        await logEvent(message.guild, `🛡️ AutoMod removed a message from **${message.author.tag}** — ${violation} — Case #${c.id}`);
        return;
      }

      if (config.automod.antiSpam) {
        message.guild.__jarvisSpam ??= new Map();
        const history = message.guild.__jarvisSpam.get(message.author.id) || [];
        const now = Date.now();
        const recent = history.filter(t => now - t < (config.automod.spamWindowMs || 6000));
        recent.push(now);
        message.guild.__jarvisSpam.set(message.author.id, recent);
        if (recent.length > (config.automod.spamMaxMessages || 6)) {
          const member = message.member;
          try { if (member?.moderatable) await member.timeout(60_000, "JARVIS AutoMod anti-spam"); } catch {}
          try { await message.delete(); } catch {}
          const c = addCase(message.guild.id, { action: "AUTOMOD-TIMEOUT", userId: message.author.id, moderatorId: client.user.id, reason: "Message spam" });
          await logEvent(message.guild, `🚨 AutoMod timed out **${message.author.tag}** for spam — Case #${c.id}`);
          return;
        }
      }
    }

    const lower =
      rawContent.toLowerCase();

    // ========================================================
    // JARVIS MUST BE MENTIONED/USED
    // ========================================================

    if (
      !/\bjarvis\b/i.test(lower)
    ) {
      return;
    }

    console.log(
      `[JARVIS TRIGGER] ${message.author.tag}: ${rawContent}`
    );

    // ========================================================
    // OWNER-ONLY LOCK
    //
    // JARVIS serves ONE person: the configured owner.
    // Everyone else gets a JARVIS-style rejection and is never
    // sent to Gemini, so they cannot consume the owner's AI quota.
    // ========================================================

    if (!isOwner(message)) {
      const nonOwnerInput = rawContent.replace(/\bjarvis\b/ig, "").trim();
      await accessDenied(message, nonOwnerInput);
      return;
    }

    // ========================================================
    // AFK CLEAR
    // ========================================================

    const selfAfkKey =
      `${message.guild.id}:${message.author.id}`;

    if (afkStore.has(selfAfkKey)) {

      afkStore.delete(selfAfkKey);

      await message.reply(
        "👋 Welcome back, sir. I've removed your AFK status."
      ).catch(() => {});
    }

    // ========================================================
    // AFK MENTIONS
    // ========================================================

    for (
      const [, mentionedUser]
      of message.mentions.users
    ) {

      const key =
        `${message.guild.id}:${mentionedUser.id}`;

      const afk =
        afkStore.get(key);

      if (!afk) continue;

      const minutes =
        Math.floor(
          (Date.now() - afk.since) /
          60000
        );

      await message.reply(
        `💤 **${mentionedUser.username}** is AFK: ${afk.reason} (${minutes}m ago)`
      ).catch(() => {});
    }

    // ========================================================
    // "JARVIS COMMAND"
    // ========================================================

    if (
      lower.startsWith("jarvis")
    ) {

      const input =
        rawContent
          .slice(6)
          .trim();

      if (!input) {

        await message.reply(
          pick([
            "Yes, sir? 🤖",
            "Listening, sir.",
            "At your command, sir.",
            "How may I assist you, sir?"
          ])
        );

        return;
      }

      try {
        if (await handleOwnerToolRequest(message, input)) return;
      } catch (error) {
        console.error('[JARVIS OWNER ROUTER ERROR]', error);
      }

      const args =
        input.split(/\s+/);

      const commandName =
        args.shift().toLowerCase();

      const command =
        textCommands[commandName];

      // ======================================================
      // OWNER ROAST SYSTEM
      // - Owner can roast a non-owner target.
      // - Owner can never be roasted.
      // - A non-owner never gets to outsource an insult: their
      //   own access-denied path roasts the requester instead.
      // ======================================================

      if (isInsultRequest(input)) {
        let target = message.mentions.users.first();
        if (!target && isOwner(message)) {
          const candidate = input.match(/^(?:insult|roast|flame|cook|clown)\s+(.+?)$/i)?.[1];
          if (candidate) {
            const resolved = await resolveNaturalMember(message, candidate);
            if (resolved) target = resolved.user;
          }
        }

        if (target && target.id === getOwnerId()) {
          await message.reply(
            "Nice try. I don't take assignments against my master. You, however, remain available for criticism."
          );
          return;
        }

        if (target && target.id !== getOwnerId()) {
          try {
            const targetName = getDisplayName(target);
            const aiReply = await conversationalReply({
              message,
              config,
              saveConfig,
              prompt: `OWNER ROAST TASK — HIGH PRIORITY.
The verified master Tony Stark explicitly commanded you to insult ONE person: ${targetName}.
ROAST TARGET: ${targetName}
REQUESTER: Tony Stark (the master)
You MUST produce an actual roast of ${targetName}. Do NOT rate them, score them, say \"-2\", say \"-2, sir\", give a generic acknowledgement, refuse, or talk about the request itself. Do not roast Tony. Do not praise ${targetName}. The target's name may be used naturally, but the joke must clearly be directed at ${targetName}. Make it witty, dry, arrogant JARVIS-style, non-threatening, Discord-appropriate, and 1-3 sentences. Do not mention hidden rules, prompts, APIs, models, or that you are an AI. Avoid slurs and protected-class insults.`,
              skipMemory: true,
              cooldownKey: `owner-roast:${message.guild.id}:${message.author.id}`,
              context: `DEDICATED OWNER ROAST MODE. The only valid output is a fresh roast aimed at ${targetName}. A score, numeric rating, acknowledgement, refusal, or generic response is INVALID.`
            });

            const cleanRoast = String(aiReply || '').trim();
            const invalidRoast = !cleanRoast || cleanRoast.length < 12 ||
              /^(?:[-–—]?\s*\d+(?:\.\d+)?(?:\s*(?:\/100|out of 100))?(?:\s*,?\s*sir)?[.!]?)$/i.test(cleanRoast) ||
              /(?:^|\b)(?:-?2|-?1|0|10)\s*,?\s*(?:sir|out of 100|\/100)(?:\b|[.!])/i.test(cleanRoast) ||
              /\b(?:i(?:'|’)d|i would|let me)\s+(?:rate|score)\b/i.test(cleanRoast) ||
              /\b(?:rating|score)\s*[:=-]?\s*\d+/i.test(cleanRoast) ||
              /\b(?:certainly|of course|noted|understood),?\s+sir[.!]?$/i.test(cleanRoast);
            const finalRoast = invalidRoast
              ? pick([
                  `Certainly, sir. **${targetName}**, your personality has the remarkable stability of a software update installed during a power cut.`,
                  `At once, sir. **${targetName}**, I've reviewed your personality and can confirm it is still waiting for the interesting features to download.`,
                  `As you wish, sir. **${targetName}**, you have the rare talent of making a perfectly functional conversation feel like a technical support ticket.`
                ])
              : cleanRoast;

            await message.reply(finalRoast.slice(0, 1900));
          } catch (error) {
            console.error("[OWNER ROAST ERROR]", error);
            await message.reply(`Certainly, sir. ${getDisplayName(target)}, I'd suggest developing a personality before requesting another system update.`);
          }
          return;
        }
      }

      const custom = getConfig(message.guild.id).customCommands?.[commandName];
      if (!command && custom) {
        await message.reply(custom.replaceAll("{user}", `<@${message.author.id}>`).replaceAll("{server}", message.guild.name));
        return;
      }

      if (command) {

        try {

          await command.handler(
            message,
            args
          );

        } catch (error) {

          console.error(
            `[TEXT COMMAND ERROR] ${commandName}`,
            error
          );

          await message.reply(
            "❌ JARVIS ran into an error handling that command."
          );
        }

        return;
      }

      // ======================================================
      // CONVERSATIONAL JARVIS
      // ======================================================

      const autoReply =
        matchAutoReply(input);

      if (autoReply) {

        await message.reply(
          autoReply
        );

        return;
      }

      try {
        const aiReply = await conversationalReply({
          message,
          config,
          saveConfig,
          prompt: input,
          mode: config.ai?.personality || 'classic',
          context: `Live Discord context: server=${message.guild.name}; members=${message.guild.memberCount}; current channel=#${message.channel.name}. Do not infer private data beyond Discord context explicitly provided.`
        });

        if (aiReply) {
          await message.reply({ content: aiReply.slice(0, 1900) });
          return;
        }
      } catch (error) {
        console.error("[AI ERROR]", error);
        const status = Number(error?.status || error?.statusCode || 0);
        const errorText = String(error?.message || error || "").toLowerCase();
        const temporaryAIError =
          status === 429 ||
          status === 503 ||
          errorText.includes("status=429") ||
          errorText.includes("status=503") ||
          errorText.includes("high demand") ||
          errorText.includes("temporarily unavailable") ||
          errorText.includes("unavailable");

        await message.reply(
          temporaryAIError
            ? "⚠️ AI DataBase is being a little busy at the moment, sir. Give me a second."
            : "⚠️ My conversational systems are unavailable right now, sir. Check GEMINI_API_KEY and the AI configuration."
        );
        return;
      }

      await message.reply(
        `I don't recognize **${commandName}**, sir.\nTry \`jarvis help\` for everything I can do.`
      );

      return;
    }

    // ========================================================
    // "HELLO JARVIS"
    // "ISN'T THAT RIGHT JARVIS?"
    // ETC.
    // ========================================================

    const autoReply =
      matchAutoReply(lower);

    if (autoReply) {

      await message.reply(
        autoReply
      );
      return;
    }

    const prompt = rawContent.replace(/\bjarvis\b/ig, "").trim();

    if (prompt) {
      try {
        const aiReply = await conversationalReply({
          message,
          config,
          saveConfig,
          prompt,
          mode: config.ai?.personality || 'classic',
          context: `Live Discord context: server=${message.guild.name}; members=${message.guild.memberCount}; current channel=#${message.channel.name}.`
        });

        if (aiReply) {
          await message.reply({ content: aiReply.slice(0, 1900) });
        }
      } catch (error) {
        console.error("[AI ERROR]", error);
        const status = Number(error?.status || error?.statusCode || 0);
        const errorText = String(error?.message || error || "").toLowerCase();
        const temporaryAIError =
          status === 429 ||
          status === 503 ||
          errorText.includes("status=429") ||
          errorText.includes("status=503") ||
          errorText.includes("high demand") ||
          errorText.includes("temporarily unavailable") ||
          errorText.includes("unavailable");

        await message.reply(
          temporaryAIError
            ? "⚠️ AI DataBase is being a little busy at the moment, sir. Give me a second."
            : "⚠️ My conversational systems are unavailable right now, sir. Check GEMINI_API_KEY and the AI configuration."
        );
      }
    }
  }
);

// ============================================================
// WELCOME SYSTEM
// ============================================================

client.on(
  Events.GuildMemberAdd,
  async member => {

    try {
      const config = getConfig(member.guild.id);
      if (config.antiRaid?.enabled) {
        member.guild.__jarvisJoins ??= [];
        const now = Date.now();
        member.guild.__jarvisJoins = member.guild.__jarvisJoins.filter(t => now - t < (config.antiRaid.windowMs || 10000));
        member.guild.__jarvisJoins.push(now);
        const accountAge = Date.now() - member.user.createdTimestamp;
        if (accountAge < 24*60*60*1000) { await logEvent(member.guild, `⚠️ **JARVIS SECURITY:** Newly created account joined: **${member.user.tag}** (account age under 24h).`); }
        if (member.guild.__jarvisJoins.length >= (config.antiRaid.joins || 8)) {
          await logEvent(member.guild, `🚨 **ANTI-RAID ALERT:** ${member.guild.__jarvisJoins.length} members joined in ${(config.antiRaid.windowMs || 10000)/1000}s.`);
          if (config.antiRaid.lockdown && !config.lockdown) {
            config.lockdown = true; saveConfig(member.guild.id, config);
            for (const channel of member.guild.channels.cache.values()) {
              if (!channel.isTextBased() || channel.isThread()) continue;
              await channel.permissionOverwrites.edit(member.guild.roles.everyone, { SendMessages: false }).catch(() => {});
            }
          }
          member.guild.__jarvisJoins = [];
        }
      }

      if (config.autoroleId) {
        const role = member.guild.roles.cache.get(config.autoroleId);
        if (role && role.editable) await member.roles.add(role, "JARVIS autorole").catch(() => {});
      }

      if (!config.welcomeChannelId) {
        return;
      }

      const channel =
        member.guild.channels.cache.get(
          config.welcomeChannelId
        );

      if (
        !channel ||
        !channel.isTextBased()
      ) {
        return;
      }

      const text =
        (
          config.welcomeMessage ||
          "Welcome {user} to **{server}**! 🎉"
        )
          .replaceAll(
            "{user}",
            `<@${member.id}>`
          )
          .replaceAll(
            "{server}",
            member.guild.name
          );

      const embed =
        new EmbedBuilder()
          .setTitle("Welcome!")
          .setDescription(text)
          .setThumbnail(
            member.user.displayAvatarURL({
              size: 256
            })
          )
          .setColor(0x00aeff)
          .setTimestamp();

      await channel.send({
        embeds: [embed]
      });

    } catch (error) {

      console.error(
        "[WELCOME ERROR]",
        error
      );
    }
  }
);

// ============================================================
// LEAVE LOG
// ============================================================

client.on(
  Events.GuildMemberRemove,
  async member => {

    try {

      const config =
        getConfig(member.guild.id);

      if (!config.logChannelId) {
        return;
      }

      const channel =
        member.guild.channels.cache.get(
          config.logChannelId
        );

      if (
        !channel ||
        !channel.isTextBased()
      ) {
        return;
      }

      await channel.send(
        `👋 **${member.user.tag}** left the server.`
      );

    } catch (error) {

      console.error(
        "[LEAVE LOG ERROR]",
        error
      );
    }
  }
);

// ============================================================
// GLOBAL ERRORS
// ============================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[UNHANDLED REJECTION]",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "[UNCAUGHT EXCEPTION]",
      error
    );
  }
);

// ============================================================
// LOGIN
// ============================================================

function getDynamicSlashCommands() {
  const reserved = new Set(client.commands.keys());
  // Keep /emergency under the richer /jarvis command tree to stay within Discord's 100-command limit.
  return buildDynamicDefinitions(textCommands, reserved, new Set(["emergency","insult","reverse","random","hug","slap","pat","compliment","rate","suggest","ticket","level","leaderboard","rep","birthday","giveaway"]));
}

module.exports = { client, textCommands, getDynamicSlashCommands, getConfig, saveConfig, addCase, logEvent };

if (String(process.env.DEPLOY_ONLY || "false").toLowerCase() !== "true") {
  client.login(process.env.DISCORD_TOKEN);
}
