const MAX_EVENTS = 700;
const MAX_FACTS = 250;
const MAX_BEHAVIOR = 120;
const MAX_ANOMALIES = 100;

function ensure(config, guildId) {
  config.v13 ??= {};
  config.v13.knowledge ??= {};
  config.v13.knowledge[guildId] ??= { facts: [], events: [], lastScan: null, behavior: {}, anomalies: [] };
  const k = config.v13.knowledge[guildId];
  k.facts ??= []; k.events ??= []; k.lastScan ??= null; k.behavior ??= {}; k.anomalies ??= [];
  return k;
}
function remember(config, guildId, fact, source='jarvis') {
  const k=ensure(config,guildId); const text=String(fact||'').trim().slice(0,500); if(!text)return;
  const existing=k.facts.find(x=>x.text.toLowerCase()===text.toLowerCase());
  if(existing){existing.at=new Date().toISOString();existing.source=source;} else k.facts.push({text,source,at:new Date().toISOString()});
  if(k.facts.length>MAX_FACTS)k.facts=k.facts.slice(-MAX_FACTS);
}
function recordEvent(config,guildId,event){
  const k=ensure(config,guildId); const e={at:new Date().toISOString(),...event}; k.events.push(e); if(k.events.length>MAX_EVENTS)k.events=k.events.slice(-MAX_EVENTS);
  learnFromEvent(k,e);
}
function learnFromEvent(k,e){
  const action=String(e.action||'').toUpperCase(); if(!action)return;
  const key=action.replace(/[^A-Z0-9_:-]/g,'').slice(0,80); const b=k.behavior[key]??={count:0,lastAt:null,details:{}}; b.count++; b.lastAt=e.at;
  if(e.detail){const d=String(e.detail).slice(0,160);b.details[d]=(b.details[d]||0)+1; const entries=Object.entries(b.details).sort((a,c)=>c[1]-a[1]).slice(0,8);b.details=Object.fromEntries(entries);}
  const total=Object.values(k.behavior).reduce((n,x)=>n+(x.count||0),0); if(total>MAX_BEHAVIOR*20){const keep=Object.entries(k.behavior).sort((a,c)=>(c[1].count||0)-(a[1].count||0)).slice(0,MAX_BEHAVIOR);k.behavior=Object.fromEntries(keep);}
}
function recordAnomaly(config,guildId,anomaly){const k=ensure(config,guildId);k.anomalies.push({at:new Date().toISOString(),...anomaly});if(k.anomalies.length>MAX_ANOMALIES)k.anomalies=k.anomalies.slice(-MAX_ANOMALIES);}
function get(config,guildId){return ensure(config,guildId);}
function behaviorContext(k){const rows=Object.entries(k.behavior).sort((a,b)=>(b[1].count||0)-(a[1].count||0)).slice(0,15);return rows.length?`LEARNED SERVER BEHAVIOR (observed, not guaranteed):\n${rows.map(([a,b])=>`- ${a}: ${b.count} observed${b.details&&Object.keys(b.details).length?` (${Object.entries(b.details).slice(0,3).map(([d,n])=>`${d} ×${n}`).join(', ')})`:''}`).join('\n')}`:'';}
function context(config,guildId){const k=get(config,guildId);const facts=k.facts.slice(-50).map(x=>`- ${x.text}`).join('\n');const events=k.events.slice(-25).reverse().map(x=>`- ${x.at}: ${x.action||'event'}${x.detail?` — ${x.detail}`:''}`).join('\n');const anomalies=k.anomalies.slice(-8).reverse().map(x=>`- ${x.at}: ${x.type||'anomaly'} — ${x.detail||''}`).join('\n');return [facts?`PERSISTENT SERVER KNOWLEDGE:\n${facts}`:'',behaviorContext(k),events?`RECENT JARVIS/SERVER EVENTS:\n${events}`:'',anomalies?`RECENT ANOMALIES:\n${anomalies}`:'',k.lastScan?`LAST SERVER SCAN: ${k.lastScan}`:''].filter(Boolean).join('\n\n');}
async function scan(guild,config,saveConfig){const k=ensure(config,guild.id);await guild.members.fetch().catch(()=>{});const roles=[...guild.roles.cache.values()].filter(r=>!r.managed).map(r=>({id:r.id,name:r.name,position:r.position,permissions:r.permissions.bitfield.toString()}));const channels=[...guild.channels.cache.values()].map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parentId,position:c.rawPosition}));const voice=[...guild.channels.cache.values()].filter(c=>c.isVoiceBased()).map(c=>({id:c.id,name:c.name,members:[...c.members.values()].filter(m=>!m.user.bot).map(m=>m.id)}));k.lastScan=new Date().toISOString();k.cached={memberCount:guild.memberCount,roles,channels,voice};saveConfig(guild.id,config);return k.cached;}
function cached(config,guildId){return ensure(config,guildId).cached||null;}
function behavior(config,guildId){return ensure(config,guildId).behavior;}
module.exports={ensure,remember,recordEvent,recordAnomaly,get,context,scan,cached,behavior,MAX_EVENTS,MAX_FACTS,MAX_BEHAVIOR,MAX_ANOMALIES};
