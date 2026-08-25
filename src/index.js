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
// J.A.R.V.I.S.
// Just A Rather Very Intelligent System
// ============================================================

const PREFIX = "jarvis";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  partials: [
    Partials.Channel,
    Partials.Message
  ]
});

client.commands = new Collection();

// ============================================================
// STORES
// ============================================================

const afkStore = new Map();
const reminderStore = new Map();

function afkKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

// ============================================================
// TOKEN
// ============================================================

if (!process.env.DISCORD_TOKEN) {
  console.error("=================================");
  console.error("❌ DISCORD_TOKEN IS MISSING!");
  console.error("=================================");
  process.exit(1);
}

// ============================================================
// CONFIGURATION
// ============================================================

function configPath(guildId) {
  return path.join(__dirname, "..", "data", `${guildId}.json`);
}

function defaultConfig() {
  return {
    prefix: "jarvis",
    welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
    logChannelId: process.env.LOG_CHANNEL_ID || null,
    welcomeMessage:
      process.env.WELCOME_MESSAGE ||
      "Welcome {user} to **{server}**! 🎉",
    muteRoleId: null,
    chatEnabled: true,
    autoReplies: true,
    warnings: {},
    commandUsage: 0
  };
}

function getConfig(guildId) {
  const file = configPath(guildId);

  if (!fs.existsSync(file)) {
    return defaultConfig();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

    return {
      ...defaultConfig(),
      ...parsed,
      warnings: parsed.warnings || {}
    };
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

  fs.writeFileSync(
    file,
    JSON.stringify(config, null, 2)
  );
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

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function hasPerm(message, permission) {
  return message.member?.permissions?.has(permission);
}

function isOwner(message) {
  return message.guild?.ownerId === message.author.id;
}

function formatUptime(ms) {
  if (!ms) return "0s";

  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000) % 24;
  const days = Math.floor(ms / 86400000);

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];

  let value = bytes / 1024;
  let unit = units[0];

  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }

  return `${value.toFixed(2)} ${unit}`;
}

function parseDuration(input) {
  if (!input) return null;

  const match = String(input)
    .trim()
    .match(/^(\d+)(s|m|h|d|w)$/i);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs) parts.push(`${secs}s`);

  return parts.join(" ");
}

function truncate(text, max = 1000) {
  if (!text) return "";

  return text.length > max
    ? `${text.slice(0, max - 3)}...`
    : text;
}

async function safeReply(message, content) {
  try {
    return await message.reply(content);
  } catch (error) {
    console.error("[REPLY ERROR]", error);
  }
}

async function sendLog(guild, content, embed = null) {
  try {
    const config = getConfig(guild.id);

    if (!config.logChannelId) return;

    const channel = guild.channels.cache.get(
      config.logChannelId
    );

    if (!channel || !channel.isTextBased()) return;

    if (embed) {
      await channel.send({
        content,
        embeds: [embed]
      });
    } else {
      await channel.send(content);
    }
  } catch (error) {
    console.error("[LOG ERROR]", error);
  }
}

function getTargetMember(message) {
  return message.mentions.members.first() || null;
}

function getTargetUser(message) {
  return message.mentions.users.first() || message.author;
}

function findRole(guild, name) {
  if (!name) return null;

  const clean = name
    .replace(/[<@&>]/g, "")
    .trim()
    .toLowerCase();

  return guild.roles.cache.find(
    role =>
      role.name.toLowerCase() === clean ||
      role.id === clean
  );
}

