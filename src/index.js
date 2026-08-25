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
  partials: [
    Partials.Channel,
    Partials.Message
  ]
});

client.commands = new Collection();

// ==========================================
// DISCORD DIAGNOSTICS
// ==========================================

client.on("debug", info => {
  console.log(`[DISCORD DEBUG] ${info}`);
});

client.on("warn", info => {
  console.warn(`[DISCORD WARN] ${info}`);
});

client.on("error", error => {
  console.error("[DISCORD ERROR]", error);
});

client.on("shardReady", id => {
  console.log(`[SHARD READY] ${id}`);
});

client.on("shardDisconnect", (event, id) => {
  console.error(`[SHARD DISCONNECT] ${id}`, event);
});

client.on("shardReconnecting", id => {
  console.log(`[SHARD RECONNECTING] ${id}`);
});

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
console.log("MESSAGE CONTENT INTENT: REQUESTED");
console.log("GUILD MESSAGES INTENT: REQUESTED");
console.log("=================================");

// ==========================================
// LOAD COMMANDS
// ==========================================

const commandsPath = path.join(__dirname, "commands");

if (fs.existsSync(commandsPath)) {
  for (const file of fs
    .readdirSync(commandsPath)
    .filter(f => f.endsWith(".js"))) {

    try {
      const command = require(
        path.join(commandsPath, file)
      );

      if (command.data && command.data.name) {
        client.commands.set(
          command.data.name,
          command
        );

        console.log(
          `[COMMAND LOADED] ${command.data.name}`
        );
      }

    } catch (error) {
      console.error(
        `[COMMAND LOAD ERROR] ${file}`,
        error
      );
    }
  }
}

// ==========================================
// CONFIG
// ==========================================

function getConfig(guildId) {

  const file = path.join(
    __dirname,
    "..",
    "data",
    `${guildId}.json`
  );

  if (!fs.existsSync(file)) {

    return {
      welcomeChannelId:
        process.env.WELCOME_CHANNEL_ID || null,

      logChannelId:
        process.env.LOG_CHANNEL_ID || null,

      welcomeMessage:
        process.env.WELCOME_MESSAGE ||
        "Welcome {user} to **{server}**! 🎉"
    };
  }

  try {

    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );

  } catch (error) {

    console.error(
      "[CONFIG ERROR]",
      error
    );

    return {
      welcomeChannelId: null,
      logChannelId: null,
      welcomeMessage:
        "Welcome {user} to **{server}**! 🎉"
    };
  }
}

function saveConfig(guildId, config) {

  const file = path.join(
    __dirname,
    "..",
    "data",
    `${guildId}.json`
  );

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    JSON.stringify(config, null, 2)
  );
}

// ==========================================
// BOT READY
// ==========================================

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
      `CHANNELS: ${bot.channels.cache.size}`
    );
    console.log("MESSAGE CONTENT SYSTEM: READY");
    console.log("=================================");
    console.log("");

    for (const guild of bot.guilds.cache.values()) {

      console.log(
        `[SERVER] ${guild.name} (${guild.id})`
      );
    }

    bot.user.setPresence({
      activities: [
        {
          name: "your server",
          type: 3
        }
      ],
      status: "online"
    });
  }
);

// ==========================================
// INTERACTIONS / SLASH COMMANDS
// ==========================================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isChatInputCommand()) {
      return;
    }

    console.log(
      `[SLASH] ${interaction.user.tag}: /${interaction.commandName}`
    );

    const command =
      client.commands.get(
        interaction.commandName
      );

    if (!command) {
      console.log(
        `[SLASH ERROR] Command not found: ${interaction.commandName}`
      );
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

      } catch (replyError) {

        console.error(
          "[SLASH REPLY ERROR]",
          replyError
        );
      }
    }
  }
);

// ==========================================
// TEXT MESSAGE SYSTEM
// ==========================================

