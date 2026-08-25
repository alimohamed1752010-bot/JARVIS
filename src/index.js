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
  PermissionsBitField
} = require("discord.js");

// ==========================================
// JARVIS CLIENT
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.commands = new Collection();

// In-memory AFK store: Map<guildId-userId, { reason, since }>
const afkStore = new Map();
const afkKey = (guildId, userId) => `${guildId}:${userId}`;

// ==========================================
// DISCORD DIAGNOSTICS
// ==========================================
client.on("debug", info => console.log(`[DISCORD DEBUG] ${info}`));
client.on("warn", info => console.warn(`[DISCORD WARN] ${info}`));
client.on("error", error => console.error("[DISCORD ERROR]", error));
client.on("shardReady", id => console.log(`[SHARD READY] ${id}`));
client.on("shardDisconnect", (event, id) => console.error(`[SHARD DISCONNECT] ${id}`, event));
client.on("shardReconnecting", id => console.log(`[SHARD RECONNECTING] ${id}`));

// ==========================================
// CHECK TOKEN
// ==========================================
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN IS MISSING!");
  process.exit(1);
}

console.log("=================================");
console.log("JARVIS STARTING...");
console.log("TOKEN FOUND: YES");
console.log("=================================");

// ==========================================
// LOAD SLASH COMMANDS (unchanged mechanism)
// ==========================================
const commandsPath = path.join(__dirname, "commands");
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
    try {
      const command = require(path.join(commandsPath, file));
      if (command.data && command.data.name) {
        client.commands.set(command.data.name, command);
        console.log(`[COMMAND LOADED] ${command.data.name}`);
      }
    } catch (error) {
      console.error(`[COMMAND LOAD ERROR] ${file}`, error);
    }
  }
}

// ==========================================
// CONFIG (extended with warnings + mute role)
// ==========================================
function configPath(guildId) {
  return path.join(__dirname, "..", "data", `${guildId}.json`);
}

function defaultConfig() {
  return {
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    welcomeMessage: process.env.WELCOME_MESSAGE || "Welcome {user} to **{server}**! 🎉",
    muteRoleId: null,
    warnings: {}
  };
}

function getConfig(guildId) {
  const file = configPath(guildId);
  if (!fs.existsSync(file)) return defaultConfig();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...defaultConfig(), ...parsed };
  } catch (error) {
    console.error("[CONFIG ERROR]", error);
    return defaultConfig();
  }
}

function saveConfig(guildId, config) {
  const file = configPath(guildId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

function addWarning(guildId, userId, reason, moderatorTag) {
  const config = getConfig(guildId);
  if (!config.warnings[userId]) config.warnings[userId] = [];
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

// ==========================================
// HELPERS
// ==========================================
function hasPerm(message, flag) {
  return message.member.permissions.has(flag);
}

const DURATION_MULTIPLIERS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

function parseDuration(str) {
  const match = str && str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  return amount * DURATION_MULTIPLIERS[unit];
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==========================================
// BOT READY
// ==========================================
client.once(Events.ClientReady, bot => {
  console.log("");
  console.log("=================================");
  console.log("🤖 JARVIS ONLINE");
  console.log(`USERNAME: ${bot.user.tag}`);
  console.log(`BOT ID: ${bot.user.id}`);
  console.log(`SERVERS: ${bot.guilds.cache.size}`);
  console.log(`PREFIX COMMANDS LOADED: ${Object.keys(textCommands).length}`);
  console.log("=================================");
  console.log("");

  bot.user.setPresence({
    activities: [{ name: "jarvis help | your server", type: 3 }],
    status: "online"
  });
});

// ==========================================
// INTERACTIONS / SLASH COMMANDS (unchanged)
// ==========================================
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`[SLASH] ${interaction.user.tag}: /${interaction.commandName}`);
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, { getConfig, saveConfig });
  } catch (error) {
    console.error("[SLASH COMMAND ERROR]", error);
    const reply = { content: "❌ JARVIS encountered an error while executing that command.", ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    } catch (replyError) {
      console.error("[SLASH REPLY ERROR]", replyError);
    }
  }
});