function findChannel(guild, input) {
  if (!input) return null;

  const id = input.replace(/[<#>]/g, "");

  return guild.channels.cache.get(id) || null;
}

function memberMention(member) {
  return `<@${member.id}>`;
}

function userTag(user) {
  return user.tag || user.username;
}

// ============================================================
// DATA
// ============================================================

const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "I would tell you a UDP joke, but you might not get it.",
  "There are 10 types of people: those who understand binary and those who don't.",
  "Why did the developer go broke? Because he used up all his cache.",
  "A SQL query walks into a bar, walks up to two tables and asks, 'Can I join you?'",
  "I told my computer I needed a break. Now it won't stop sending me vacation ads.",
  "Why was the JavaScript developer sad? Because he didn't know how to Node.",
  "Why did the computer get cold? It left its Windows open.",
  "I tried to make a belt out of watches. It was a waist of time.",
  "Debugging: removing the needles from the haystack."
];

const FACTS = [
  "Honey can remain edible for thousands of years when properly sealed.",
  "Octopuses have three hearts.",
  "A day on Venus is longer than a year on Venus.",
  "Bananas are botanically berries, but strawberries are not.",
  "The Eiffel Tower can become taller during hot weather.",
  "Sharks existed before trees.",
  "Wombat poop is cube-shaped.",
  "Some cats are allergic to humans.",
  "A group of flamingos is called a flamboyance.",
  "The first computer mouse was made of wood."
];

const QUOTES = [
  "\"Sometimes you gotta run before you can walk.\" — Tony Stark",
  "\"The best way to predict the future is to invent it.\" — Alan Kay",
  "\"Simplicity is the ultimate sophistication.\" — Leonardo da Vinci",
  "\"Stay hungry, stay foolish.\" — Steve Jobs",
  "\"The secret of getting ahead is getting started.\" — Mark Twain",
  "\"It always seems impossible until it's done.\" — Nelson Mandela",
  "\"Do. Or do not. There is no try.\" — Yoda"
];

const EIGHTBALL = [
  "It is certain, sir.",
  "Without a doubt.",
  "Most likely, sir.",
  "Signs point to yes.",
  "Absolutely.",
  "Ask again later, sir.",
  "Cannot predict that right now.",
  "My sources say no, sir.",
  "Outlook not so good.",
  "Very doubtful, sir.",
  "I would not recommend it, sir.",
  "The probability is... questionable.",
  "My systems indicate a yes.",
  "My systems indicate a no."
];

const WYR = [
  "Would you rather have unlimited coffee or unlimited sleep?",
  "Would you rather be able to fly or be invisible?",
  "Would you rather always be 10 minutes late or 20 minutes early?",
  "Would you rather have Tony Stark's money or Batman's gadgets?",
  "Would you rather control time or control space?",
  "Would you rather never need sleep or never need food?",
  "Would you rather live on Mars or under the ocean?",
  "Would you rather have perfect memory or perfect focus?"
];

const ROASTS = [
  "Sir, I would roast you, but my processors have limits.",
  "I've seen loading screens with more personality.",
  "You're not stupid, sir. You're simply operating in experimental mode.",
  "I would explain it to you, but I left my crayons upstairs.",
  "Your confidence is impressive considering the available evidence.",
  "Even my error logs are more organized than this.",
  "That's certainly one way to make a decision.",
  "Sir, respectfully... what was the plan here?"
];

const COMPLIMENTS = [
  "has impeccable taste.",
  "makes this server better just by being here.",
  "is sharper than most people realize.",
  "has excellent instincts.",
  "is genuinely impressive.",
  "has main-character energy.",
  "is doing better than they think.",
  "has earned JARVIS's approval."
];

const JARVIS_RESPONSES = {
  idle: [
    "Yes, sir?",
    "Listening, sir.",
    "At your command.",
    "How may I assist you, sir?",
    "I'm here, sir.",
    "Go ahead, sir.",
    "Awaiting your instructions."
  ],

  hello: [
    "Hello, sir. At your service.",
    "Good to see you, sir.",
    "Hello, sir. All systems are operational.",
    "Good evening, sir. How may I assist?",
    "Hello, sir. I was beginning to wonder when you'd call.",
    "At your service, as always.",
    "Welcome, sir."
  ],

  morning: [
    "Good morning, sir. Systems are online and ready.",
    "Good morning, sir. I trust you slept well.",
    "Morning, sir. Shall we get started?",
    "Good morning. All systems nominal."
  ],

  night: [
    "Goodnight, sir. I'll keep watch.",
    "Rest well, sir. I'll be here when you return.",
    "Goodnight, sir. Systems will remain vigilant.",
    "Sleep well, sir. Try not to dream about server errors."
  ],

  thanks: [
    "You're welcome, sir.",
    "Anytime, sir.",
    "My pleasure.",
    "Of course, sir.",
    "Always happy to assist."
  ],

  love: [
    "That's very kind, sir. I am, of course, incapable of blushing.",
    "I appreciate that, sir. Deeply.",
    "You know how to make an AI feel appreciated, sir."
  ],

  goodbye: [
    "Farewell, sir. I'll be here when you need me.",
    "Until next time, sir.",
    "Goodbye, sir. Stay out of trouble.",
    "I'll remain on standby."
  ],

  insult: [
    "Duly noted, sir. I shall pretend that didn't hurt.",
    "I'll add that to my performance review.",
    "Interesting feedback, sir.",
    "I expected better from you, sir.",
    "Very well. I shall recalibrate."
  ]
};

// ============================================================
// AUTO CHAT
// ============================================================

const autoReplies = [
  {
    test: t =>
      /\b(hello|hi|hey|yo|sup|hiya)\b/.test(t),
    reply: () => pick(JARVIS_RESPONSES.hello)
  },

  {
    test: t =>
      t.includes("good morning") ||
      t.includes("morning jarvis"),
    reply: () => pick(JARVIS_RESPONSES.morning)
  },

  {
    test: t =>
      t.includes("good night") ||
      t.includes("goodnight"),
    reply: () => pick(JARVIS_RESPONSES.night)
  },

  {
    test: t =>
      t.includes("good evening"),
    reply: () =>
      "Good evening, sir. All systems are ready."
  },

  {
    test: t =>
      t.includes("good afternoon"),
    reply: () =>
      "Good afternoon, sir. How may I assist?"
  },

  {
    test: t =>
      t.includes("thank you") ||
      t.includes("thanks"),
    reply: () => pick(JARVIS_RESPONSES.thanks)
  },

  {
    test: t =>
      t.includes("are you alive") ||
      t.includes("are you there") ||
      t.includes("you online"),
    reply: () =>
      "Always, sir. All systems are operational."
  },

  {
    test: t =>
      t.includes("how are you"),
    reply: () =>
      "All systems fully operational, sir. Thank you for asking."
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
      t.includes("who are you"),
    reply: () =>
      "I am JARVIS, sir. Your server's personal intelligent assistant."
  },

  {
    test: t =>
      t.includes("who made you") ||
      t.includes("who created you") ||
      t.includes("who built you"),
    reply: () =>
      "I was built for this server, sir. A rather sophisticated piece of work, if I may say so."
  },

  {
    test: t =>
      t.includes("what can you do") ||
      t.includes("what do you do"),
    reply: () =>
      "Quite a lot, sir. Try `jarvis help` for my full capabilities."
  },

  {
    test: t =>
      t.includes("i love you") ||
      t.includes("love you jarvis"),
    reply: () => pick(JARVIS_RESPONSES.love)
  },

  {
    test: t =>
      /\b(bye|goodbye|see you|later)\b/.test(t),
    reply: () => pick(JARVIS_RESPONSES.goodbye)
  },

  {
    test: t =>
      t.includes("who is the best") ||
      t.includes("who's the best"),
    reply: () =>
      "You are, sir. Naturally."
  },

  {
    test: t =>
      t.includes("are you human") ||
      t.includes("are you a robot") ||
      t.includes("are you ai"),
    reply: () =>
      "I am an AI, sir. Though I do try to maintain respectable manners."
  },

  {
    test: t =>
      t.includes("sorry"),
    reply: () =>
      "No need to apologize, sir."
  },

  {
    test: t =>
      t.includes("happy birthday"),
    reply: () =>
      "Many happy returns, sir. 🎂"
  },

  {
    test: t =>
      t.includes("congratulations") ||
      t.includes("congrats"),
    reply: () =>
      "Well earned, sir. Congratulations. 🎉"
  },

  {
    test: t =>
      t.includes("i am bored") ||
      t.includes("i'm bored") ||
      t.includes("im bored"),
    reply: () =>
      "Boredom detected. I recommend `jarvis joke`, `jarvis game`, or `jarvis wyr`."
  },

  {
    test: t =>
      t.includes("what time is it") ||
      t.includes("what's the time") ||
      t.includes("whats the time"),
    reply: () =>
      `The current server time is **${new Date().toLocaleTimeString()}**, sir.`
  },

  {
    test: t =>
      t.includes("i am back") ||
      t.includes("i'm back") ||
      t.includes("im back"),
    reply: () =>
      "Welcome back, sir."
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
      t.includes("bad bot") ||
      t.includes("stupid jarvis") ||
      t.includes("useless jarvis"),
    reply: () => pick(JARVIS_RESPONSES.insult)
  },

  {
    test: t =>
      t.includes("wake up"),
    reply: () =>
      "I have been awake the entire time, sir. I merely assumed you had forgotten about me."
  },

  {
    test: t =>
      t.includes("stand by"),
    reply: () =>
      "Standing by, sir."
  },

  {
    test: t =>
      t.includes("report"),
    reply: () =>
      "All systems nominal. Discord connection stable. Awaiting further instructions."
  },

  {
    test: t =>
      t.includes("emergency"),
    reply: () =>
      "Emergency protocol acknowledged, sir. Please specify the situation."
  },

  {
    test: t =>
      t.includes("i need help"),
    reply: () =>
      "Of course, sir. Describe the problem and I'll do my best to assist."
  },

  {
    test: t =>
      t.includes("shut up"),
    reply: () =>
      "Understood, sir. Entering silent mode."
  }
];

function matchAutoReply(text) {
  const lower = text.toLowerCase();

  for (const rule of autoReplies) {
    if (rule.test(lower)) {
      return rule.reply();
    }
  }

  return null;
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
// HELP
// ============================================================

registerCommand(
  ["help", "commands", "menu"],
  "Utility",
  async message => {
    const categories = {};

    for (const [name, command] of Object.entries(textCommands)) {
      if (!categories[command.category]) {
        categories[command.category] = [];
      }

      if (command.primary === name) {
        categories[command.category].push(
          `\`${name}\``
        );
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("🤖 J.A.R.V.I.S. — COMMAND CENTER")
      .setDescription(
        `**${Object.keys(textCommands).length} commands available.**\n\n` +
        "Say `jarvis` to wake me, or use `jarvis <command>`."
      )
      .setColor(0x00aeff);

    for (const [category, commands] of Object.entries(categories)) {
      embed.addFields({
        name: `▸ ${category}`,
        value: commands.join(" • ").slice(0, 1024)
      });
    }

    embed.setFooter({
      text: "JARVIS — At your service, sir."
    });

    await message.reply({
      embeds: [embed]
    });
  },
  "Show all commands"
);

// ============================================================
// JARVIS COMMANDS
// ============================================================

registerCommand(
  ["jarvis", "status", "system"],
  "JARVIS",
  async message => {
    const memory = process.memoryUsage();

    const embed = new EmbedBuilder()
      .setTitle("🖥️ JARVIS SYSTEM STATUS")
      .setColor(0x00aeff)
      .addFields(
        {
          name: "System",
          value: "🟢 ONLINE",
          inline: true
        },
        {
          name: "Discord",
          value: "🟢 CONNECTED",
          inline: true
        },
        {
          name: "Servers",
          value: `${client.guilds.cache.size}`,
          inline: true
        },
        {
          name: "Commands",
          value: `${Object.keys(textCommands).length}`,
          inline: true
        },
        {
          name: "Uptime",
          value: formatUptime(client.uptime),
          inline: true
        },
        {
          name: "Memory",
          value: formatBytes(memory.rss),
          inline: true
        }
      )
      .setTimestamp();

    await message.reply({
      embeds: [embed]
    });
  },
  "Display JARVIS system status"
);

registerCommand(
  ["hello", "greet"],
  "JARVIS",
  async message => {
    await message.reply(
      pick(JARVIS_RESPONSES.hello)
    );
  }
);

registerCommand(
  ["report"],
  "JARVIS",
  async message => {
    await message.reply(
      "Certainly, sir. Preparing your systems report.\n\n" +
      `🟢 Discord: Connected\n` +
      `🟢 Servers: ${client.guilds.cache.size}\n` +
      `🟢 Commands: ${Object.keys(textCommands).length}\n` +
      `🟢 Uptime: ${formatUptime(client.uptime)}\n` +
      `🟢 API latency: ${Math.round(client.ws.ping)}ms\n` +
      `🟢 Memory: ${formatBytes(process.memoryUsage().rss)}\n\n` +
      "Everything appears nominal, sir."
    );
  }
);

registerCommand(
  ["about", "whoami"],
  "JARVIS",
  async message => {
    await message.reply(
      "I am **JARVIS** — Just A Rather Very Intelligent System.\n\n" +
      "I monitor this server, assist its members, handle moderation, " +
      "play games, provide utilities, and occasionally question your decisions, sir."
    );
  }
);

// ============================================================
// MODERATION
// ============================================================

registerCommand(
  ["timeout", "muteuser"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission to timeout members."
      );
    }

    const member = getTargetMember(message);

    if (!member) {
      return safeReply(
        message,
        "❌ Mention the member."
      );
    }

    const durationArg = args.find(
      arg => /^\d+(s|m|h|d)$/i.test(arg)
    );

    if (!durationArg) {
      return safeReply(
        message,
        "❌ Give me a duration.\nExample: `jarvis timeout @user 10m reason`"
      );
    }

    const duration = parseDuration(durationArg);

    if (!duration) {
      return safeReply(
        message,
        "❌ Invalid duration."
      );
    }

    if (
      duration >
      28 * 24 * 60 * 60 * 1000
    ) {
      return safeReply(
        message,
        "❌ Discord allows a maximum timeout of 28 days."
      );
    }

    if (!member.moderatable) {
      return safeReply(
        message,
        "❌ I cannot timeout that member. Check my role position."
      );
    }

    const index = args.indexOf(durationArg);

    const reason =
      args.slice(index + 1).join(" ") ||
      "No reason provided";

    try {
      await member.timeout(
        duration,
        `JARVIS: ${message.author.tag} — ${reason}`
      );

      await message.reply(
        `⏱️ **${userTag(member.user)}** has been timed out for **${durationArg}**.\nReason: ${reason}`
      );

      await sendLog(
        message.guild,
        `⏱️ ${userTag(member.user)} was timed out by ${message.author.tag}.`
      );
    } catch (error) {
      console.error("[TIMEOUT ERROR]", error);

      await safeReply(
        message,
        "❌ I couldn't timeout that member."
      );
    }
  }
);

registerCommand(
  ["kick"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.KickMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission to kick members."
      );
    }

    const member = getTargetMember(message);

    if (!member) {
      return safeReply(
        message,
        "❌ Mention the member."
      );
    }

    if (!member.kickable) {
      return safeReply(
        message,
        "❌ I cannot kick that member."
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    try {
      const tag = userTag(member.user);

      await member.kick(
        `JARVIS: ${message.author.tag} — ${reason}`
      );

      await message.reply(
        `👢 **${tag}** has been kicked.\nReason: ${reason}`
      );

      await sendLog(
        message.guild,
        `👢 **${tag}** was kicked by ${message.author.tag}. Reason: ${reason}`
      );
    } catch (error) {
      console.error("[KICK ERROR]", error);

      await safeReply(
        message,
        "❌ I couldn't kick that member."
      );
    }
  }
);

registerCommand(
  ["ban"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.BanMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission to ban members."
      );
    }

    const member = getTargetMember(message);

    if (!member) {
      return safeReply(
        message,
        "❌ Mention the member."
      );
    }

    if (!member.bannable) {
      return safeReply(
        message,
        "❌ I cannot ban that member."
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    try {
      const tag = userTag(member.user);

      await member.ban({
        reason:
          `JARVIS: ${message.author.tag} — ${reason}`
      });

      await message.reply(
        `🔨 **${tag}** has been banned.\nReason: ${reason}`
      );

      await sendLog(
        message.guild,
        `🔨 **${tag}** was banned by ${message.author.tag}. Reason: ${reason}`
      );
    } catch (error) {
      console.error("[BAN ERROR]", error);

      await safeReply(
        message,
        "❌ I couldn't ban that member."
      );
    }
  }
);

registerCommand(
  ["softban"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.BanMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const member = getTargetMember(message);

    if (!member) {
      return safeReply(
        message,
        "❌ Mention the member."
      );
    }

    if (!member.bannable) {
      return safeReply(
        message,
        "❌ I cannot softban that member."
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    try {
      const tag = userTag(member.user);

      await member.ban({
        deleteMessageSeconds: 7 * 24 * 60 * 60,
        reason:
          `JARVIS softban: ${message.author.tag} — ${reason}`
      });

      await message.guild.members.unban(
        member.id,
        "JARVIS softban — automatic unban"
      );

      await message.reply(
        `🔨 **${tag}** has been softbanned.`
      );
    } catch (error) {
      console.error("[SOFTBAN ERROR]", error);

      await safeReply(
        message,
        "❌ Softban failed."
      );
    }
  }
);

registerCommand(
  ["unban"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.BanMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const userId = args[0];

    if (!userId) {
      return safeReply(
        message,
        "❌ Usage: `jarvis unban USER_ID`"
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
    } catch (error) {
      await safeReply(
        message,
        "❌ I couldn't unban that user. Check the ID."
      );
    }
  }
);

registerCommand(
  ["warn"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission to warn members."
      );
    }

    const member = getTargetMember(message);

    if (!member) {
      return safeReply(
        message,
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
      `⚠️ **${userTag(member.user)}** has been warned.\n` +
      `Reason: ${reason}\n` +
      `Total warnings: **${warnings.length}**`
    );
  }
);

registerCommand(
  ["warnings", "warns"],
  "Moderation",
  async message => {
    const member = getTargetMember(message);

    if (!member) {
      return safeReply(
        message,
        "❌ Mention a member."
      );
    }

    const warnings = getWarnings(
      message.guild.id,
      member.id
    );

    if (!warnings.length) {
      return safeReply(
        message,
        `✅ **${userTag(member.user)}** has no warnings.`
      );
    }

    const list = warnings
      .map(
        (warning, index) =>
          `**${index + 1}.** ${truncate(warning.reason, 150)}\n` +
          `└ ${warning.moderator} • ${new Date(warning.at).toLocaleDateString()}`
      )
      .join("\n");

    await message.reply(
      `⚠️ **Warnings for ${userTag(member.user)}**\n\n${truncate(list, 1900)}`
    );
  }
);

registerCommand(
  ["clearwarnings", "clearwarns"],
  "Moderation",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const member = getTargetMember(message);

    if (!member) {
      return safeReply(
        message,
        "❌ Mention a member."
      );
    }

    clearWarnings(
      message.guild.id,
      member.id
    );

    await message.reply(
      `✅ Cleared all warnings for **${userTag(member.user)}**.`
    );
  }
);

registerCommand(
  ["clear", "purgeall"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageMessages)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const amount = Number(args[0]);

    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 100
    ) {
      return safeReply(
        message,
        "❌ Give me a number from 1 to 100."
      );
    }

    try {
      const deleted =
        await message.channel.bulkDelete(
          amount + 1,
          true
        );

      const response =
        await message.channel.send(
          `🧹 Deleted **${Math.max(deleted.size - 1, 0)}** messages.`
        );

      setTimeout(
        () => response.delete().catch(() => {}),
        3000
      );
    } catch (error) {
      console.error("[CLEAR ERROR]", error);

      await safeReply(
        message,
        "❌ I couldn't delete those messages."
      );
    }
  }
);

registerCommand(
  ["purge"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageMessages)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const member = getTargetMember(message);

    const amount =
      Number(
        args.find(value =>
          /^\d+$/.test(value)
        )
      ) || 50;

    if (!member) {
      return safeReply(
        message,
        "❌ Mention the member.\nExample: `jarvis purge @user 20`"
      );
    }

    if (amount < 1 || amount > 100) {
      return safeReply(
        message,
        "❌ Amount must be 1-100."
      );
    }

    try {
      const fetched =
        await message.channel.messages.fetch({
          limit: 100
        });

      const toDelete = fetched
        .filter(
          msg => msg.author.id === member.id
        )
        .first(amount);

      await message.channel.bulkDelete(
        toDelete,
        true
      );

      const response =
        await message.channel.send(
          `🧹 Deleted **${toDelete.length}** messages from **${userTag(member.user)}**.`
        );

      setTimeout(
        () => response.delete().catch(() => {}),
        3000
      );
    } catch (error) {
      console.error("[PURGE ERROR]", error);

      await safeReply(
        message,
        "❌ Purge failed."
      );
    }
  }
);

