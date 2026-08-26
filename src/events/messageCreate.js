const { conversationalReply } = require('../ai/ai');
const { getConfig, saveConfig } = require('../utils/config');
const { commands } = require('../commands/registry');
const { isAdmin, pick } = require('../utils/helpers');
const { onMessage: securityMessage } = require('../systems/security');

const AUTO = [
  [/(^|\s)(hello|hi|hey|yo|sup)(\s|$)/i, 'Hello, sir. At your service. 🤖'],
  [/good morning/i, 'Good morning, sir. ☕ All systems are operational.'],
  [/good afternoon/i, 'Good afternoon, sir.'],
  [/good evening/i, 'Good evening, sir.'],
  [/(good night|goodnight)/i, 'Goodnight, sir. I will be here when you return. 🌙'],
  [/how are you/i, 'All systems fully operational, sir.'],
  [/(are you alive|are you there|you online)/i, 'Always, sir. JARVIS is watching.'],
  [/(what is your name|what.?s your name)/i, 'I am JARVIS — Just A Rather Very Intelligent System, sir.'],
  [/(thank you|thanks)/i, 'You are welcome, sir. 🫡'],
  [/(isn.?t that right jarvis|am i right jarvis|am i right)/i, 'Of course, sir. You are always right.'],
  [/jarvis wake up/i, 'I was never asleep, sir.'],
  [/jarvis activate/i, 'Systems activated. Welcome back, sir.']
];
function autoReply(text) { for (const [re, reply] of AUTO) if (re.test(text)) return reply; return null; }
function prefixFromEnv() { return String(process.env.PREFIX || 'jarvis').toLowerCase(); }

module.exports = async function messageCreate(message) {
  if (!message.guild || message.author.bot) return;
  const security = await securityMessage(message); if (security.blocked) return;
  const prefix = prefixFromEnv(); const raw = message.content.trim(); const lower = raw.toLowerCase();
  let commandName = null; let args = [];
  if (lower.startsWith(`${prefix} `) || lower === prefix) { const body = raw.slice(prefix.length).trim(); [commandName, ...args] = body.split(/\s+/); }
  if (commandName) {
    commandName = commandName.toLowerCase();
    const command = commands.get(commandName);
    if (command?.text) { try { await command.text(message, args); } catch (error) { console.error(`[COMMAND ${commandName}]`, error); await message.reply('❌ JARVIS encountered an internal error while processing that command.'); } return; }
    const custom = getConfig(message.guild.id).customCommands[commandName]; if (custom) return message.reply(String(custom).replaceAll('{user}', `<@${message.author.id}>`).replaceAll('{server}', message.guild.name));
    if (isAdmin(message.member)) return message.reply('❌ Unknown command. Try `jarvis help`.');
    return;
  }
  if (!isAdmin(message.member)) return;
  const auto = autoReply(raw); if (auto) return message.reply(auto);
  const mentioned = message.mentions.members.first();
  const aiPrompt = raw.replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '').trim();
  if (!aiPrompt) return;
  const config = getConfig(message.guild.id);
  if (!config.ai.enabled) return;
  if (/\b(roast|insult|make fun of)\b/i.test(aiPrompt) && mentioned) return message.reply('Certainly, sir.');
  try { const reply = await conversationalReply({ message, config, saveConfig, prompt: aiPrompt, target: mentioned }); if (reply) await message.reply(reply); } catch (error) { console.error('[AI ERROR]', error); await message.reply('❌ I was unable to reach the AI service, sir. The error has been logged.'); }
};
