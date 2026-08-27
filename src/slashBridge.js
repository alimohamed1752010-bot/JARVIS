const { SlashCommandBuilder, PermissionFlagsBits, Collection } = require('discord.js');

function uniquePrimaryCommands(textCommands) {
  const seen = new Set();
  const result = [];
  for (const command of Object.values(textCommands || {})) {
    const name = String(command.primary || '').toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({ name, ...command });
  }
  return result;
}

function buildDynamicDefinitions(textCommands, reservedNames = new Set(), excludedNames = new Set()) {
  return uniquePrimaryCommands(textCommands)
    .filter(c => !reservedNames.has(c.name) && !excludedNames.has(c.name))
    .map(c => new SlashCommandBuilder()
      .setName(c.name)
      .setDescription(String(c.description || `Run JARVIS ${c.name}.`).slice(0, 100))
      .addStringOption(o => o.setName('args').setDescription('Same arguments used by the jarvis command.').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false)
      .toJSON());
}

function parseMentionArgs(text, guild) {
  const users = new Collection();
  const roles = new Collection();
  const channels = new Collection();
  const source = String(text || '');
  for (const m of source.matchAll(/<@!?(\d+)>/g)) {
    const member = guild?.members?.cache?.get(m[1]);
    if (member) users.set(member.id, member.user);
  }
  for (const m of source.matchAll(/<@&(\d+)>/g)) {
    const role = guild?.roles?.cache?.get(m[1]);
    if (role) roles.set(role.id, role);
  }
  for (const m of source.matchAll(/<#(\d+)>/g)) {
    const channel = guild?.channels?.cache?.get(m[1]);
    if (channel) channels.set(channel.id, channel);
  }
  return { users, roles, channels };
}

function createMessageAdapter(interaction, argsText = '') {
  const mentions = parseMentionArgs(argsText, interaction.guild);
  const content = `jarvis ${interaction.commandName}${argsText ? ` ${argsText}` : ''}`;
  let replied = false;
  return {
    id: interaction.id,
    content,
    guild: interaction.guild,
    member: interaction.member,
    author: interaction.user,
    channel: interaction.channel,
    client: interaction.client,
    mentions,
    attachments: interaction.options?.getAttachment ? new Collection() : new Collection(),
    createdAt: new Date(),
    async reply(payload) {
      replied = true;
      if (typeof payload === 'string') payload = { content: payload };
      if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
      return interaction.reply(payload);
    },
    get replied() { return replied || interaction.replied || interaction.deferred; },
    async delete() { return null; }
  };
}

async function executeDynamic(interaction, command) {
  const argsText = interaction.options.getString('args') || '';
  const args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
  const message = createMessageAdapter(interaction, argsText);
  await command.handler(message, args);
}

module.exports = { buildDynamicDefinitions, executeDynamic, createMessageAdapter };