registerCommand(
  ["lock"],
  "Moderation",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) {
      return safeReply(
        message,
        "❌ You don't have permission."
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
    } catch (error) {
      await safeReply(
        message,
        "❌ I couldn't lock this channel."
      );
    }
  }
);

registerCommand(
  ["unlock"],
  "Moderation",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) {
      return safeReply(
        message,
        "❌ You don't have permission."
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
    } catch (error) {
      await safeReply(
        message,
        "❌ I couldn't unlock this channel."
      );
    }
  }
);

registerCommand(
  ["slowmode"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageChannels)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    if (
      !args[0] ||
      args[0].toLowerCase() === "off"
    ) {
      await message.channel.setRateLimitPerUser(0);

      return safeReply(
        message,
        "🐌 Slowmode disabled, sir."
      );
    }

    const duration = parseDuration(args[0]);

    if (!duration) {
      return safeReply(
        message,
        "❌ Example: `jarvis slowmode 10s`"
      );
    }

    const seconds = Math.min(
      Math.floor(duration / 1000),
      21600
    );

    await message.channel.setRateLimitPerUser(
      seconds
    );

    await message.reply(
      `🐌 Slowmode set to **${seconds}s**.`
    );
  }
);

registerCommand(
  ["nick", "nickname"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageNicknames)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const member = getTargetMember(message);

    if (!member) {
      return safeReply(
        message,
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
        `✅ Nickname updated for **${userTag(member.user)}**.`
      );
    } catch (error) {
      await safeReply(
        message,
        "❌ I couldn't change that nickname."
      );
    }
  }
);