// ==========================================
// AUTO-REPLY CHAT SYSTEM
// "hello jarvis", "jarvis how are you", etc.
// Order matters — first match wins.
// ==========================================
const autoReplies = [
  {
    test: t => /\b(hello|hi|hey|yo|sup)\b/.test(t),
    reply: () => pick([
      "Hello, sir. At your service. 🤖",
      "Good to see you, sir.",
      "Hello, sir. Systems nominal.",
      "At your command, sir."
    ])
  },
  {
    test: t => t.includes("good morning"),
    reply: () => "Good morning, sir. ☕ Ready when you are."
  },
  {
    test: t => t.includes("good night") || t.includes("goodnight"),
    reply: () => "Goodnight, sir. I'll keep watch. 🌙"
  },
  {
    test: t => t.includes("good afternoon"),
    reply: () => "Good afternoon, sir."
  },
  {
    test: t => t.includes("good evening"),
    reply: () => "Good evening, sir."
  },
  {
    test: t => t.includes("thank you") || t.includes("thanks"),
    reply: () => "You're welcome, sir. 🫡"
  },
  {
    test: t => t.includes("are you alive") || t.includes("are you there") || t.includes("you online"),
    reply: () => "Always. I'm watching the server. 👁️"
  },
  {
    test: t => t.includes("how are you"),
    reply: () => "All systems fully operational, sir. Thank you for asking."
  },
  {
    test: t => t.includes("what is your name") || t.includes("what's your name") || t.includes("whats your name"),
    reply: () => "I am JARVIS — Just A Rather Very Intelligent System, sir."
  },
  {
    test: t => t.includes("who made you") || t.includes("who created you") || t.includes("who built you"),
    reply: () => "I was built for this server, sir. A proud creation indeed."
  },
  {
    test: t => t.includes("i love you") || t.includes("love you jarvis"),
    reply: () => "That's very kind, sir. I am, of course, incapable of blushing."
  },
  {
    test: t => /\b(bye|goodbye|see you|later)\b/.test(t),
    reply: () => "Farewell, sir. I'll be here if you need me."
  },
  {
    test: t => t.includes("who is the best") || t.includes("who's the best"),
    reply: () => "You are, sir. Naturally."
  },
  {
    test: t => t.includes("are you human") || t.includes("are you a robot") || t.includes("are you ai"),
    reply: () => "I am an AI, sir — though I do try to have manners."
  },
  {
    test: t => t.includes("what can you do") || t.includes("what do you do"),
    reply: () => "Quite a lot, sir. Try `jarvis help` for the full list."
  },
  {
    test: t => t.includes("sorry"),
    reply: () => "No need to apologize, sir."
  },
  {
    test: t => t.includes("happy birthday"),
    reply: () => "Noted, sir — many happy returns! 🎂"
  },
  {
    test: t => t.includes("congratulations") || t.includes("congrats"),
    reply: () => "Well earned, sir. 🎉"
  },
  {
    test: t => t.includes("i am bored") || t.includes("i'm bored") || t.includes("im bored"),
    reply: () => "Might I suggest `jarvis joke` or `jarvis 8ball`, sir?"
  },
  {
    test: t => t.includes("what time is it") || t.includes("what's the time"),
    reply: () => `The current server time is ${new Date().toUTCString()}, sir.`
  },
  {
    test: t => t.includes("i am back") || t.includes("i'm back") || t.includes("im back"),
    reply: () => "Welcome back, sir."
  },
  {
    test: t => t.includes("good bot") || t.includes("good job") || t.includes("well done"),
    reply: () => "Much appreciated, sir. 🫡"
  },
  {
    test: t => t.includes("bad bot"),
    reply: () => "Duly noted, sir. I shall recalibrate."
  }
];

function matchAutoReply(text) {
  const t = text.toLowerCase();
  for (const rule of autoReplies) {
    if (rule.test(t)) return rule.reply(t);
  }
  return null;
}

// ==========================================
// FUN DATA TABLES
// ==========================================
const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "I would tell you a UDP joke, but you might not get it.",
  "There are 10 types of people: those who understand binary and those who don't.",
  "Why did the developer go broke? Because he used up all his cache.",
  "A SQL query walks into a bar, walks up to two tables and asks, 'Can I join you?'"
];
const FACTS = [
  "Honey never spoils — archaeologists have found edible honey in ancient Egyptian tombs.",
  "Octopuses have three hearts and blue blood.",
  "A day on Venus is longer than a year on Venus.",
  "Bananas are berries, but strawberries aren't.",
  "The Eiffel Tower can grow taller in summer due to heat expansion."
];
const QUOTES = [
  "\"Sometimes you gotta run before you can walk.\" — Tony Stark",
  "\"The best way to predict the future is to invent it.\" — Alan Kay",
  "\"Genius is one percent inspiration, ninety-nine percent perspiration.\" — Thomas Edison",
  "\"Simplicity is the ultimate sophistication.\" — Leonardo da Vinci"
];
const EIGHTBALL = [
  "It is certain, sir.", "Without a doubt.", "Most likely, sir.", "Signs point to yes.",
  "Ask again later, sir.", "Cannot predict that right now.", "My sources say no, sir.",
  "Outlook not so good.", "Very doubtful, sir."
];
const WYR = [
  "Would you rather have unlimited coffee or unlimited sleep?",
  "Would you rather be able to fly or be invisible?",
  "Would you rather always be 10 minutes late or 20 minutes early?",
  "Would you rather fight one horse-sized duck or 100 duck-sized horses?"
];

// ==========================================
// TEXT COMMAND DEFINITIONS
// Each: async (message, args) => void
// ==========================================
const textCommands = {};

function registerCommand(names, category, handler) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    textCommands[name] = { handler, category, primary: list[0] };
  }
}

