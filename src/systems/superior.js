const journal = require('../core/journal');
const snapshots = require('../core/snapshots');
const serverBrain = require('../core/serverBrain');

function ensure(config){
  config.v15 ??= {};
  config.v15.watch ??= {enabled:false,channels:[],windowMs:10000,burstThreshold:20,mentionThreshold:8};
  config.v15.scheduledActions ??= [];
  return config.v15;
}

function history(config, limit=10){
  return journal.ensure(config).actionJournal.slice(-Math.max(1,Math.min(Number(limit)||10,30))).reverse();
}

function formatHistory(config, limit=10){
  const rows=history(config,limit);
  if(!rows.length)return '📜 **JARVIS ACTION HISTORY**\nNo recorded actions yet, sir.';
  return `📜 **JARVIS ACTION HISTORY**\n${rows.map(x=>`• **#${x.id}** ${x.status==='UNDONE'?'↩️ ':''}${x.action} — <t:${Math.floor(new Date(x.at).getTime()/1000)}:R>${x.targetId?` — <@${x.targetId}>`:''}${x.reason?` — ${String(x.reason).slice(0,100)}`:''}`).join('\n')}`;
}

function formatDiff(diff, snap){
  const section=(label,x)=>{
    const lines=[];
    for(const id of x.added||[])lines.push(`+ ${label} added: **${id.name||id.id||id}**`);
    for(const id of x.removed||[])lines.push(`- ${label} removed: **${id.name||id.id||id}**`);
    for(const id of x.changed||[])lines.push(`~ ${label} changed: **${id.name||id.id||id}**`);
    return lines;
  };
  const lines=[...section('Role',diff.roles),...section('Channel',diff.channels)];
  return `🧩 **SNAPSHOT DIFF**\nSnapshot: **${snap.id.slice(0,8)}** • <t:${Math.floor(new Date(snap.at).getTime()/1000)}:R>\n\n${lines.length?lines.slice(0,30).join('\n'):'🟢 No structural changes detected.'}`;
}

async function health(guild){return serverBrain.analyze(guild);}

function incidentReport(config, guild){
  const cases=(config.cases||[]).slice(-20).reverse();
  const high=cases.filter(c=>/SECURITY|NUKE|RAID|AUTOMOD-TIMEOUT|BAN|KICK|CHANNEL_DELETE|ROLE_DELETE/i.test(String(c.action||''))).slice(0,8);
  const actions=history(config,12).filter(x=>/BAN|KICK|DELETE|PERMISSION|TIMEOUT|AUTOPILOT|SECURITY/i.test(x.action||'')).slice(0,8);
  const lines=[`🚨 **JARVIS INCIDENT REPORT — ${guild.name}**`,`Generated: <t:${Math.floor(Date.now()/1000)}:F>`,``,`**Security cases:** ${high.length}`,...high.map(c=>`• **Case #${c.id}** ${c.action} — <@${c.userId||c.targetId||c.moderatorId||guild.client.user.id}> — ${String(c.reason||'No reason').slice(0,140)}`),``,`**Relevant JARVIS actions:** ${actions.length}`,...actions.map(a=>`• **#${a.id}** ${a.action}${a.targetId?` → <@${a.targetId}>`:''} — ${String(a.reason||'No reason').slice(0,120)}`)];
  return lines.join('\n');
}

function explainCase(config,id){
  const c=(config.cases||[]).find(x=>String(x.id)===String(id));
  if(!c)return `I couldn't find case **#${id}**, sir.`;
  const evidence=c.evidence?JSON.stringify(c.evidence,null,2):'No structured evidence was stored.';
  return `🔎 **CASE #${c.id}**\n**Action:** ${c.action}\n**Time:** <t:${Math.floor(new Date(c.at).getTime()/1000)}:F>\n**User:** ${c.userId?`<@${c.userId}>`:'Unknown'}\n**Moderator/System:** ${c.moderatorId?`<@${c.moderatorId}>`:'Unknown'}\n**Reason:** ${c.reason||'No reason recorded'}\n\n**Evidence**\n\`\`\`json\n${evidence.slice(0,1200)}\n\`\`\``;
}

async function memberProfile(guild, config, member){
  const warnings=config.warnings?.[member.id]||[];
  const cases=(config.cases||[]).filter(c=>c.userId===member.id||c.targetId===member.id).slice(-10).reverse();
  const actions=journal.ensure(config).actionJournal.filter(x=>x.targetId===member.id).slice(-10).reverse();
  return `👤 **JARVIS MEMBER PROFILE**\n**${member.user.tag}** • <@${member.id}>\n\n• Account age: <t:${Math.floor(member.user.createdTimestamp/1000)}:R>\n• Joined: ${member.joinedTimestamp?`<t:${Math.floor(member.joinedTimestamp/1000)}:R>`:'Unknown'}\n• Roles: **${Math.max(0,member.roles.cache.size-1)}**\n• Warnings: **${warnings.length}**\n• Cases: **${cases.length}**\n• JARVIS actions targeting them: **${actions.length}**\n\n**Recent cases**\n${cases.length?cases.map(c=>`• #${c.id} ${c.action} — ${String(c.reason||'No reason').slice(0,100)}`).join('\n'):'None'}\n\n**Recent JARVIS actions**\n${actions.length?actions.map(a=>`• #${a.id} ${a.action} — ${String(a.reason||'No reason').slice(0,100)}`).join('\n'):'None'}`;
}

function addWatch(config,channelId){const v=ensure(config);if(!v.watch.channels.includes(channelId))v.watch.channels.push(channelId);v.watch.enabled=true;return v.watch;}
function removeWatch(config,channelId){const v=ensure(config);if(channelId)v.watch.channels=v.watch.channels.filter(x=>x!==channelId);else v.watch.channels=[];v.watch.enabled=v.watch.channels.length>0;return v.watch;}

function observeMessage(message,config,logEvent){
  const v=ensure(config); if(!v.watch.enabled||!v.watch.channels.includes(message.channel.id))return;
  message.guild.__jarvisWatch ??= new Map();
  const key=message.channel.id, now=Date.now(); const arr=(message.guild.__jarvisWatch.get(key)||[]).filter(x=>now-x.at<v.watch.windowMs); arr.push({at:now,mentions:message.mentions.users.size+message.mentions.roles.size}); message.guild.__jarvisWatch.set(key,arr);
  const burst=arr.length>=v.watch.burstThreshold, mentions=arr.reduce((n,x)=>n+x.mentions,0)>=v.watch.mentionThreshold;
  const lastKey=`${key}:${burst?'burst':'mentions'}`; message.guild.__jarvisWatchAlerts ??= new Map(); if((burst||mentions)&&now-(message.guild.__jarvisWatchAlerts.get(lastKey)||0)>v.watch.windowMs){message.guild.__jarvisWatchAlerts.set(lastKey,now);const reason=burst?`${arr.length} messages in ${v.watch.windowMs/1000}s`: `${arr.reduce((n,x)=>n+x.mentions,0)} mentions in ${v.watch.windowMs/1000}s`; logEvent(message.guild,`👁️ **JARVIS WATCH ALERT** — <#${key}>\nPossible activity spike: **${reason}**.`).catch(()=>{});}}

module.exports={ensure,history,formatHistory,formatDiff,health,incidentReport,explainCase,memberProfile,addWatch,removeWatch,observeMessage};
