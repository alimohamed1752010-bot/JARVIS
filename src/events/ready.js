const { ActivityType } = require('discord.js');
const { clientState } = require('../state');
module.exports = client => {
  console.log(`JARVIS online as ${client.user.tag}`);
  let i = 0;
  const statuses = [() => `Protecting ${client.guilds.cache.size} servers`, () => 'Monitoring security', () => `${client.commands.size || 0} systems available`, () => 'At your service, sir.'];
  const update = () => { const text = statuses[i++ % statuses.length](); client.user.setPresence({ activities: [{ name: text, type: ActivityType.Watching }], status: 'online' }); };
  update(); setInterval(update, 30000).unref(); clientState.client = client;
};