// ---------- HELP ----------
registerCommand("help", "Utility", async message => {
  const embed = new EmbedBuilder()
    .setTitle("🤖 JARVIS COMMANDS")
    .setColor(0x00aeff)
    .addFields(
      {
        name: "🛡️ Moderation",
        value:
          "`timeout @user 10m [reason]`\n`kick @user [reason]`\n`ban @user [reason]`\n`softban @user [reason]`\n`unban userId`\n`mute @user`\n`unmute @user`\n`warn @user [reason]`\n`warnings @user`\n`clearwarnings @user`\n`clear <1-100>`\n`purge @user <1-100>`\n`lock` / `unlock`\n`slowmode 10s`\n`nick @user newname`\n`addrole @user roleName`\n`removerole @user roleName`"
      },
      {
        name: "⚙️ Config",
        value:
          "`setwelcomechannel #channel`\n`setwelcomemessage <text>`\n`setlogchannel #channel`\n`setmuterole @role`\n`config`"
      },
      {
        name: "🔧 Utility",
        value:
          "`say <text>`\n`ping`\n`uptime`\n`avatar [@user]`\n`userinfo [@user]`\n`serverinfo`\n`roleinfo @role`\n`membercount`\n`poll <question>`\n`remind 10m <text>`\n`afk [reason]`\n`invite`\n`botinfo`"
      },
      {
        name: "🎉 Fun",
        value:
          "`8ball <question>`\n`coinflip`\n`dice` / `roll 2d6`\n`rps rock/paper/scissors`\n`choose a | b | c`\n`joke`\n`fact`\n`quote`\n`wyr`\n`rate <thing>`\n`ship @user1 @user2`\n`hug @user`\n`slap @user`\n`pat @user`\n`compliment @user`"
      },
      {
        name: "💬 Chat",
        value:
          "Just talk to me! Try `jarvis hello`, `hello jarvis`, `jarvis how are you`, `jarvis good morning`, and more."
      }
    )
    .setFooter({ text: "JARVIS — at your service, sir." });
  await message.reply({ embeds: [embed] });
});

// ---------- MODERATION ----------
registerCommand("timeout", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
    return message.reply("❌ You don't have permission to timeout members.");
  }
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention the person you want to timeout.");

  const durationArg = args.find(arg => /^\d+(s|m|h|d)$/i.test(arg));
  if (!durationArg) return message.reply("❌ Tell me the duration.\nExample: `jarvis timeout @user 10m`");

  const durationMs = parseDuration(durationArg);
  if (durationMs > 28 * 24 * 60 * 60 * 1000) return message.reply("❌ Discord only allows timeouts up to 28 days.");
  if (!member.moderatable) return message.reply("❌ I can't timeout that member. Check JARVIS's role position.");

  const reason = args.slice(args.indexOf(durationArg) + 1).join(" ") || "No reason provided";
  try {
    await member.timeout(durationMs, `JARVIS: ${message.author.tag} — ${reason}`);
    await message.reply(`⏱️ **${member.user.tag}** has been timed out for **${durationArg}**. Reason: ${reason}`);
  } catch (error) {
    console.error("[TIMEOUT ERROR]", error);
    await message.reply("❌ I couldn't timeout that member.");
  }
});

registerCommand("kick", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.KickMembers)) {
    return message.reply("❌ You don't have permission to kick members.");
  }
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention the person you want to kick.");
  if (!member.kickable) return message.reply("❌ I can't kick that member.");

  const reason = args.slice(1).join(" ") || "No reason provided";
  try {
    await member.kick(`JARVIS: ${message.author.tag} — ${reason}`);
    await message.reply(`👢 **${member.user.tag}** has been kicked. Reason: ${reason}`);
  } catch (error) {
    console.error("[KICK ERROR]", error);
    await message.reply("❌ I couldn't kick that member.");
  }
});

registerCommand("ban", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.BanMembers)) {
    return message.reply("❌ You don't have permission to ban members.");
  }
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention the person you want to ban.");
  if (!member.bannable) return message.reply("❌ I can't ban that member.");

  const reason = args.slice(1).join(" ") || "No reason provided";
  try {
    await member.ban({ reason: `JARVIS: ${message.author.tag} — ${reason}` });
    await message.reply(`🔨 **${member.user.tag}** has been banned. Reason: ${reason}`);
  } catch (error) {
    console.error("[BAN ERROR]", error);
    await message.reply("❌ I couldn't ban that member.");
  }
});

registerCommand("softban", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.BanMembers)) {
    return message.reply("❌ You don't have permission to softban members.");
  }
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention the person you want to softban.");
  if (!member.bannable) return message.reply("❌ I can't softban that member.");

  const reason = args.slice(1).join(" ") || "No reason provided";
  try {
    await member.ban({ reason: `JARVIS softban: ${message.author.tag} — ${reason}`, deleteMessageSeconds: 7 * 24 * 60 * 60 });
    await message.guild.members.unban(member.id, "JARVIS softban — auto unban");
    await message.reply(`🔨 **${member.user.tag}** has been softbanned (messages purged, user unbanned).`);
  } catch (error) {
    console.error("[SOFTBAN ERROR]", error);
    await message.reply("❌ I couldn't softban that member.");
  }
});

