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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.commands = new Collection();

const afkStore = new Map();
const reminders = new Map();
const { conversationalReply, clearMemory, getAIStatus } = require("./ai");

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
      memory: {}
    }
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

  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });

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

function accessDenied(message) {
  return message.reply(
    "🔒 Access denied, go away kid."
  );
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

const textCommands = {};

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

      await message.reply(
        `⏱️ **${member.user.tag}** has been timed out for **${durationArg}**.\nReason: ${reason}`
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

    const warnings = addWarning(
      message.guild.id,
      member.id,
      reason,
      message.author.tag
    );

    await message.reply(
      `⚠️ **${member.user.tag}** has been warned.\nWarnings: **${warnings.length}**\nReason: ${reason}`
    );
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
  await message.reply({ embeds: [new EmbedBuilder().setTitle("🩺 JARVIS Diagnostics").setColor(0x00aeff).addFields(
    { name: "Status", value: "ONLINE", inline: true },
    { name: "API", value: `${Math.round(client.ws.ping)}ms`, inline: true },
    { name: "Uptime", value: formatUptime(client.uptime), inline: true },
    { name: "Role Position", value: `${me?.roles.highest?.position ?? "Unknown"}`, inline: true },
    { name: "AutoMod", value: config.automod.enabled ? "ON" : "OFF", inline: true },
    { name: "Anti-Raid", value: config.antiRaid.enabled ? "ON" : "OFF", inline: true }
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

    // ADMINISTRATOR ONLY
    if (
      !interaction.memberPermissions?.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return interaction.reply({
        content:
          "🔒 Access denied, go away kid.",
        ephemeral: true
      });
    }

    const command =
      client.commands.get(
        interaction.commandName
      );

    if (!command) return;

    try {

      await command.execute(
        interaction,
        {
          getConfig,
          saveConfig,
          addCase,
          logEvent
        }
      );

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

    // ========================================================
    // AUTO MODERATION (runs independently of JARVIS commands)
    // ========================================================
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
    // ADMINISTRATOR LOCK
    //
    // THIS HAPPENS BEFORE ANY CHAT RESPONSE.
    // NON-ADMINS CANNOT EVEN SAY "HI JARVIS".
    // ========================================================

    if (!isAdmin(message.member)) {
      await message.reply(
        "🔒 Access denied, go away kid."
      );

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

      const args =
        input.split(/\s+/);

      const commandName =
        args.shift().toLowerCase();

      const command =
        textCommands[commandName];

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
          prompt: input
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
          prompt
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

client.login(
  process.env.DISCORD_TOKEN
);
