const { Collection } = require('discord.js');
const commands = new Collection();
function register(name, data) { commands.set(name, { name, ...data }); return commands.get(name); }
function registerAliases(names, data) { for (const n of names) register(n, { ...data, primary: names[0] }); }
module.exports = { commands, register, registerAliases };