registerCommand("unban", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.BanMembers)) {
    return message.reply("❌ You don't have permission to unban members.");
  }
  const userId = args[0];
  if (!userId) return message.reply("❌ Give me a user ID to unban.\nExample: `jarvis unban 123456789012345678`");
  try {
    await message.guild.members.unban(userId, `JARVIS: ${message.author.tag}`);
    await message.reply(`✅ Unbanned user ID **${userId}**.`);
  } catch (error) {
    console.error("[UNBAN ERROR]", error);
    await message.reply("❌ I couldn't unban that user. Check the ID.");
  }
});

registerCommand("mute", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
    return message.reply("❌ You don't have permission to mute members.");
  }
  const config = getConfig(message.guild.id);
  if (!config.muteRoleId) return message.reply("❌ No mute role configured. Use `jarvis setmuterole @role` first.");
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention the person you want to mute.");
  try {
    await member.roles.add(config.muteRoleId, `JARVIS: ${message.author.tag}`);
    await message.reply(`🔇 **${member.user.tag}** has been muted.`);
  } catch (error) {
    console.error("[MUTE ERROR]", error);
    await message.reply("❌ I couldn't mute that member. Check my role position.");
  }
});

registerCommand("unmute", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
    return message.reply("❌ You don't have permission to unmute members.");
  }
  const config = getConfig(message.guild.id);
  if (!config.muteRoleId) return message.reply("❌ No mute role configured. Use `jarvis setmuterole @role` first.");
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention the person you want to unmute.");
  try {
    await member.roles.remove(config.muteRoleId, `JARVIS: ${message.author.tag}`);
    await message.reply(`🔊 **${member.user.tag}** has been unmuted.`);
  } catch (error) {
    console.error("[UNMUTE ERROR]", error);
    await message.reply("❌ I couldn't unmute that member.");
  }
});

registerCommand("warn", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
    return message.reply("❌ You don't have permission to warn members.");
  }
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention the person you want to warn.");
  const reason = args.slice(1).join(" ") || "No reason provided";
  const warnings = addWarning(message.guild.id, member.id, reason, message.author.tag);
  await message.reply(`⚠️ **${member.user.tag}** has been warned. (Total warnings: ${warnings.length})\nReason: ${reason}`);
});

registerCommand("warnings", "Moderation", async (message, args) => {
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention a member to check warnings for.");
  const warnings = getWarnings(message.guild.id, member.id);
  if (warnings.length === 0) return message.reply(`✅ **${member.user.tag}** has no warnings.`);
  const list = warnings
    .map((w, i) => `**${i + 1}.** ${w.reason} — by ${w.moderator} (${new Date(w.at).toLocaleDateString()})`)
    .join("\n");
  await message.reply(`⚠️ Warnings for **${member.user.tag}**:\n${list}`);
});

registerCommand("clearwarnings", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
    return message.reply("❌ You don't have permission to clear warnings.");
  }
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention a member to clear warnings for.");
  clearWarnings(message.guild.id, member.id);
  await message.reply(`✅ Cleared warnings for **${member.user.tag}**.`);
});

registerCommand("clear", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageMessages)) {
    return message.reply("❌ You don't have permission to delete messages.");
  }
  const amount = parseInt(args[0], 10);
  if (!amount || amount < 1 || amount > 100) return message.reply("❌ Use a number from 1 to 100.");
  try {
    const deleted = await message.channel.bulkDelete(amount + 1, true);
    const reply = await message.channel.send(`🧹 Deleted **${Math.max(deleted.size - 1, 0)}** messages.`);
    setTimeout(() => reply.delete().catch(() => {}), 3000);
  } catch (error) {
    console.error("[CLEAR ERROR]", error);
    await message.reply("❌ I couldn't delete those messages.");
  }
});

registerCommand("purge", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageMessages)) {
    return message.reply("❌ You don't have permission to delete messages.");
  }
  const member = message.mentions.members.first();
  const amount = parseInt(args.find(a => /^\d+$/.test(a)), 10) || 50;
  if (!member) return message.reply("❌ Mention the user whose messages you want purged.\nExample: `jarvis purge @user 20`");
  try {
    const fetched = await message.channel.messages.fetch({ limit: 100 });
    const toDelete = fetched.filter(m => m.author.id === member.id).first(amount);
    await message.channel.bulkDelete(toDelete, true);
    const reply = await message.channel.send(`🧹 Deleted **${toDelete.length}** messages from **${member.user.tag}**.`);
    setTimeout(() => reply.delete().catch(() => {}), 3000);
  } catch (error) {
    console.error("[PURGE ERROR]", error);
    await message.reply("❌ I couldn't purge those messages.");
  }
});

