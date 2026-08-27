require('dotenv').config();
const { REST, Routes } = require('discord.js');
process.env.DEPLOY_ONLY='true';
const { client, textCommands, getDynamicSlashCommands } = require('./index');

const staticCommands=[...client.commands.values()].map(c=>c.data.toJSON());
const dynamicCommands=getDynamicSlashCommands();
const commands=[...staticCommands,...dynamicCommands];
const names=new Set();
for(const command of commands){if(names.has(command.name)) throw new Error(`Duplicate slash command: ${command.name}`);names.add(command.name);command.default_member_permissions='8';command.dm_permission=false;}
if(commands.length>100) throw new Error(`Discord allows at most 100 application commands; generated ${commands.length}.`);

const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
(async()=>{try{console.log(`Registering ${commands.length} JARVIS slash commands (${staticCommands.length} hand-crafted + ${dynamicCommands.length} unified adapters)...`);const route=process.env.GUILD_ID?Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID):Routes.applicationCommands(process.env.CLIENT_ID);await rest.put(route,{body:commands});console.log('✅ JARVIS slash command database deployed successfully.');}catch(error){console.error('❌ Slash deployment failed:',error);process.exitCode=1;}finally{client.destroy();}})();
