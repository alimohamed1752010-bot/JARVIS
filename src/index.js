require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder
} = require("discord.js");

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

const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
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
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

client.once(Events.ClientReady, readyClient => {
  console.log(`JARVIS online as ${readyClient.user.tag}`);

  readyClient.user.setPresence({
    activities: [{ name: "your server", type: 3 }],
    status: "online"
  });
});

// ===============================
// SLASH COMMANDS
// ===============================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, { getConfig, saveConfig });
  } catch (error) {
    console.error(error);

    const reply = {
      content: "JARVIS encountered an error while executing that command.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// ===============================
// JARVIS TEXT COMMANDS
// ===============================

client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();

  // Commands must start with "jarvis"
  if (!/^jarvis(?:\s|$)/i.test(content)) return;

  const input = content.replace(/^jarvis\s*/i, "").trim();

  // Just saying "jarvis"
  if (!input) {
    return message.reply("Yes, sir? 🤖");
  }

  const args = input.split(/\s+/);
  const commandName = args.shift().toLowerCase();

  // ===============================
  // HELP
  // ===============================

  if (commandName === "help") {
    return message.reply(
      "**🤖 JARVIS COMMANDS**\n\n" +
      "`jarvis help` — Show this menu\n" +
      "`jarvis timeout @user 10m` — Timeout a member\n" +
      "`jarvis kick @user` — Kick a member\n" +
      "`jarvis ban @user` — Ban a member\n" +
      "`jarvis clear 10` — Delete messages\n" +
      "`jarvis say hello` — Make Jarvis speak"
    );
  }

  // ===============================
  // TIMEOUT
  // ===============================

  if (commandName === "timeout") {
    if (!message.member.permissions.has("ModerateMembers")) {
      return message.reply(
        "❌ You don't have permission to timeout members."
      );
    }

    const member = message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention the person you want to timeout."
      );
    }

    const duration = args.find(arg =>
      /^\d+(s|m|h|d)$/i.test(arg)
    );

    if (!duration) {
      return message.reply(
        "❌ Use a duration like `10m`, `2h`, or `1d`."
      );
    }

    const match = duration.match(/^(\d+)(s|m|h|d)$/i);

    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const multipliers = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000
    };

    const durationMs = amount * multipliers[unit];

    // Discord maximum timeout = 28 days
    if (durationMs > 28 * 24 * 60 * 60 * 1000) {
      return message.reply(
        "❌ Discord only allows timeouts up to 28 days."
      );
    }

    if (!member.moderatable) {
      return message.reply(
        "❌ I can't timeout that member."
      );
    }

    try {
      await member.timeout(
        durationMs,
        "JARVIS text command"
      );

      return message.reply(
        `⏱️ **${member.user.tag}** has been timed out for **${duration}**.`
      );
    } catch (error) {
      console.error(error);

      return message.reply(
        "❌ I couldn't timeout that member."
      );
    }
  }

  // ===============================
  // KICK
  // ===============================

  if (commandName === "kick") {
    if (!message.member.permissions.has("KickMembers")) {
      return message.reply(
        "❌ You don't have permission to kick members."
      );
    }

    const member = message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention the person you want to kick."
      );
    }

    if (!member.kickable) {
      return message.reply(
        "❌ I can't kick that member."
      );
    }

    try {
      await member.kick("JARVIS text command");

      return message.reply(
        `👢 **${member.user.tag}** has been kicked.`
      );
    } catch (error) {
      console.error(error);

      return message.reply(
        "❌ I couldn't kick that member."
      );
    }
  }

  // ===============================
  // BAN
  // ===============================

  if (commandName === "ban") {
    if (!message.member.permissions.has("BanMembers")) {
      return message.reply(
        "❌ You don't have permission to ban members."
      );
    }

    const member = message.mentions.members.first();

    if (!member) {
      return message.reply(
        "❌ Mention the person you want to ban."
      );
    }

    if (!member.bannable) {
      return message.reply(
        "❌ I can't ban that member."
      );
    }

    try {
      await member.ban({
        reason: "JARVIS text command"
      });

      return message.reply(
        `🔨 **${member.user.tag}** has been banned.`
      );
    } catch (error) {
      console.error(error);

      return message.reply(
        "❌ I couldn't ban that member."
      );
    }
  }

  // ===============================
  // CLEAR
  // ===============================

  if (commandName === "clear") {
    if (!message.member.permissions.has("ManageMessages")) {
      return message.reply(
        "❌ You don't have permission to delete messages."
      );
    }

    const amount = parseInt(args[0], 10);

    if (!amount || amount < 1 || amount > 100) {
      return message.reply(
        "❌ Choose a number from 1 to 100."
      );
    }

    try {
      const deleted = await message.channel.bulkDelete(
        amount + 1,
        true
      );

      const reply = await message.channel.send(
        `🧹 Deleted **${deleted.size - 1}** messages.`
      );

      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 3000);

    } catch (error) {
      console.error(error);

      return message.reply(
        "❌ I couldn't delete those messages."
      );
    }

    return;
  }

  // ===============================
  // SAY
  // ===============================

  if (commandName === "say") {
    if (!message.member.permissions.has("ManageMessages")) {
      return message.reply(
        "❌ You don't have permission to use this command."
      );
    }

    const text = args.join(" ");

    if (!text) {
      return message.reply(
        "❌ Tell me what to say."
      );
    }

    await message.delete().catch(() => {});

    return message.channel.send(text);
  }

  // ===============================
  // AUTO REPLIES
  // ===============================

  const lower = input.toLowerCase();

  if (
    lower === "hello" ||
    lower === "hi" ||
    lower === "hey"
  ) {
    return message.reply(
      "Hello, sir. At your service. 🤖"
    );
  }

  if (lower.includes("good morning")) {
    return message.reply(
      "Good morning, sir. ☕"
    );
  }

  if (
    lower.includes("thank you") ||
    lower.includes("thanks")
  ) {
    return message.reply(
      "You're welcome, sir. 🫡"
    );
  }

  if (
    lower.includes("are you alive") ||
    lower.includes("are you there")
  ) {
    return message.reply(
      "Always. I'm watching the server. 👁️"
    );
  }

  // Unknown command
  return message.reply(
    `I don't know the command **${commandName}** yet. Try \`jarvis help\`.`
  );
});

// ===============================
// WELCOME SYSTEM
// ===============================

client.on(Events.GuildMemberAdd, async member => {
  const config = getConfig(member.guild.id);

  if (!config.welcomeChannelId) return;

  const channel = member.guild.channels.cache.get(
    config.welcomeChannelId
  );

  if (!channel || !channel.isTextBased()) return;

  const text = (
    config.welcomeMessage ||
    "Welcome {user} to **{server}**! 🎉"
  )
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{server}", member.guild.name);

  const embed = new EmbedBuilder()
    .setTitle("Welcome!")
    .setDescription(text)
    .setThumbnail(
      member.user.displayAvatarURL({ size: 256 })
    )
    .setTimestamp();

  await channel
    .send({ embeds: [embed] })
    .catch(console.error);
});

// ===============================
// LEAVE LOG
// ===============================

client.on(Events.GuildMemberRemove, async member => {
  const config = getConfig(member.guild.id);

  if (!config.logChannelId) return;

  const channel = member.guild.channels.cache.get(
    config.logChannelId
  );

  if (!channel || !channel.isTextBased()) return;

  await channel
    .send(`👋 **${member.user.tag}** left the server.`)
    .catch(console.error);
});

client.login(process.env.DISCORD_TOKEN);
