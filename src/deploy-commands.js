require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const commands = [];
const { PermissionFlagsBits } = require("discord.js");
const commandsPath = path.join(__dirname, "commands");

for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
  const command = require(path.join(commandsPath, file));
  const json = command.data.toJSON();
  // JARVIS is intentionally administrator-only. This complements the runtime check.
  json.default_member_permissions = PermissionFlagsBits.Administrator.toString();
  json.dm_permission = false;
  commands.push(json);
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} commands...`);

    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log("Guild commands registered.");
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log("Global commands registered.");
    }
  } catch (error) {
    console.error(error);
  }
})();