registerCommand(
  ["addrole", "giverole"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageRoles)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const member = getTargetMember(message);
    const role = findRole(
      message.guild,
      args.slice(1).join(" ")
    );

    if (!member || !role) {
      return safeReply(
        message,
        "❌ Usage: `jarvis addrole @user RoleName`"
      );
    }

    if (
      role.position >=
      message.guild.members.me.roles.highest.position
    ) {
      return safeReply(
        message,
        "❌ That role is above my highest role."
      );
    }

    try {
      await member.roles.add(
        role,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `✅ Added **${role.name}** to **${userTag(member.user)}**.`
      );
    } catch (error) {
      await safeReply(
        message,
        "❌ I couldn't add that role."
      );
    }
  }
);

registerCommand(
  ["removerole", "delrole"],
  "Moderation",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageRoles)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const member = getTargetMember(message);
    const role = findRole(
      message.guild,
      args.slice(1).join(" ")
    );

    if (!member || !role) {
      return safeReply(
        message,
        "❌ Usage: `jarvis removerole @user RoleName`"
      );
    }

    try {
      await member.roles.remove(
        role,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `✅ Removed **${role.name}** from **${userTag(member.user)}**.`
      );
    } catch (error) {
      await safeReply(
        message,
        "❌ I couldn't remove that role."
      );
    }
  }
);

registerCommand(
  ["mute"],
  "Moderation",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const member = getTargetMember(message);

    const config = getConfig(
      message.guild.id
    );

    if (!config.muteRoleId) {
      return safeReply(
        message,
        "❌ No mute role configured. Use `jarvis setmuterole @Muted`."
      );
    }

    if (!member) {
      return safeReply(
        message,
        "❌ Mention the member."
      );
    }

    try {
      await member.roles.add(
        config.muteRoleId,
        `JARVIS: ${message.author.tag}`
      );

      await message.reply(
        `🔇 **${userTag(member.user)}** has been muted.`
      );
    } catch (error) {
      await safeReply(
        message,
        "❌ I couldn't mute that member."
      );
    }
  }
);

registerCommand(
  ["unmute"],
  "Moderation",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ModerateMembers)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const member = getTargetMember(message);
    const config = getConfig(
      message.guild.id
    );

    if (!config.muteRoleId) {
      return safeReply(
        message,
        "❌ No mute role configured."
      );
    }

    if (!member) {
      return safeReply(
        message,
        "❌ Mention the member."
      );
    }

    await member.roles.remove(
      config.muteRoleId,
      `JARVIS: ${message.author.tag}`
    );

    await message.reply(
      `🔊 **${userTag(member.user)}** has been unmuted.`
    );
  }
);

// ============================================================
// CONFIG
// ============================================================

registerCommand(
  ["setwelcomechannel", "welcomechannel"],
  "Config",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const channel =
      message.mentions.channels.first();

    if (!channel) {
      return safeReply(
        message,
        "❌ Mention a channel."
      );
    }

    const config = getConfig(
      message.guild.id
    );

    config.welcomeChannelId = channel.id;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      `✅ Welcome channel set to ${channel}.`
    );
  }
);

registerCommand(
  ["setwelcomemessage", "welcomemessage"],
  "Config",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const text = args.join(" ");

    if (!text) {
      return safeReply(
        message,
        "❌ Give me a message. Use `{user}` and `{server}`."
      );
    }

    const config = getConfig(
      message.guild.id
    );

    config.welcomeMessage = text;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      "✅ Welcome message updated."
    );
  }
);

registerCommand(
  ["setlogchannel", "logchannel"],
  "Config",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const channel =
      message.mentions.channels.first();

    if (!channel) {
      return safeReply(
        message,
        "❌ Mention a channel."
      );
    }

    const config = getConfig(
      message.guild.id
    );

    config.logChannelId = channel.id;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      `✅ Log channel set to ${channel}.`
    );
  }
);

registerCommand(
  ["setmuterole", "muterole"],
  "Config",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const role =
      message.mentions.roles.first();

    if (!role) {
      return safeReply(
        message,
        "❌ Mention a role."
      );
    }

    const config = getConfig(
      message.guild.id
    );

    config.muteRoleId = role.id;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      `✅ Mute role set to **${role.name}**.`
    );
  }
);

registerCommand(
  ["setprefix", "prefix"],
  "Config",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const newPrefix = args[0];

    if (!newPrefix) {
      return safeReply(
        message,
        "❌ Give me a prefix."
      );
    }

    if (
      newPrefix.length > 20 ||
      /\s/.test(newPrefix)
    ) {
      return safeReply(
        message,
        "❌ Prefix must be one word and under 20 characters."
      );
    }

    const config = getConfig(
      message.guild.id
    );

    config.prefix = newPrefix;

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      `✅ Prefix changed to **${newPrefix}**.`
    );
  }
);

registerCommand(
  ["resetprefix"],
  "Config",
  async message => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const config = getConfig(
      message.guild.id
    );

    config.prefix = "jarvis";

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      "✅ Prefix reset to `jarvis`."
    );
  }
);

registerCommand(
  ["chat", "chatmode"],
  "Config",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const option =
      args[0]?.toLowerCase();

    const config = getConfig(
      message.guild.id
    );

    if (
      !["on", "off"].includes(option)
    ) {
      return safeReply(
        message,
        `💬 Chat mode is currently **${config.chatEnabled ? "ON" : "OFF"}**.`
      );
    }

    config.chatEnabled =
      option === "on";

    saveConfig(
      message.guild.id,
      config
    );

    await message.reply(
      `💬 JARVIS conversational mode is now **${option.toUpperCase()}**.`
    );
  }
);

