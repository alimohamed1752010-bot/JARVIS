const crypto=require('node:crypto');
const MAX=10;
async function capture(guild){
  await guild.members.fetch().catch(()=>{});
  const roles=[...guild.roles.cache.values()].sort((a,b)=>a.position-b.position).map(r=>({id:r.id,name:r.name,position:r.position,managed:r.managed,permissions:r.permissions.bitfield.toString(),color:r.color,hoist:r.hoist,mentionable:r.mentionable}));
  const channels=[...guild.channels.cache.values()].map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parentId,position:c.rawPosition,nsfw:c.nsfw,topic:c.topic||null}));
  return {id:crypto.randomUUID(),at:new Date().toISOString(),guildId:guild.id,guildName:guild.name,roles,channels};
}
async function create(guild,config,saveConfig,meta={}){config.v12??={};config.v12.snapshots??={items:[],disabled:false};const snap=await capture(guild);snap.reason=meta.reason||'';config.v12.snapshots.items.push(snap);if(config.v12.snapshots.items.length>MAX)config.v12.snapshots.items=config.v12.snapshots.items.slice(-MAX);saveConfig(guild.id,config);return snap;}
function latest(config){return config.v12?.snapshots?.items?.at(-1)||null;}
function diff(current,snap){
  const by=(arr,k)=>new Map((arr||[]).map(x=>[x[k],x])); const cr=by(current.roles,'id'),sr=by(snap?.roles,'id'),cc=by(current.channels,'id'),sc=by(snap?.channels,'id');
  return {roles:{added:[...cr.keys()].filter(k=>!sr.has(k)),removed:[...sr.keys()].filter(k=>!cr.has(k)),changed:[...cr.keys()].filter(k=>sr.has(k)&&JSON.stringify(cr.get(k))!==JSON.stringify(sr.get(k)))},channels:{added:[...cc.keys()].filter(k=>!sc.has(k)),removed:[...sc.keys()].filter(k=>!cc.has(k)),changed:[...cc.keys()].filter(k=>sc.has(k)&&JSON.stringify(cc.get(k))!==JSON.stringify(sc.get(k)))} };
}
async function restoreLatest(guild,config,saveConfig){
  const snap=latest(config);if(!snap)return {ok:false,text:'No server snapshot is available, sir.'};
  const failures=[]; const bot=guild.members.me;
  for(const data of snap.roles||[]){const role=guild.roles.cache.get(data.id);if(!role||role.managed||!role.editable||role.position>=bot.roles.highest.position)continue;try{await role.edit({name:data.name,permissions:BigInt(data.permissions),color:data.color,hoist:data.hoist,mentionable:data.mentionable},'JARVIS snapshot restore');}catch(e){failures.push(`role ${data.name}`);}}
  for(const data of snap.channels||[]){const ch=guild.channels.cache.get(data.id);if(!ch||!ch.manageable)continue;try{await ch.edit({name:data.name,parent:data.parentId||null,position:data.position,nsfw:data.nsfw,topic:data.topic||undefined},'JARVIS snapshot restore');}catch(e){failures.push(`channel ${data.name}`);}}
  saveConfig(guild.id,config);return {ok:true,text:`Restored snapshot **${snap.id.slice(0,8)}** where Discord permitted.${failures.length?` Failed: ${failures.join(', ')}.`:''}`};
}
function list(config){return [...(config.v12?.snapshots?.items||[])].reverse();}
module.exports={capture,create,latest,list,diff,restoreLatest,MAX};
