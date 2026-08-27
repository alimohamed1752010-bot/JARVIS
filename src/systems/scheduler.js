function cairoHour(){return Number(new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',hour:'2-digit',hour12:false}).format(new Date()));}
function cairoDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function startScheduler(client,getConfig){setInterval(async()=>{for(const guild of client.guilds.cache.values()){const config=getConfig(guild.id);const brief=config.ai?.dailyBriefing;if(!brief?.enabled||!brief.channelId)continue;const key=`${guild.id}:${cairoDate()}`;global.__jarvisBriefings??=new Set();if(global.__jarvisBriefings.has(key))continue;if(cairoHour()!==Number(brief.hour??9))continue;const ch=guild.channels.cache.get(brief.channelId);if(!ch?.isTextBased()){global.__jarvisBriefings.add(key);continue;}global.__jarvisBriefings.add(key);const warnings=Object.values(config.warnings||{}).reduce((n,x)=>n+x.length,0);await ch.send(`**Good morning, sir.** ☀️\n\n**JARVIS Daily Intelligence Briefing — ${guild.name}**\n• Members: **${guild.memberCount}**\n• Channels: **${guild.channels.cache.size}**\n• Moderation cases: **${config.cases?.length||0}**\n• Warnings: **${warnings}**\n• AutoMod: **${config.automod?.enabled?'ONLINE':'OFFLINE'}**\n• Anti-Raid: **${config.antiRaid?.enabled?'ONLINE':'OFFLINE'}**\n• Lockdown: **${config.lockdown?'ACTIVE':'CLEAR'}**`).catch(()=>{});}},60000);}

// V11: generalized recurring-job scheduler. The daily briefing above is left exactly
// as it was in V10 — this is a second, independent interval that runs arbitrary
// admin-defined jobs from config.v9.scheduledJobs (currently type 'message': a plain
// recurring text post at a given Cairo hour, in a given channel, once per day).
// Nothing about the existing briefing feature changes; this just adds a general
// mechanism next to it so future job types don't need a bespoke loop each time.
function startJobScheduler(client,getConfig,saveConfig){
  setInterval(async()=>{
    for(const guild of client.guilds.cache.values()){
      const config=getConfig(guild.id);
      const jobs=config.v9?.scheduledJobs;
      if(!jobs?.length)continue;
      let changed=false;
      for(const job of jobs){
        if(!job.enabled)continue;
        const key=`${guild.id}:${job.id}:${cairoDate()}`;
        global.__jarvisJobs??=new Set();
        if(global.__jarvisJobs.has(key))continue;
        if(cairoHour()!==Number(job.hour??9))continue;
        const ch=guild.channels.cache.get(job.channelId);
        global.__jarvisJobs.add(key);
        if(!ch?.isTextBased())continue;
        if(job.type==='message'){
          await ch.send(`⏰ **JARVIS Scheduled Message**\n${job.message}`).catch(()=>{});
          job.lastRunAt=new Date().toISOString();
          changed=true;
        }
      }
      if(changed)saveConfig(guild.id,config);
    }
  },60000);
}

module.exports={startScheduler,startJobScheduler};