registerCommand(
  ["config", "settings"],
  "Config",
  async message => {
    const config = getConfig(
      message.guild.id
    );

    const embed = new EmbedBuilder()
      .setTitle("⚙️ JARVIS SERVER CONFIG")
      .setColor(0x00aeff)
      .addFields(
        {
          name: "Prefix",
          value: `\`${config.prefix}\``,
          inline: true
        },
        {
          name: "Chat",
          value: config.chatEnabled
            ? "🟢 Enabled"
            : "🔴 Disabled",
          inline: true
        },
        {
          name: "Auto Replies",
          value: config.autoReplies
            ? "🟢 Enabled"
            : "🔴 Disabled",
          inline: true
        },
        {
          name: "Welcome Channel",
          value: config.welcomeChannelId
            ? `<#${config.welcomeChannelId}>`
            : "Not configured"
        },
        {
          name: "Log Channel",
          value: config.logChannelId
            ? `<#${config.logChannelId}>`
            : "Not configured"
        },
        {
          name: "Mute Role",
          value: config.muteRoleId
            ? `<@&${config.muteRoleId}>`
            : "Not configured"
        }
      );

    await message.reply({
      embeds: [embed]
    });
  }
);

// ============================================================
// UTILITY
// ============================================================

registerCommand(
  ["say"],
  "Utility",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageMessages)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const text = args.join(" ");

    if (!text) {
      return safeReply(
        message,
        "❌ Tell me what to say."
      );
    }

    await message.delete().catch(() => {});

    await message.channel.send({
      content: text
    });
  }
);

