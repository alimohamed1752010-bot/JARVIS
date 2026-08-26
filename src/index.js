require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials, Events, AuditLogEvent } = require('discord.js');
const { getAIStatus } = require('./ai/ai');
const { clientState } = require('./state');
require('./commands/load');
const { commands } = require('./commands/registry');
const messageCreate = require('./events/messageCreate');
const guildMemberAdd = require('./events/guildMemberAdd');
const interactionCreate = require('./events/interactionCreate');
const ready = require('./events/ready');
const { onAuditLogEntry } = require('./systems/security');

if (!process.env.DISCORD_TOKEN) { console.error('❌ DISCORD_TOKEN IS MISSING!'); process.exit(1); }
const client = new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildModeration], partials:[Partials.Channel,Partials.Message] });
client.commands = new Collection(commands);
clientState.client = client;

const ai = getAIStatus();
console.log(`[AI CONFIG] enabled=${ai.enabled} configured=${ai.configured} model=${ai.model} key=${ai.keyFormat}`);
console.log(`[JARVIS] Loaded ${commands.size} text commands.`);

client.once(Events.ClientReady, () => ready(client));
client.on(Events.MessageCreate, messageCreate);
client.on(Events.GuildMemberAdd, guildMemberAdd);
client.on(Events.InteractionCreate, interactionCreate);
client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => onAuditLogEntry(entry, guild).catch(e => console.error('[AUDIT]', e)));
client.on('debug', info => process.env.JARVIS_DEBUG === 'true' && console.log(`[DISCORD DEBUG] ${info}`));
client.on('warn', info => console.warn('[DISCORD WARN]', info));
client.on('error', error => console.error('[DISCORD ERROR]', error));
client.on('shardDisconnect', (event,id)=>console.error(`[SHARD DISCONNECT] ${id}`,event?.code||event));
client.on('shardReconnecting', id=>console.warn(`[SHARD RECONNECTING] ${id}`));

process.on('unhandledRejection', error => console.error('[UNHANDLED REJECTION]', error));
process.on('uncaughtException', error => console.error('[UNCAUGHT EXCEPTION]', error));
process.on('SIGTERM', async()=>{console.log('[JARVIS] SIGTERM received. Shutting down.');try{await client.destroy();}finally{process.exit(0);}});
process.on('SIGINT', async()=>{try{await client.destroy();}finally{process.exit(0);}});

client.login(process.env.DISCORD_TOKEN).catch(error => { console.error('[LOGIN ERROR]', error.message); process.exit(1); });