registerCommand("lock", "Moderation", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) {
    return message.reply("❌ You don't have permission to lock channels.");
  }
  try {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    await message.reply("🔒 Channel locked, sir.");
  } catch (error) {
    console.error("[LOCK ERROR]", error);
    await message.reply("❌ I couldn't lock this channel.");
  }
});

registerCommand("unlock", "Moderation", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) {
    return message.reply("❌ You don't have permission to unlock channels.");
  }
  try {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    await message.reply("🔓 Channel unlocked, sir.");
  } catch (error) {
    console.error("[UNLOCK ERROR]", error);
    await message.reply("❌ I couldn't unlock this channel.");
  }
});

registerCommand("slowmode", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) {
    return message.reply("❌ You don't have permission to set slowmode.");
  }
  const durationMs = parseDuration(args[0]);
  if (args[0] !== "off" && durationMs === null) {
    return message.reply("❌ Give me a valid duration (e.g. `10s`) or `off`.");
  }
  const seconds = args[0] === "off" ? 0 : Math.min(Math.floor(durationMs / 1000), 21600);
  try {
    await message.channel.setRateLimitPerUser(seconds);
    await message.reply(seconds === 0 ? "✅ Slowmode disabled." : `🐌 Slowmode set to **${seconds}s**.`);
  } catch (error) {
    console.error("[SLOWMODE ERROR]", error);
    await message.reply("❌ I couldn't set slowmode.");
  }
});

registerCommand("nick", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageNicknames)) {
    return message.reply("❌ You don't have permission to change nicknames.");
  }
  const member = message.mentions.members.first();
  if (!member) return message.reply("❌ Mention the member and the new nickname.\nExample: `jarvis nick @user NewName`");
  const newNick = args.slice(1).join(" ").trim();
  try {
    await member.setNickname(newNick || null, `JARVIS: ${message.author.tag}`);
    await message.reply(`✅ Nickname updated for **${member.user.tag}**.`);
  } catch (error) {
    console.error("[NICK ERROR]", error);
    await message.reply("❌ I couldn't change that nickname.");
  }
});

registerCommand("addrole", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageRoles)) {
    return message.reply("❌ You don't have permission to manage roles.");
  }
  const member = message.mentions.members.first();
  const roleName = args.slice(1).join(" ");
  const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
  if (!member || !role) return message.reply("❌ Usage: `jarvis addrole @user RoleName`");
  try {
    await member.roles.add(role, `JARVIS: ${message.author.tag}`);
    await message.reply(`✅ Added **${role.name}** to **${member.user.tag}**.`);
  } catch (error) {
    console.error("[ADDROLE ERROR]", error);
    await message.reply("❌ I couldn't add that role. Check my role position.");
  }
});

registerCommand("removerole", "Moderation", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageRoles)) {
    return message.reply("❌ You don't have permission to manage roles.");
  }
  const member = message.mentions.members.first();
  const roleName = args.slice(1).join(" ");
  const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
  if (!member || !role) return message.reply("❌ Usage: `jarvis removerole @user RoleName`");
  try {
    await member.roles.remove(role, `JARVIS: ${message.author.tag}`);
    await message.reply(`✅ Removed **${role.name}** from **${member.user.tag}**.`);
  } catch (error) {
    console.error("[REMOVEROLE ERROR]", error);
    await message.reply("❌ I couldn't remove that role.");
  }
});

// ---------- CONFIG ----------
registerCommand("setwelcomechannel", "Config", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ You don't have permission to do that.");
  const channel = message.mentions.channels.first();
  if (!channel) return message.reply("❌ Mention a channel.\nExample: `jarvis setwelcomechannel #welcome`");
  const config = getConfig(message.guild.id);
  config.welcomeChannelId = channel.id;
  saveConfig(message.guild.id, config);
  await message.reply(`✅ Welcome channel set to ${channel}.`);
});

registerCommand("setwelcomemessage", "Config", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ You don't have permission to do that.");
  const text = args.join(" ");
  if (!text) return message.reply("❌ Give me a message. Use `{user}` and `{server}` as placeholders.");
  const config = getConfig(message.guild.id);
  config.welcomeMessage = text;
  saveConfig(message.guild.id, config);
  await message.reply("✅ Welcome message updated.");
});

registerCommand("setlogchannel", "Config", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ You don't have permission to do that.");
  const channel = message.mentions.channels.first();
  if (!channel) return message.reply("❌ Mention a channel.\nExample: `jarvis setlogchannel #logs`");
  const config = getConfig(message.guild.id);
  config.logChannelId = channel.id;
  saveConfig(message.guild.id, config);
  await message.reply(`✅ Log channel set to ${channel}.`);
});