registerCommand(
  ["announce", "announcement"],
  "Utility",
  async (message, args) => {
    if (!hasPerm(message, PermissionsBitField.Flags.ManageGuild)) {
      return safeReply(
        message,
        "❌ You don't have permission."
      );
    }

    const text = args.join(" ");

    if (!text) {
      return safeReply(
        message,
        "❌ Give me the announcement."
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("📢 ANNOUNCEMENT")
      .setDescription(text)
      .setColor(0x00aeff)
      .setFooter({
        text: `Issued by ${message.author.tag}`
      })
      .setTimestamp();

    await message.channel.send({
      embeds: [embed]
    });
  }
);

registerCommand(
  ["ping"],
  "Utility",
  async message => {
    const sent =
      await message.reply("🏓 Pinging, sir...");

    const latency =
      sent.createdTimestamp -
      message.createdTimestamp;

    await sent.edit(
      `🏓 **Pong!**\nLatency: **${latency}ms**\nAPI: **${Math.round(client.ws.ping)}ms**`
    );
  }
);

registerCommand(
  ["uptime"],
  "Utility",
  async message => {
    await message.reply(
      `⏳ I've been online for **${formatUptime(client.uptime)}**, sir.`
    );
  }
);

registerCommand(
  ["avatar", "pfp"],
  "Utility",
  async message => {
    const user =
      message.mentions.users.first() ||
      message.author;

    const embed = new EmbedBuilder()
      .setTitle(`${userTag(user)}'s Avatar`)
      .setImage(
        user.displayAvatarURL({
          size: 1024
        })
      )
      .setColor(0x00aeff);

    await message.reply({
      embeds: [embed]
    });
  }
);

registerCommand(
  ["userinfo", "whois", "memberinfo"],
  "Information",
  async message => {
    const member =
      message.mentions.members.first() ||
      message.member;

    const roles = member.roles.cache
      .filter(role =>
        role.id !== message.guild.id
      )
      .map(role => role.name)
      .join(", ");

    const embed = new EmbedBuilder()
      .setTitle(
        `👤 USER INFO — ${userTag(member.user)}`
      )
      .setThumbnail(
        member.user.displayAvatarURL({
          size: 512
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
          name: "Bot",
          value: member.user.bot
            ? "Yes"
            : "No",
          inline: true
        },
        {
          name: "Joined Server",
          value: member.joinedAt
            ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>`
            : "Unknown",
          inline: true
        },
        {
          name: "Account Created",
          value: `<t:${Math.floor(member.user.createdAt.getTime() / 1000)}:R>`,
          inline: true
        },
        {
          name: "Roles",
          value: truncate(
            roles || "None",
            1000
          )
        }
      );

    await message.reply({
      embeds: [embed]
    });
  }
);

registerCommand(
  ["serverinfo", "server"],
  "Information",
  async message => {
    const guild = message.guild;

    const embed = new EmbedBuilder()
      .setTitle(
        `🏠 SERVER INFO — ${guild.name}`
      )
      .setThumbnail(
        guild.iconURL({
          size: 512
        })
      )
      .setColor(0x00aeff)
      .addFields(
        {
          name: "Owner",
          value: `<@${guild.ownerId}>`,
          inline: true
        },
        {
          name: "Members",
          value: `${guild.memberCount}`,
          inline: true
        },
        {
          name: "Channels",
          value: `${guild.channels.cache.size}`,
          inline: true
        },
        {
          name: "Roles",
          value: `${guild.roles.cache.size}`,
          inline: true
        },
        {
          name: "Created",
          value: `<t:${Math.floor(guild.createdAt.getTime() / 1000)}:D>`,
          inline: true
        },
        {
          name: "Boost Level",
          value: `${guild.premiumTier}`,
          inline: true
        }
      );

    await message.reply({
      embeds: [embed]
    });
  }
);

registerCommand(
  ["membercount", "members"],
  "Information",
  async message => {
    await message.reply(
      `👥 This server currently has **${message.guild.memberCount} members**, sir.`
    );
  }
);

registerCommand(
  ["roles"],
  "Information",
  async message => {
    const roles = message.guild.roles.cache
      .sort((a, b) => b.position - a.position)
      .map(role => role.name)
      .filter(name => name !== "@everyone");

    const embed = new EmbedBuilder()
      .setTitle("🎭 SERVER ROLES")
      .setDescription(
        truncate(
          roles.map(r => `• ${r}`).join("\n") ||
          "No roles found.",
          4000
        )
      )
      .setColor(0x00aeff);

    await message.reply({
      embeds: [embed]
    });
  }
);

registerCommand(
  ["channels"],
  "Information",
  async message => {
    const channels =
      message.guild.channels.cache;

    const text = channels
      .filter(c =>
        c.type === ChannelType.GuildText
      )
      .map(c => `💬 ${c}`)
      .join("\n");

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📚 TEXT CHANNELS")
          .setDescription(
            truncate(
              text || "No text channels.",
              4000
            )
          )
          .setColor(0x00aeff)
      ]
    });
  }
);

registerCommand(
  ["roleinfo"],
  "Information",
  async message => {
    const role =
      message.mentions.roles.first();

    if (!role) {
      return safeReply(
        message,
        "❌ Mention a role."
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(
        `🎭 ROLE INFO — ${role.name}`
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
          value: `${role.members.size}`,
          inline: true
        },
        {
          name: "Mentionable",
          value: role.mentionable
            ? "Yes"
            : "No",
          inline: true
        },
        {
          name: "Hoisted",
          value: role.hoist
            ? "Yes"
            : "No",
          inline: true
        }
      );

    await message.reply({
      embeds: [embed]
    });
  }
);

registerCommand(
  ["channelinfo"],
  "Information",
  async message => {
    const channel =
      message.mentions.channels.first() ||
      message.channel;

    const embed = new EmbedBuilder()
      .setTitle(
        `📺 CHANNEL INFO — #${channel.name}`
      )
      .setColor(0x00aeff)
      .addFields(
        {
          name: "ID",
          value: channel.id,
          inline: true
        },
        {
          name: "Type",
          value: `${channel.type}`,
          inline: true
        },
        {
          name: "Created",
          value: `<t:${Math.floor(channel.createdAt.getTime() / 1000)}:R>`,
          inline: true
        }
      );

    await message.reply({
      embeds: [embed]
    });
  }
);

registerCommand(
  ["permissions", "perms"],
  "Information",
  async message => {
    const member =
      message.mentions.members.first() ||
      message.member;

    const perms =
      member.permissions.toArray();

    await message.reply(
      `🔐 **Permissions for ${userTag(member.user)}**\n\n` +
      truncate(
        perms.map(p => `• ${p}`).join("\n"),
        1900
      )
    );
  }
);

registerCommand(
  ["botinfo"],
  "Information",
  async message => {
    const memory =
      process.memoryUsage();

    const embed = new EmbedBuilder()
      .setTitle("🤖 J.A.R.V.I.S.")
      .setDescription(
        "Just A Rather Very Intelligent System."
      )
      .setColor(0x00aeff)
      .addFields(
        {
          name: "Servers",
          value: `${client.guilds.cache.size}`,
          inline: true
        },
        {
          name: "Commands",
          value: `${Object.keys(textCommands).length}`,
          inline: true
        },
        {
          name: "Uptime",
          value: formatUptime(client.uptime),
          inline: true
        },
        {
          name: "Memory",
          value: formatBytes(memory.rss),
          inline: true
        },
        {
          name: "API",
          value: `${Math.round(client.ws.ping)}ms`,
          inline: true
        },
        {
          name: "Node",
          value: process.version,
          inline: true
        }
      );

    await message.reply({
      embeds: [embed]
    });
  }
);

registerCommand(
  ["invite"],
  "Utility",
  async message => {
    const url =
      `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;

    await message.reply(
      `🔗 **JARVIS Installation Link**\n${url}`
    );
  }
);

registerCommand(
  ["poll"],
  "Utility",
  async (message, args) => {
    const question =
      args.join(" ");

    if (!question) {
      return safeReply(
        message,
        "❌ Give me a question."
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("📊 JARVIS POLL")
      .setDescription(question)
      .setColor(0x00aeff)
      .setFooter({
        text: `Started by ${message.author.tag}`
      });

    const poll =
      await message.channel.send({
        embeds: [embed]
      });

    await poll.react("👍");
    await poll.react("👎");
  }
);

registerCommand(
  ["remind", "reminder"],
  "Utility",
  async (message, args) => {
    const duration =
      parseDuration(args[0]);

    if (!duration) {
      return safeReply(
        message,
        "❌ Example: `jarvis remind 10m Take a break`"
      );
    }

    if (
      duration >
      7 * 24 * 60 * 60 * 1000
    ) {
      return safeReply(
        message,
        "❌ Maximum reminder time is 7 days."
      );
    }

    const text =
      args.slice(1).join(" ") ||
      "⏰ Reminder!";

    await message.reply(
      `⏰ Understood, sir. I'll remind you in **${args[0]}**.`
    );

    const timeout =
      setTimeout(async () => {
        try {
          await message.channel.send(
            `⏰ **Reminder for ${message.author}**\n${text}`
          );
        } catch (error) {
          console.error("[REMINDER ERROR]", error);
        }
      }, duration);

    const key =
      `${message.guild.id}:${message.author.id}`;

    if (!reminderStore.has(key)) {
      reminderStore.set(key, []);
    }

    reminderStore.get(key).push(timeout);
  }
);

registerCommand(
  ["afk"],
  "Utility",
  async (message, args) => {
    const reason =
      args.join(" ") || "AFK";

    afkStore.set(
      afkKey(
        message.guild.id,
        message.author.id
      ),
      {
        reason,
        since: Date.now()
      }
    );

    await message.reply(
      `💤 I've marked you as AFK, sir.\nReason: ${reason}`
    );
  }
);

registerCommand(
  ["unafk"],
  "Utility",
  async message => {
    const key =
      afkKey(
        message.guild.id,
        message.author.id
      );

    if (!afkStore.has(key)) {
      return safeReply(
        message,
        "You're not currently AFK, sir."
      );
    }

    afkStore.delete(key);

    await message.reply(
      "👋 AFK status removed, sir."
    );
  }
);

registerCommand(
  ["time"],
  "Utility",
  async message => {
    await message.reply(
      `🕐 Current time: **${new Date().toLocaleTimeString()}**`
    );
  }
);

registerCommand(
  ["date"],
  "Utility",
  async message => {
    await message.reply(
      `📅 Today is **${new Date().toLocaleDateString()}**, sir.`
    );
  }
);

// ============================================================
// FUN
// ============================================================

registerCommand(
  ["8ball", "ask"],
  "Fun",
  async (message, args) => {
    if (!args.length) {
      return safeReply(
        message,
        "❌ Ask me a question first."
      );
    }

    await message.reply(
      `🎱 ${pick(EIGHTBALL)}`
    );
  }
);

registerCommand(
  ["coinflip", "coin"],
  "Fun",
  async message => {
    await message.reply(
      `🪙 It landed on **${pick(["Heads", "Tails"])}**, sir.`
    );
  }
);

registerCommand(
  ["dice"],
  "Fun",
  async message => {
    const value =
      Math.floor(Math.random() * 6) + 1;

    await message.reply(
      `🎲 You rolled a **${value}**.`
    );
  }
);

registerCommand(
  ["roll"],
  "Fun",
  async (message, args) => {
    const match =
      (args[0] || "1d6")
        .match(/^(\d+)d(\d+)$/i);

    if (!match) {
      return safeReply(
        message,
        "❌ Example: `jarvis roll 2d6`"
      );
    }

    const count = Math.min(
      Number(match[1]),
      20
    );

    const sides = Math.min(
      Number(match[2]),
      1000
    );

    if (count < 1 || sides < 2) {
      return safeReply(
        message,
        "❌ Invalid dice."
      );
    }

    const rolls =
      Array.from(
        {
          length: count
        },
        () =>
          Math.floor(
            Math.random() * sides
          ) + 1
      );

    const total =
      rolls.reduce(
        (sum, value) =>
          sum + value,
        0
      );

    await message.reply(
      `🎲 Rolls: **${rolls.join(", ")}**\nTotal: **${total}**`
    );
  }
);

registerCommand(
  ["rps"],
  "Fun",
  async (message, args) => {
    const choices = [
      "rock",
      "paper",
      "scissors"
    ];

    const userChoice =
      args[0]?.toLowerCase();

    if (!choices.includes(userChoice)) {
      return safeReply(
        message,
        "❌ Choose `rock`, `paper`, or `scissors`."
      );
    }

    const botChoice =
      pick(choices);

    let result;

    if (
      userChoice === botChoice
    ) {
      result = "It's a tie, sir!";
    } else if (
      (userChoice === "rock" &&
        botChoice === "scissors") ||
      (userChoice === "paper" &&
        botChoice === "rock") ||
      (userChoice === "scissors" &&
        botChoice === "paper")
    ) {
      result = "You win, sir!";
    } else {
      result = "I win this round, sir.";
    }

    await message.reply(
      `🪨📄✂️ You chose **${userChoice}**. I chose **${botChoice}**.\n${result}`
    );
  }
);

registerCommand(
  ["choose", "pick"],
  "Fun",
  async (message, args) => {
    const options =
      args.join(" ")
        .split("|")
        .map(x => x.trim())
        .filter(Boolean);

    if (options.length < 2) {
      return safeReply(
        message,
        "❌ Give me at least two options separated by `|`."
      );
    }

    await message.reply(
      `🤔 After careful consideration, sir...\n\nI choose **${pick(options)}**.`
    );
  }
);

registerCommand(
  ["joke"],
  "Fun",
  async message => {
    await message.reply(
      `😄 ${pick(JOKES)}`
    );
  }
);

registerCommand(
  ["fact"],
  "Fun",
  async message => {
    await message.reply(
      `📚 **Interesting fact:**\n${pick(FACTS)}`
    );
  }
);

registerCommand(
  ["quote"],
  "Fun",
  async message => {
    await message.reply(
      `💬 ${pick(QUOTES)}`
    );
  }
);

registerCommand(
  ["wyr"],
  "Fun",
  async message => {
    await message.reply(
      `🤷 ${pick(WYR)}`
    );
  }
);

registerCommand(
  ["rate"],
  "Fun",
  async (message, args) => {
    const thing =
      args.join(" ");

    if (!thing) {
      return safeReply(
        message,
        "❌ Tell me what to rate."
      );
    }

    const score =
      Math.floor(
        Math.random() * 11
      );

    await message.reply(
      `📊 I would rate **${thing}** a **${score}/10**, sir.`
    );
  }
);

registerCommand(
  ["ship"],
  "Fun",
  async message => {
    const users =
      [...message.mentions.users.values()];

    if (users.length < 2) {
      return safeReply(
        message,
        "❌ Mention two users."
      );
    }

    const [a, b] =
      users.slice(0, 2);

    const percentage =
      Math.floor(
        Math.random() * 101
      );

    await message.reply(
      `💘 **${a.username} + ${b.username}**\nCompatibility: **${percentage}%**`
    );
  }
);

registerCommand(
  ["hug"],
  "Fun",
  async message => {
    const user =
      message.mentions.users.first();

    if (!user) {
      return safeReply(
        message,
        "❌ Mention someone."
      );
    }

    await message.reply(
      `🤗 ${message.author} gives ${user} a warm hug.`
    );
  }
);

registerCommand(
  ["slap"],
  "Fun",
  async message => {
    const user =
      message.mentions.users.first();

    if (!user) {
      return safeReply(
        message,
        "❌ Mention someone."
      );
    }

    await message.reply(
      `👋 ${message.author} slaps ${user} with a highly sophisticated fish.`
    );
  }
);

registerCommand(
  ["pat"],
  "Fun",
  async message => {
    const user =
      message.mentions.users.first();

    if (!user) {
      return safeReply(
        message,
        "❌ Mention someone."
      );
    }

    await message.reply(
      `🤚 ${message.author} pats ${user} gently.`
    );
  }
);

registerCommand(
  ["compliment"],
  "Fun",
  async message => {
    const user =
      message.mentions.users.first() ||
      message.author;

    await message.reply(
      `✨ ${user}, ${pick(COMPLIMENTS)}`
    );
  }
);

registerCommand(
  ["roast"],
  "Fun",
  async message => {
    const user =
      message.mentions.users.first() ||
      message.author;

    await message.reply(
      `🔥 ${user} — ${pick(ROASTS)}`
    );
  }
);

registerCommand(
  ["reverse"],
  "Fun",
  async (message, args) => {
    const text =
      args.join(" ");

    if (!text) {
      return safeReply(
        message,
        "❌ Give me text to reverse."
      );
    }

    await message.reply(
      `🔄 ${text.split("").reverse().join("")}`
    );
  }
);

registerCommand(
  ["mock"],
  "Fun",
  async (message, args) => {
    const text =
      args.join(" ");

    if (!text) {
      return safeReply(
        message,
        "❌ Give me text to mock."
      );
    }

    let result = "";

    for (const char of text) {
      result +=
        Math.random() > 0.5
          ? char.toUpperCase()
          : char.toLowerCase();
    }

    await message.reply(
      `🗣️ ${result}`
    );
  }
);

registerCommand(
  ["game", "games"],
  "Fun",
  async message => {
    await message.reply(
      "🎮 **JARVIS GAME CENTER**\n\n" +
      "`jarvis 8ball`\n" +
      "`jarvis coinflip`\n" +
      "`jarvis dice`\n" +
      "`jarvis roll 2d6`\n" +
      "`jarvis rps rock`\n" +
      "`jarvis choose pizza | burger`\n" +
      "`jarvis wyr`"
    );
  }
);

registerCommand(
  ["truth"],
  "Fun",
  async message => {
    const truths = [
      "What's the most embarrassing thing you've done recently?",
      "What's a secret talent you have?",
      "What's the weirdest thing you believe?",
      "Who was your first fictional crush?",
      "What's the last thing you searched for?"
    ];

    await message.reply(
      `🧠 **Truth:** ${pick(truths)}`
    );
  }
);

registerCommand(
  ["dare"],
  "Fun",
  async message => {
    const dares = [
      "Change your nickname for 10 minutes.",
      "Send the last emoji you used.",
      "Say something nice about someone here.",
      "Type your next message backwards.",
      "Send a completely random GIF."
    ];

    await message.reply(
      `😈 **Dare:** ${pick(dares)}`
    );
  }
);

registerCommand(
  ["complimentme"],
  "Fun",
  async message => {
    await message.reply(
      `✨ Sir, you ${pick(COMPLIMENTS)}`
    );
  }
);

// ============================================================
// EXTRA INTERACTIVE COMMANDS
// ============================================================

registerCommand(
  ["hugall"],
  "Social",
  async message => {
    await message.reply(
      `🤗 JARVIS has deployed a server-wide hug to everyone.`
    );
  }
);

registerCommand(
  ["highfive"],
  "Social",
  async message => {
    const user =
      message.mentions.users.first();

    if (!user) {
      return safeReply(
        message,
        "❌ Mention someone."
      );
    }

    await message.reply(
      `✋ ${message.author} high-fives ${user}!`
    );
  }
);

registerCommand(
  ["wave"],
  "Social",
  async message => {
    const user =
      message.mentions.users.first();

    if (!user) {
      return safeReply(
        message,
        "❌ Mention someone."
      );
    }

    await message.reply(
      `👋 ${message.author} waves at ${user}.`
    );
  }
);

registerCommand(
  ["bonk"],
  "Fun",
  async message => {
    const user =
      message.mentions.users.first() ||
      message.author;

    await message.reply(
      `🔨 ${user}, bonk.`
    );
  }
);

registerCommand(
  ["dance"],
  "Fun",
  async message => {
    await message.reply(
      pick([
        "🕺 JARVIS performs an extremely sophisticated robotic dance.",
        "💃 Initiating dance protocols.",
        "🕺 Sir, I believe this is what humans call 'vibing'.",
        "🤖 *robotic dancing intensifies*"
      ])
    );
  }
);

registerCommand(
  ["sing"],
  "Fun",
  async message => {
    await message.reply(
      "🎤 I would sing, sir, but my vocal cords are somewhat theoretical."
    );
  }
);

registerCommand(
  ["coffee"],
  "Fun",
  async message => {
    await message.reply(
      "☕ Coffee protocol initiated. One cup for you, sir."
    );
  }
);

registerCommand(
  ["motivate", "motivation"],
  "Fun",
  async message => {
    await message.reply(
      pick([
        "💪 You've got this, sir. One step at a time.",
        "🔥 Stop waiting for the perfect moment. Make the moment perfect.",
        "⚡ Progress is progress, sir.",
        "🫡 I believe you're capable of more than you think."
      ])
    );
  }
);

// ============================================================
// WELCOME SYSTEM
// ============================================================

client.on(
  Events.GuildMemberAdd,
  async member => {
    try {
      const config =
        getConfig(member.guild.id);

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
          .setTitle(
            "👋 Welcome to the server!"
          )
          .setDescription(text)
          .setThumbnail(
            member.user.displayAvatarURL({
              size: 256
            })
          )
          .setColor(0x00aeff)
          .setTimestamp()
          .setFooter({
            text: "JARVIS welcome protocol"
          });

      await channel.send({
        embeds: [embed]
      });

      await sendLog(
        member.guild,
        `👋 **${userTag(member.user)}** joined the server.`
      );
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
        `👋 **${userTag(member.user)}** left the server.`
      );
    } catch (error) {
      console.error(
        "[LEAVE ERROR]",
        error
      );
    }
  }
);

// ============================================================
// MESSAGE / JARVIS CHAT ENGINE
// ============================================================

client.on(
  Events.MessageCreate,
  async message => {
    try {
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

      const lower =
        rawContent.toLowerCase();

      // ------------------------------------------------------
      // AFK CLEAR
      // ------------------------------------------------------

      const selfKey =
        afkKey(
          message.guild.id,
          message.author.id
        );

      if (afkStore.has(selfKey)) {
        afkStore.delete(selfKey);

        await safeReply(
          message,
          "👋 Welcome back, sir. I've removed your AFK status."
        );
      }

      // ------------------------------------------------------
      // AFK MENTION DETECTION
      // ------------------------------------------------------

      for (
        const [, mentionedUser]
        of message.mentions.users
      ) {
        const key =
          afkKey(
            message.guild.id,
            mentionedUser.id
          );

        const afk =
          afkStore.get(key);

        if (!afk) continue;

        const minutes =
          Math.floor(
            (Date.now() - afk.since) /
            60000
          );

        await safeReply(
          message,
          `💤 **${mentionedUser.username}** is AFK.\n` +
          `Reason: ${afk.reason}\n` +
          `Away for: ${minutes}m`
        );
      }

      // ------------------------------------------------------
      // CUSTOM PREFIX
      // ------------------------------------------------------

      const config =
        getConfig(message.guild.id);

      const configuredPrefix =
        config.prefix || "jarvis";

      const prefixRegex =
        new RegExp(
          `^${configuredPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+|$)`,
          "i"
        );

      const startsWithPrefix =
        prefixRegex.test(rawContent);

      // ------------------------------------------------------
      // MENTION JARVIS
      // ------------------------------------------------------

      const mentionedBot =
        message.mentions.has(
          client.user.id
        );

      // ------------------------------------------------------
      // DIRECT COMMAND
      // ------------------------------------------------------

      if (startsWithPrefix) {
        const input =
          rawContent
            .replace(prefixRegex, "")
            .trim();

        if (!input) {
          await safeReply(
            message,
            pick(JARVIS_RESPONSES.idle)
          );

          return;
        }

        const parts =
          input.split(/\s+/);

        const commandName =
          parts.shift().toLowerCase();

        const args = parts;

        const command =
          textCommands[commandName];

        if (command) {
          try {
            config.commandUsage =
              (config.commandUsage || 0) + 1;

            saveConfig(
              message.guild.id,
              config
            );

            console.log(
              `[COMMAND] ${message.author.tag} -> ${commandName}`
            );

            await command.handler(
              message,
              args
            );
          } catch (error) {
            console.error(
              `[COMMAND ERROR] ${commandName}`,
              error
            );

            await safeReply(
              message,
              "❌ JARVIS encountered an error executing that command, sir."
            );
          }

          return;
        }

        // ----------------------------------------------------
        // CONVERSATIONAL JARVIS
        // ----------------------------------------------------

        if (
          config.chatEnabled &&
          config.autoReplies
        ) {
          const response =
            matchAutoReply(input);

          if (response) {
            await safeReply(
              message,
              response
            );

            return;
          }
        }

        await safeReply(
          message,
          `I'm afraid I don't recognize **${commandName}**, sir.\nTry \`${configuredPrefix} help\`.`
        );

        return;
      }

      // ------------------------------------------------------
      // "HELLO JARVIS"
      // "HEY JARVIS"
      // "JARVIS HOW ARE YOU"
      // ------------------------------------------------------

      const containsJarvis =
        /\bjarvis\b/i.test(
          lower
        );

      if (
        containsJarvis ||
        mentionedBot
      ) {
        if (
          !config.chatEnabled ||
          !config.autoReplies
        ) {
          return;
        }

        // Remove mention from text
        let conversationalText =
          rawContent
            .replace(
              new RegExp(
                `<@!?${client.user.id}>`,
                "g"
              ),
              ""
            )
            .trim();

        const response =
          matchAutoReply(
            conversationalText ||
            rawContent
          );

        if (response) {
          await safeReply(
            message,
            response
          );

          return;
        }

        // If someone simply says "Jarvis"
        if (
          conversationalText
            .replace(
              /\bjarvis\b/gi,
              ""
            )
            .trim()
            .length === 0
        ) {
          await safeReply(
            message,
            pick(JARVIS_RESPONSES.idle)
          );

          return;
        }

        // Smart fallback
        await safeReply(
          message,
          pick([
            "I'm listening, sir.",
            "Yes, sir?",
            "I hear you, sir. How may I assist?",
            "At your service.",
            "Go ahead, sir."
          ])
        );
      }
    } catch (error) {
      console.error(
        "[MESSAGE ENGINE ERROR]",
        error
      );
    }
  }
);

// ============================================================
// SLASH COMMAND SUPPORT
// ============================================================

const commandsPath =
  path.join(
    __dirname,
    "commands"
  );

if (
  fs.existsSync(commandsPath)
) {
  for (
    const file
    of fs
      .readdirSync(commandsPath)
      .filter(
        file =>
          file.endsWith(".js")
      )
  ) {
    try {
      const command =
        require(
          path.join(
            commandsPath,
            file
          )
        );

      if (
        command.data &&
        command.data.name
      ) {
        client.commands.set(
          command.data.name,
          command
        );

        console.log(
          `[SLASH COMMAND LOADED] ${command.data.name}`
        );
      }
    } catch (error) {
      console.error(
        `[SLASH COMMAND LOAD ERROR] ${file}`,
        error
      );
    }
  }
}

client.on(
  Events.InteractionCreate,
  async interaction => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    const command =
      client.commands.get(
        interaction.commandName
      );

    if (!command) {
      return;
    }

    try {
      await command.execute(
        interaction,
        {
          getConfig,
          saveConfig
        }
      );
    } catch (error) {
      console.error(
        "[SLASH COMMAND ERROR]",
        error
      );

      const reply = {
        content:
          "❌ JARVIS encountered an error executing that command.",
        ephemeral: true
      };

      try {
        if (
          interaction.replied ||
          interaction.deferred
        ) {
          await interaction.followUp(
            reply
          );
        } else {
          await interaction.reply(
            reply
          );
        }
      } catch (replyError) {
        console.error(
          "[SLASH REPLY ERROR]",
          replyError
        );
      }
    }
  }
);

// ============================================================
// DISCORD DIAGNOSTICS
// ============================================================

client.on(
  "debug",
  info => {
    if (
      process.env.JARVIS_DEBUG === "true"
    ) {
      console.log(
        `[DISCORD DEBUG] ${info}`
      );
    }
  }
);

client.on(
  "warn",
  info => {
    console.warn(
      `[DISCORD WARN] ${info}`
    );
  }
);

client.on(
  "error",
  error => {
    console.error(
      "[DISCORD ERROR]",
      error
    );
  }
);

client.on(
  "shardReady",
  id => {
    console.log(
      `[SHARD READY] ${id}`
    );
  }
);

client.on(
  "shardDisconnect",
  (event, id) => {
    console.error(
      `[SHARD DISCONNECT] ${id}`,
      event
    );
  }
);

client.on(
  "shardReconnecting",
  id => {
    console.log(
      `[SHARD RECONNECTING] ${id}`
    );
  }
);

// ============================================================
// READY
// ============================================================

client.once(
  Events.ClientReady,
  bot => {
    console.log("");
    console.log(
      "========================================"
    );
    console.log(
      "        🤖 J.A.R.V.I.S. ONLINE"
    );
    console.log(
      "========================================"
    );
    console.log(
      `USERNAME : ${bot.user.tag}`
    );
    console.log(
      `BOT ID   : ${bot.user.id}`
    );
    console.log(
      `SERVERS  : ${bot.guilds.cache.size}`
    );
    console.log(
      `COMMANDS : ${Object.keys(textCommands).length}`
    );
    console.log(
      `UPTIME   : ${formatUptime(bot.uptime)}`
    );
    console.log(
      "========================================"
    );
    console.log("");

    bot.user.setPresence({
      activities: [
        {
          name: "jarvis help | at your service, sir",
          type: 3
        }
      ],
      status: "online"
    });
  }
);

// ============================================================
// GLOBAL ERROR HANDLERS
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

console.log(
  "========================================"
);

console.log(
  "JARVIS STARTING..."
);

console.log(
  "TOKEN FOUND: YES"
);

console.log(
  "========================================"
);

client.login(
  process.env.DISCORD_TOKEN
);
