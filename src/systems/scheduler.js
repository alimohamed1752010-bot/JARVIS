const fs=require('node:fs'); const path=require('node:path');
function startScheduler(client,getConfig){
  setInterval(async()=>{
    for(const guild of client.guilds.cache.values()){
      const config=getConfig(guild.id); const brief=config.ai?.dailyBriefing;
      if(!brief?.enabled || !brief.channelId) continue;
      const key=`${guild.id}:${new Date().toISOString().slice(0,10)}`;
      if(global.__jarvisBriefing===key) continue;
      const hour=new Date().getHours(); if(hour!==Number(brief.hour??9)) continue;
      global.__jarvisBriefing=key;
      const ch=guild.channels.cache.get(brief.channelId); if(!ch?.isTextBased()) continue;
      await ch.send(`**Good morning, sir.**\nJARVIS daily briefing for **${guild.name}**.\nMembers: **${guild.memberCount}**\nChannels: **${guild.channels.cache.size}**\nSecurity systems: **${config.automod?.enabled?'AutoMod ON':'AutoMod OFF'} / ${config.antiRaid?.enabled?'Anti-Raid ON':'Anti-Raid OFF'}**`).catch(()=>{});
    }
  },60000);
}
module.exports={startScheduler};