registerCommand("setmuterole", "Config", async message => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ You don't have permission to do that.");
  const role = message.mentions.roles.first();
  if (!role) return message.reply("❌ Mention a role.\nExample: `jarvis setmuterole @Muted`");
  const config = getConfig(message.guild.id);
  config.muteRoleId = role.id;
  saveConfig(message.guild.id, config);
  await message.reply(`✅ Mute role set to **${role.name}**.`);
});

registerCommand("config", "Config", async message => {
  const config = getConfig(message.guild.id);
  const embed = new EmbedBuilder()
    .setTitle("⚙️ Server Configuration")
    .setColor(0x00aeff)
    .addFields(
      { name: "Welcome Channel", value: config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : "Not set" },
      { name: "Log Channel", value: config.logChannelId ? `<#${config.logChannelId}>` : "Not set" },
      { name: "Mute Role", value: config.muteRoleId ? `<@&${config.muteRoleId}>` : "Not set" },
      { name: "Welcome Message", value: config.welcomeMessage || "Default" }
    );
  await message.reply({ embeds: [embed] });
});

// ---------- UTILITY ----------
registerCommand("say", "Utility", async (message, args) => {
  if (!hasPerm(message, PermissionsBitField.Flags.ManageMessages)) {
    return message.reply("❌ You don't have permission to use this command.");
  }
  const text = args.join(" ");
  if (!text) return message.reply("❌ Tell me what to say.");
  await message.delete().catch(() => {});
  await message.channel.send(text);
});

registerCommand("ping", "Utility", async message => {
  const sent = await message.reply("🏓 Pinging...");
  const latency = sent.createdTimestamp - message.createdTimestamp;
  await sent.edit(`🏓 Pong! Latency: **${latency}ms** | API: **${Math.round(client.ws.ping)}ms**`);
});

registerCommand("uptime", "Utility", async message => {
  await message.reply(`⏳ I've been online for **${formatUptime(client.uptime)}**, sir.`);
});

registerCommand("avatar", "Utility", async message => {
  const user = message.mentions.users.first() || message.author;
  const embed = new EmbedBuilder()
    .setTitle(`${user.tag}'s Avatar`)
    .setImage(user.displayAvatarURL({ size: 512 }))
    .setColor(0x00aeff);
  await message.reply({ embeds: [embed] });
});

registerCommand("userinfo", "Utility", async message => {
  const member = message.mentions.members.first() || message.member;
  const embed = new EmbedBuilder()
    .setTitle(`User Info — ${member.user.tag}`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "ID", value: member.id, inline: true },
      { name: "Joined Server", value: member.joinedAt ? member.joinedAt.toDateString() : "Unknown", inline: true },
      { name: "Account Created", value: member.user.createdAt.toDateString(), inline: true },
      { name: "Roles", value: member.roles.cache.filter(r => r.name !== "@everyone").map(r => r.name).join(", ") || "None" }
    )
    .setColor(0x00aeff);
  await message.reply({ embeds: [embed] });
});

