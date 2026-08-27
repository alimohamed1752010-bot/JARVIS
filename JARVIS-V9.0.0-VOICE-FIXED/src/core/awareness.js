async function snapshot(guild){
  try{await guild.members.fetch();}catch{}
  const voice={};
  for(const channel of guild.channels.cache.values()) if(channel.isVoiceBased()) voice[channel.id]={id:channel.id,name:channel.name,members:[...channel.members.values()].filter(m=>!m.user.bot).map(m=>({id:m.id,name:m.displayName}))};
  return {guild:{id:guild.id,name:guild.name,members:guild.memberCount,channels:guild.channels.cache.size,roles:guild.roles.cache.size,ownerId:guild.ownerId},voice};
}
function format(snapshot){const lines=[`Server: ${snapshot.guild.name}`,`Members: ${snapshot.guild.members}`,`Channels: ${snapshot.guild.channels}`,`Roles: ${snapshot.guild.roles}`];for(const v of Object.values(snapshot.voice))lines.push(`VC ${v.name}: ${v.members.length} members${v.members.length?` (${v.members.map(x=>x.name).join(', ')})`:''}`);return lines.join('\n');}
module.exports={snapshot,format};
