const ADMINISTRATOR = 8n;

const MAX = 1200;

function normalize(name='') { return String(name).toLowerCase().replace(/[^a-z0-9@#:_-]+/g,' ').trim(); }

async function build(guild) {
  await guild.members.fetch().catch(()=>{});
  const bot = guild.members.me;
  const nodes = [];
  const edges = [];
  const add = (id,type,label,meta={}) => { if(nodes.length < MAX) nodes.push({id:`${type}:${id}`,type,label,meta}); };
  const edge = (from,to,type,meta={}) => { if(edges.length < MAX*2) edges.push({from,to,type,meta}); };
  add(guild.id,'server',guild.name,{memberCount:guild.memberCount});
  for(const r of guild.roles.cache.values()) {
    add(r.id,'role',r.name,{position:r.position,managed:r.managed,permissions:r.permissions.bitfield.toString()});
    edge(`server:${guild.id}`,`role:${r.id}`,'contains');
  }
  for(const c of guild.channels.cache.values()) {
    add(c.id,'channel',c.name,{type:c.type,parentId:c.parentId});
    edge(`server:${guild.id}`,`channel:${c.id}`,'contains');
    if(c.parentId) edge(`channel:${c.parentId}`,`channel:${c.id}`,'parent');
    if(c.permissionOverwrites?.cache) for(const ow of c.permissionOverwrites.cache.values()) {
      const targetType = ow.type === 0 ? 'role' : 'member';
      edge(`${targetType}:${ow.id}`,`channel:${c.id}`,'overwrite',{allow:ow.allow.bitfield.toString(),deny:ow.deny.bitfield.toString()});
    }
  }
  for(const m of guild.members.cache.values()) {
    if(m.user.bot && m.id !== bot?.id) continue;
    add(m.id,'member',m.displayName,{bot:m.user.bot,voice:m.voice.channelId||null});
    edge(`server:${guild.id}`,`member:${m.id}`,'contains');
    for(const r of m.roles.cache.values()) if(r.id!==guild.id) edge(`member:${m.id}`,`role:${r.id}`,'member_of');
    if(m.voice.channelId) edge(`member:${m.id}`,`channel:${m.voice.channelId}`,'in_voice');
  }
  return {generatedAt:new Date().toISOString(),nodes,edges,bot:{id:bot?.id||null,permissions:bot?.permissions?.bitfield?.toString()||'0',highestRole:bot?.roles?.highest?.id||null}};
}

function findRelated(graph, query) {
  const q=normalize(query); const matches=graph.nodes.filter(n=>normalize(n.label).includes(q)).slice(0,20);
  const ids=new Set(matches.map(n=>n.id));
  const related=graph.edges.filter(e=>ids.has(e.from)||ids.has(e.to)).slice(0,50);
  return {matches,related};
}

function diagnose(graph, query='') {
  const findings=[];
  const roles=new Map(graph.nodes.filter(n=>n.type==='role').map(n=>[n.id,n]));
  const members=new Map(graph.nodes.filter(n=>n.type==='member').map(n=>[n.id,n]));
  const channels=new Map(graph.nodes.filter(n=>n.type==='channel').map(n=>[n.id,n]));
  for(const [id,r] of roles) {
    if(r.meta?.managed) continue;
    if(BigInt(r.meta?.permissions||'0') & BigInt(ADMINISTRATOR)) findings.push({severity:'HIGH',type:'admin_role',detail:`Role **${r.label}** has Administrator.`});
  }
  const voiceMembers=graph.edges.filter(e=>e.type==='in_voice').length;
  if(voiceMembers===0) findings.push({severity:'INFO',type:'voice_empty',detail:'No non-bot members are currently represented in voice.'});
  if(query) {
    const rel=findRelated(graph,query);
    if(rel.matches.length) findings.push({severity:'INFO',type:'relationship',detail:`Found ${rel.matches.length} object(s) matching **${query}** with ${rel.related.length} direct relationships.`});
    else findings.push({severity:'MEDIUM',type:'missing_reference',detail:`No server object matched **${query}**.`});
  }
  return {findings,generatedAt:new Date().toISOString()};
}

function format(graph,diagnosis) {
  const counts=graph.nodes.reduce((a,n)=>(a[n.type]=(a[n.type]||0)+1,a),{});
  return `**JARVIS SERVER RELATIONSHIP MAP**\nNodes: **${graph.nodes.length}** • Relationships: **${graph.edges.length}**\n• Members: ${counts.member||0}\n• Roles: ${counts.role||0}\n• Channels: ${counts.channel||0}\n\n${diagnosis?.findings?.length?diagnosis.findings.slice(0,10).map(f=>`${f.severity==='HIGH'?'🔴':f.severity==='MEDIUM'?'🟡':'🔵'} ${f.detail}`).join('\n'):'🟢 No relationship anomalies detected.'}`;
}

module.exports={build,findRelated,diagnose,format};
