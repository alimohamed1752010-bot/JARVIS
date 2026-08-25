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

const commandsPath = path.join(__dirname, "commands");

for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
  const command = require(path.join(commandsPath, file));

  if (command.data && command.data.name) {
    client.commands.set(command.data.name, command);
  }
}

function getConfig(guildId) {
  const file = path.join(__dirname, "..", "data", `${guildId}.json`);

  if (!fs.existsSync(file)) {
    return {
      welcomeChannelId: process.env.WELCOME_CHANNEL_ID || null,
      logChannelId: process.env.LOG_CHANNEL_ID || null,
      welcomeMessage:
        process.env.WELCOME_MESSAGE ||
        "Welcome {user} to **{server}**! 🎉"
    };
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveConfig(guildId, config) {
  const file = path.join(__dirname, "..", "data", `${guildId}.json`);

  fs.mkdirSync(path.dirname(file), { recursive: true });

  fs.writeFileSync(
    file,
    JSON.stringify(config, null, 2)
  );
}


// ==========================================
// BOT ONLINE
// ==========================================

client.once(Events.ClientReady, bot => {
  console.log("=================================");
  console.log(`JARVIS ONLINE: ${bot.user.tag}`);
  console.log(`BOT ID: ${bot.user.id}`);
  console.log("MESSAGE CONTENT SYSTEM: READY");
  console.log("=================================");

  bot.user.setPresence({
    activities: [
      {
        name: "your server",
        type: 3
      }
    ],
    status: "online"
  });
});


// ==========================================
// SLASH COMMANDS
// ==========================================

client.on(Events.InteractionCreate, async interaction => {

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(
    interaction.commandName
  );

  if (!command) return;

  try {

    await command.execute(
      interaction,
      {
        getConfig,
        saveConfig
      }
    );

  } catch (error) {

    console.error("SLASH COMMAND ERROR:", error);

    const reply = {
      content:
        "❌ JARVIS encountered an error while executing that command.",
      ephemeral: true
    };

    if (
      interaction.replied ||
      interaction.deferred
    ) {

      await interaction.followUp(reply);

    } else {

      await interaction.reply(reply);

    }
  }
});


// ==========================================
// TEXT COMMAND SYSTEM
// ==========================================

client.on(Events.MessageCreate, async message => {

  // LOG EVERY MESSAGE JARVIS RECEIVES
  console.log(
    `[MESSAGE] ${message.author.tag}: ${message.content}`
  );

  // Ignore bots
  if (message.author.bot) return;

  // Ignore DMs
  if (!message.guild) return;

  const content = message.content.trim();

  // Must start with "jarvis"
  if (!content.toLowerCase().startsWith("jarvis")) {
    return;
  }

  console.log(
    `[JARVIS COMMAND] ${message.author.tag}: ${content}`
  );

  // Remove "jarvis"
  const input = content
    .slice(6)
    .trim();

  // ==========================================
  // JUST "JARVIS"
  // ==========================================

  if (!input) {

    await message.reply(
      "Yes, sir? 🤖"
    );

    return;
  }

  // Split command
  const args = input.split(/\s+/);

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

    // Discord maximum = 28 days
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
        "TIMEOUT ERROR:",
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
        "KICK ERROR:",
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
        "BAN ERROR:",
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
        () => reply.delete().catch(() => {}),
        3000
      );

    } catch (error) {

      console.error(
        "CLEAR ERROR:",
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

    await message.delete().catch(() => {});

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

});


// ==========================================
// WELCOME SYSTEM
// ==========================================

client.on(Events.GuildMemberAdd, async member => {

  const config =
    getConfig(member.guild.id);

  if (!config.welcomeChannelId) return;

  const channel =
    member.guild.channels.cache.get(
      config.welcomeChannelId
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) return;

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

  await channel
    .send({
      embeds: [embed]
    })
    .catch(console.error);
});


// ==========================================
// LEAVE LOG
// ==========================================

client.on(
  Events.GuildMemberRemove,
  async member => {

    const config =
      getConfig(member.guild.id);

    if (!config.logChannelId) return;

    const channel =
      member.guild.channels.cache.get(
        config.logChannelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) return;

    await channel
      .send(
        `👋 **${member.user.tag}** left the server.`
      )
      .catch(console.error);
  }
);


// ==========================================
// LOGIN
// ==========================================

client.login(
  process.env.DISCORD_TOKEN
);
