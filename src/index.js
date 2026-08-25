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
      welcomeMessage: process.env.WELCOME_MESSAGE || "Welcome {user} to **{server}**! 🎉"
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

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, { getConfig, saveConfig });
  } catch (error) {
    console.error(error);
    const reply = { content: "JARVIS encountered an error while executing that command.", ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
    else await interaction.reply(reply);
  }
});

client.on(Events.GuildMemberAdd, async member => {
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

  await channel.send({ embeds: [embed] }).catch(console.error);
});

client.on(Events.GuildMemberRemove, async member => {
  const config = getConfig(member.guild.id);
  if (!config.logChannelId) return;
  const channel = member.guild.channels.cache.get(config.logChannelId);
  if (!channel || !channel.isTextBased()) return;

  await channel.send(`👋 **${member.user.tag}** left the server.`).catch(console.error);
});

client.login(process.env.DISCORD_TOKEN);