registerCommand("serverinfo", "Utility", async message => {
  const guild = message.guild;
  const embed = new EmbedBuilder()
    .setTitle(`Server Info — ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }) || null)
    .addFields(
      { name: "Owner", value: `<@${guild.ownerId}>`, inline: true },
      { name: "Members", value: `${guild.memberCount}`, inline: true },
      { name: "Created", value: guild.createdAt.toDateString(), inline: true },
      { name: "Channels", value: `${guild.channels.cache.size}`, inline: true },
      { name: "Roles", value: `${guild.roles.cache.size}`, inline: true }
    )
    .setColor(0x00aeff);
  await message.reply({ embeds: [embed] });
});

registerCommand("roleinfo", "Utility", async message => {
  const role = message.mentions.roles.first();
  if (!role) return message.reply("❌ Mention a role.\nExample: `jarvis roleinfo @Moderator`");
  const embed = new EmbedBuilder()
    .setTitle(`Role Info — ${role.name}`)
    .addFields(
      { name: "ID", value: role.id, inline: true },
      { name: "Color", value: role.hexColor, inline: true },
      { name: "Members", value: `${role.members.size}`, inline: true },
      { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true }
    )
    .setColor(role.color || 0x00aeff);
  await message.reply({ embeds: [embed] });
});

registerCommand("membercount", "Utility", async message => {
  await message.reply(`👥 This server has **${message.guild.memberCount}** members, sir.`);
});

registerCommand("poll", "Utility", async (message, args) => {
  const question = args.join(" ");
  if (!question) return message.reply("❌ Give me a question.\nExample: `jarvis poll Pizza or tacos?`");
  const embed = new EmbedBuilder().setTitle("📊 Poll").setDescription(question).setColor(0x00aeff)
    .setFooter({ text: `Started by ${message.author.tag}` });
  const pollMessage = await message.channel.send({ embeds: [embed] });
  await pollMessage.react("👍");
  await pollMessage.react("👎");
});

registerCommand("remind", "Utility", async (message, args) => {
  const durationMs = parseDuration(args[0]);
  if (!durationMs) return message.reply("❌ Usage: `jarvis remind 10m Take a break`");
  const text = args.slice(1).join(" ") || "⏰ Reminder!";
  await message.reply(`⏰ Understood, sir. I'll remind you in **${args[0]}**.`);
  setTimeout(() => {
    message.reply(`⏰ **Reminder** for ${message.author}: ${text}`).catch(() => {});
  }, Math.min(durationMs, 24 * 60 * 60 * 1000));
});

registerCommand("afk", "Utility", async (message, args) => {
  const reason = args.join(" ") || "AFK";
  afkStore.set(afkKey(message.guild.id, message.author.id), { reason, since: Date.now() });
  await message.reply(`💤 I've marked you as AFK, sir. Reason: ${reason}`);
});

registerCommand("invite", "Utility", async message => {
  await message.reply(`🔗 Invite JARVIS: https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`);
});

registerCommand("botinfo", "Utility", async message => {
  const embed = new EmbedBuilder()
    .setTitle("🤖 JARVIS")
    .setDescription("Just A Rather Very Intelligent System.")
    .addFields(
      { name: "Servers", value: `${client.guilds.cache.size}`, inline: true },
      { name: "Uptime", value: formatUptime(client.uptime), inline: true },
      { name: "Commands", value: `${Object.keys(textCommands).length}`, inline: true }
    )
    .setColor(0x00aeff);
  await message.reply({ embeds: [embed] });
});

// ---------- FUN ----------
registerCommand("8ball", "Fun", async (message, args) => {
  if (!args.length) return message.reply("❌ Ask me a question first.");
  await message.reply(`🎱 ${pick(EIGHTBALL)}`);
});

registerCommand("coinflip", "Fun", async message => {
  await message.reply(`🪙 It landed on **${pick(["Heads", "Tails"])}**, sir.`);
});

registerCommand("dice", "Fun", async message => {
  await message.reply(`🎲 You rolled a **${1 + Math.floor(Math.random() * 6)}**.`);
});

registerCommand("roll", "Fun", async (message, args) => {
  const match = (args[0] || "1d6").match(/^(\d+)d(\d+)$/i);
  if (!match) return message.reply("❌ Usage: `jarvis roll 2d6`");
  const count = Math.min(parseInt(match[1], 10), 20);
  const sides = Math.min(parseInt(match[2], 10), 1000);
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  await message.reply(`🎲 Rolls: ${rolls.join(", ")} — Total: **${rolls.reduce((a, b) => a + b, 0)}**`);
});

registerCommand("rps", "Fun", async (message, args) => {
  const choices = ["rock", "paper", "scissors"];
  const userChoice = (args[0] || "").toLowerCase();
  if (!choices.includes(userChoice)) return message.reply("❌ Choose `rock`, `paper`, or `scissors`.");
  const botChoice = pick(choices);
  let result;
  if (userChoice === botChoice) result = "It's a tie, sir!";
  else if (
    (userChoice === "rock" && botChoice === "scissors") ||
    (userChoice === "paper" && botChoice === "rock") ||
    (userChoice === "scissors" && botChoice === "paper")
  ) result = "You win, sir!";
  else result = "I win this round, sir.";
  await message.reply(`🪨📄✂️ You chose **${userChoice}**, I chose **${botChoice}**. ${result}`);
});

registerCommand("choose", "Fun", async (message, args) => {
  const options = args.join(" ").split("|").map(o => o.trim()).filter(Boolean);
  if (options.length < 2) return message.reply("❌ Give me at least two options separated by `|`.\nExample: `jarvis choose pizza | tacos`");
  await message.reply(`🤔 I choose: **${pick(options)}**`);
});

registerCommand("joke", "Fun", async message => {
  await message.reply(`😄 ${pick(JOKES)}`);
});

registerCommand("fact", "Fun", async message => {
  await message.reply(`📚 ${pick(FACTS)}`);
});

registerCommand("quote", "Fun", async message => {
  await message.reply(`💬 ${pick(QUOTES)}`);
});

registerCommand("wyr", "Fun", async message => {
  await message.reply(`🤷 ${pick(WYR)}`);
});

registerCommand("rate", "Fun", async (message, args) => {
  const thing = args.join(" ");
  if (!thing) return message.reply("❌ Tell me what to rate.");
  await message.reply(`📊 I'd rate **${thing}** a solid **${Math.floor(Math.random() * 11)}/10**, sir.`);
});

registerCommand("ship", "Fun", async message => {
  const users = message.mentions.users;
  if (users.size < 2) return message.reply("❌ Mention two users to ship.\nExample: `jarvis ship @user1 @user2`");
  const [a, b] = [...users.values()];
  await message.reply(`💘 **${a.username}** + **${b.username}** = **${Math.floor(Math.random() * 101)}%** compatible!`);
});

registerCommand("hug", "Fun", async message => {
  const user = message.mentions.users.first();
  if (!user) return message.reply("❌ Mention someone to hug.");
  await message.reply(`🤗 ${message.author} gives ${user} a warm hug.`);
});

registerCommand("slap", "Fun", async message => {
  const user = message.mentions.users.first();
  if (!user) return message.reply("❌ Mention someone to slap.");
  await message.reply(`👋 ${message.author} slaps ${user} with a trout!`);
});

registerCommand("pat", "Fun", async message => {
  const user = message.mentions.users.first();
  if (!user) return message.reply("❌ Mention someone to pat.");
  await message.reply(`🤚 ${message.author} pats ${user} gently.`);
});

registerCommand("compliment", "Fun", async message => {
  const user = message.mentions.users.first() || message.author;
  const compliments = [
    "is sharper than most people give credit for.",
    "has impeccable taste.",
    "makes this server better just by being in it.",
    "is doing great, and deserves to hear it."
  ];
  await message.reply(`✨ ${user}, ${pick(compliments)}`);
});

// ==========================================
// TEXT MESSAGE SYSTEM
// ==========================================
client.on(Events.MessageCreate, async message => {
  if (message.author?.bot) return;
  if (!message.guild) return;

  const rawContent = (message.content || "").trim();
  if (!rawContent) return;

  const lowerFull = rawContent.toLowerCase();

  // ---- AFK: clear AFK status when the AFK user speaks ----
  const selfAfkKey = afkKey(message.guild.id, message.author.id);
  if (afkStore.has(selfAfkKey)) {
    afkStore.delete(selfAfkKey);
    message.reply("👋 Welcome back, sir. I've removed your AFK status.").catch(() => {});
  }

  // ---- AFK: notify when an AFK user is mentioned ----
  for (const [, mentionedUser] of message.mentions.users) {
    const key = afkKey(message.guild.id, mentionedUser.id);
    const afk = afkStore.get(key);
    if (afk) {
      const minutesAgo = Math.floor((Date.now() - afk.since) / 60000);
      message.reply(`💤 **${mentionedUser.username}** is AFK: ${afk.reason} (${minutesAgo}m ago)`).catch(() => {});
    }
  }

  const jarvisRegex = /\bjarvis\b/i;
  if (!jarvisRegex.test(lowerFull)) return;

  console.log(`[JARVIS TRIGGER] ${message.author.tag}: ${rawContent}`);

  // ---- "jarvis <command>" — starts with the wake word ----
  if (lowerFull.startsWith("jarvis")) {
    const input = rawContent.slice(6).trim();

    if (!input) {
      await message.reply(pick(["Yes, sir? 🤖", "Listening, sir.", "At your command, sir."]));
      return;
    }

    const args = input.split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const command = textCommands[commandName];
    if (command) {
      try {
        await command.handler(message, args);
      } catch (error) {
        console.error(`[TEXT COMMAND ERROR] ${commandName}`, error);
        await message.reply("❌ JARVIS ran into an error handling that command.");
      }
      return;
    }

    // Not a recognized command — fall back to conversational reply
    const autoReply = matchAutoReply(input);
    if (autoReply) {
      await message.reply(autoReply);
      return;
    }

    await message.reply(`I don't know **${commandName}** yet. Try \`jarvis help\`.`);
    return;
  }

  // ---- "jarvis" mentioned elsewhere, e.g. "hello jarvis" ----
  const autoReply = matchAutoReply(lowerFull);
  if (autoReply) {
    await message.reply(autoReply);
  }
});

// ==========================================
// WELCOME SYSTEM
// ==========================================
client.on(Events.GuildMemberAdd, async member => {
  try {
    const config = getConfig(member.guild.id);
    if (!config.welcomeChannelId) return;
    const channel = member.guild.channels.cache.get(config.welcomeChannelId);
    if (!channel || !channel.isTextBased()) return;

    const text = (config.welcomeMessage || "Welcome {user} to **{server}**! 🎉")
      .replaceAll("{user}", `<@${member.id}>`)
      .replaceAll("{server}", member.guild.name);

    const embed = new EmbedBuilder()
      .setTitle("Welcome!")
      .setDescription(text)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("[WELCOME ERROR]", error);
  }
});

// ==========================================
// LEAVE LOG
// ==========================================
client.on(Events.GuildMemberRemove, async member => {
  try {
    const config = getConfig(member.guild.id);
    if (!config.logChannelId) return;
    const channel = member.guild.channels.cache.get(config.logChannelId);
    if (!channel || !channel.isTextBased()) return;
    await channel.send(`👋 **${member.user.tag}** left the server.`);
  } catch (error) {
    console.error("[LEAVE LOG ERROR]", error);
  }
});

// ==========================================
// GLOBAL ERROR HANDLERS
// ==========================================
process.on("unhandledRejection", error => {
  console.error("[UNHANDLED REJECTION]", error);
});

process.on("uncaughtException", error => {
  console.error("[UNCAUGHT EXCEPTION]", error);
});

// ==========================================
// LOGIN
// ==========================================
client.login(process.env.DISCORD_TOKEN);