client.on(
  Events.MessageCreate,
  async message => {

    console.log("");
    console.log("=================================");
    console.log("📨 MESSAGE RECEIVED");
    console.log(
      `AUTHOR: ${message.author?.tag}`
    );
    console.log(
      `AUTHOR ID: ${message.author?.id}`
    );
    console.log(
      `CONTENT: "${message.content}"`
    );
    console.log(
      `CHANNEL: ${message.channel?.name || "UNKNOWN"}`
    );
    console.log(
      `CHANNEL ID: ${message.channel?.id}`
    );
    console.log(
      `SERVER: ${message.guild?.name || "DM"}`
    );
    console.log(
      `SERVER ID: ${message.guild?.id || "NONE"}`
    );
    console.log("=================================");

    // Ignore bots
    if (message.author?.bot) {
      console.log("[MESSAGE] Ignored because author is a bot.");
      return;
    }

    // Ignore DMs
    if (!message.guild) {
      console.log("[MESSAGE] Ignored because this is a DM.");
      return;
    }

    const content =
      (message.content || "").trim();

    if (!content) {
      console.log(
        "[MESSAGE] Content is empty."
      );
      return;
    }

    console.log(
      `[MESSAGE CONTENT] ${content}`
    );

    // Must start with JARVIS
    if (
      !content
        .toLowerCase()
        .startsWith("jarvis")
    ) {

      console.log(
        "[MESSAGE] Not a JARVIS command."
      );

      return;
    }

    console.log(
      `[JARVIS COMMAND] ${message.author.tag}: ${content}`
    );

    // Remove "jarvis"
    const input =
      content
        .slice(6)
        .trim();

    // ==========================================
    // JUST "JARVIS"
    // ==========================================

    if (!input) {

      console.log(
        "[JARVIS] Basic response."
      );

      try {

        await message.reply(
          "Yes, sir? 🤖"
        );

        console.log(
          "[JARVIS] Reply sent successfully."
        );

      } catch (error) {

        console.error(
          "[JARVIS REPLY ERROR]",
          error
        );
      }

      return;
    }

    // ==========================================
    // PARSE COMMAND
    // ==========================================

    const args =
      input.split(/\s+/);

    const commandName =
      args.shift().toLowerCase();

    console.log(
      `[JARVIS COMMAND NAME] ${commandName}`
    );

    // ==========================================
    // HELP
    // ==========================================

    if (commandName === "help") {

      await message.reply(
        "**🤖 JARVIS COMMANDS**\n\n" +

        "**Moderation**\n" +
        "`jarvis timeout @user 10m`\n" +
        "`jarvis kick @user`\n" +
        "`jarvis ban @user`\n" +
        "`jarvis clear 10`\n\n" +

        "**Utility**\n" +
        "`jarvis say hello`\n" +
        "`jarvis help`\n\n" +

        "**Chat**\n" +
        "`jarvis hello`\n" +
        "`jarvis good morning`\n" +
        "`jarvis are you there`"
      );

      return;
    }

    // ==========================================
    // TIMEOUT
    // ==========================================

    if (commandName === "timeout") {

      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {

        await message.reply(
          "❌ You don't have permission to timeout members."
        );

        return;
      }

      const member =
        message.mentions.members.first();

      if (!member) {

        await message.reply(
          "❌ Mention the person you want to timeout."
        );

        return;
      }

      const duration =
        args.find(arg =>
          /^\d+(s|m|h|d)$/i.test(arg)
        );

      if (!duration) {

        await message.reply(
          "❌ Tell me the duration.\nExample: `jarvis timeout @user 10m`"
        );

        return;
      }

      const match =
        duration.match(
          /^(\d+)(s|m|h|d)$/i
        );

      const amount =
        parseInt(match[1], 10);

      const unit =
        match[2].toLowerCase();

      const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
      };

      const durationMs =
        amount * multipliers[unit];

      if (
        durationMs >
        28 * 24 * 60 * 60 * 1000
      ) {

        await message.reply(
          "❌ Discord only allows timeouts up to 28 days."
        );

        return;
      }

      if (!member.moderatable) {

        await message.reply(
          "❌ I can't timeout that member. Check Jarvis's role position."
        );

        return;
      }

      try {

        await member.timeout(
          durationMs,
          `JARVIS command by ${message.author.tag}`
        );

        await message.reply(
          `⏱️ **${member.user.tag}** has been timed out for **${duration}**.`
        );

      } catch (error) {

        console.error(
          "[TIMEOUT ERROR]",
          error
        );

        await message.reply(
          "❌ I couldn't timeout that member."
        );
      }

      return;
    }

    // ==========================================
    // KICK
    // ==========================================

    if (commandName === "kick") {

      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.KickMembers
        )
      ) {

        await message.reply(
          "❌ You don't have permission to kick members."
        );

        return;
      }

      const member =
        message.mentions.members.first();

      if (!member) {

        await message.reply(
          "❌ Mention the person you want to kick."
        );

        return;
      }

      if (!member.kickable) {

        await message.reply(
          "❌ I can't kick that member."
        );

        return;
      }

      try {

        await member.kick(
          `JARVIS command by ${message.author.tag}`
        );

        await message.reply(
          `👢 **${member.user.tag}** has been kicked.`
        );

      } catch (error) {

        console.error(
          "[KICK ERROR]",
          error
        );

        await message.reply(
          "❌ I couldn't kick that member."
        );
      }

      return;
    }

    // ==========================================
    // BAN
    // ==========================================

    if (commandName === "ban") {

      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.BanMembers
        )
      ) {

        await message.reply(
          "❌ You don't have permission to ban members."
        );

        return;
      }

      const member =
        message.mentions.members.first();

      if (!member) {

        await message.reply(
          "❌ Mention the person you want to ban."
        );

        return;
      }

      if (!member.bannable) {

        await message.reply(
          "❌ I can't ban that member."
        );

        return;
      }

      try {

        await member.ban({
          reason:
            `JARVIS command by ${message.author.tag}`
        });

        await message.reply(
          `🔨 **${member.user.tag}** has been banned.`
        );

      } catch (error) {

        console.error(
          "[BAN ERROR]",
          error
        );

        await message.reply(
          "❌ I couldn't ban that member."
        );
      }

      return;
    }

    // ==========================================
    // CLEAR
    // ==========================================

    if (commandName === "clear") {

      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {

        await message.reply(
          "❌ You don't have permission to delete messages."
        );

        return;
      }

      const amount =
        parseInt(args[0], 10);

      if (
        !amount ||
        amount < 1 ||
        amount > 100
      ) {

        await message.reply(
          "❌ Use a number from 1 to 100."
        );

        return;
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
          () =>
            reply.delete().catch(() => {}),
          3000
        );

      } catch (error) {

        console.error(
          "[CLEAR ERROR]",
          error
        );

        await message.reply(
          "❌ I couldn't delete those messages."
        );
      }

      return;
    }

    // ==========================================
    // SAY
    // ==========================================

    if (commandName === "say") {

      if (
        !message.member.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {

        await message.reply(
          "❌ You don't have permission to use this command."
        );

        return;
      }

      const text =
        args.join(" ");

      if (!text) {

        await message.reply(
          "❌ Tell me what to say."
        );

        return;
      }

      await message.delete()
        .catch(() => {});

      await message.channel.send(text);

      return;
    }

    // ==========================================
    // AUTO REPLIES
    // ==========================================

    const lower =
      input.toLowerCase();

    if (
      lower === "hello" ||
      lower === "hi" ||
      lower === "hey"
    ) {

      await message.reply(
        "Hello, sir. At your service. 🤖"
      );

      return;
    }

    if (
      lower.includes("good morning")
    ) {

      await message.reply(
        "Good morning, sir. ☕"
      );

      return;
    }

    if (
      lower.includes("thank you") ||
      lower.includes("thanks")
    ) {

      await message.reply(
        "You're welcome, sir. 🫡"
      );

      return;
    }

    if (
      lower.includes("are you alive") ||
      lower.includes("are you there")
    ) {

      await message.reply(
        "Always. I'm watching the server. 👁️"
      );

      return;
    }

    // ==========================================
    // UNKNOWN COMMAND
    // ==========================================

    await message.reply(
      `I don't know **${commandName}** yet. Try \`jarvis help\`.`
    );
  }
);

// ==========================================
// WELCOME SYSTEM
// ==========================================

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
          .setTitle("Welcome!")
          .setDescription(text)
          .setThumbnail(
            member.user.displayAvatarURL({
              size: 256
            })
          )
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

// ==========================================
// LEAVE LOG
// ==========================================

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

// ==========================================
// GLOBAL ERROR HANDLERS
// ==========================================

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

// ==========================================
// LOGIN
// ==========================================

console.log("Connecting to Discord Gateway...");

client.login(
  process.env.DISCORD_TOKEN
)
  .then(() => {
    console.log(
      "Discord login request completed."
    );
  })
  .catch(error => {

    console.error(
      "❌ DISCORD LOGIN FAILED",
      error
    );

    process.exit(1);
  });
