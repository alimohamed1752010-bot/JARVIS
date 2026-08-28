const { ChannelType } = require('discord.js');

function normalize(value='') {
  return String(value).trim().replace(/^[@#]/, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function ensureMembers(guild) {
  try { await guild.members.fetch(); } catch {}
  return guild.members.cache;
}

function scoreMember(member, q) {
  const query = normalize(q);
  const fields = [
    ['id', member.id, 1000],
    ['username', member.user.username, 900],
    ['globalName', member.user.globalName, 850],
    ['displayName', member.displayName, 800],
    ['tag', member.user.tag, 780]
  ].filter(([,v]) => v);
  let best = -1;
  for (const [, value, weight] of fields) {
    const v = String(value).toLowerCase();
    if (v === query) best = Math.max(best, weight);
    else if (v.startsWith(query)) best = Math.max(best, weight - 100);
    else if (v.includes(query)) best = Math.max(best, weight - 250);
  }
  return best;
}

async function resolveMember(guild, query, { allowBots=true }={}) {
  if (!query) return { status:'missing', member:null, candidates:[] };
  const raw = String(query).trim();
  const mention = raw.match(/^<@!?(\d+)>$/);
  const id = mention?.[1] || (/^\d{15,25}$/.test(raw) ? raw : null);
  if (id) {
    const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(()=>null);
    return member && (allowBots || !member.user.bot)
      ? {status:'resolved',member,candidates:[member]}
      : {status:'missing',member:null,candidates:[]};
  }
  const members = await ensureMembers(guild);
  const candidates = [...members.values()]
    .filter(m => allowBots || !m.user.bot)
    .map(m => ({member:m,score:scoreMember(m,raw)}))
    .filter(x => x.score >= 0)
    .sort((a,b)=>b.score-a.score || a.member.id.localeCompare(b.member.id));
  if (!candidates.length) return {status:'missing',member:null,candidates:[]};
  const top = candidates[0].score;
  const tied = candidates.filter(x => x.score === top).map(x=>x.member);
  if (tied.length > 1 || (top < 650 && candidates.length > 1)) {
    return {status:'ambiguous',member:null,candidates:candidates.slice(0,10).map(x=>x.member)};
  }
  return {status:'resolved',member:candidates[0].member,candidates:candidates.slice(0,10).map(x=>x.member)};
}

function channelVariants(value) {
  const base=normalize(value);
  const variants=new Set([base]);
  variants.add(base.replace(/\bgen\b/g,'general'));
  variants.add(base.replace(/\bg\b/g,'general'));
  variants.add(base.replace(/\bsec\b/g,'secret'));
  variants.add(base.replace(/\bcat\b/g,'category'));
  variants.add(base.replace(/\bvc\b/g,'voice'));
  variants.add(base.replace(/\bsec(?:ret)?\s+gen\b/g,'secret general'));
  return [...variants].filter(Boolean);
}

function channelScore(channel, q) {
  const queries = channelVariants(q);
  const name = normalize(channel.name);
  if (queries.includes(name)) return 1000;
  if (queries.some(query=>name.startsWith(query))) return 850;
  if (queries.some(query=>name.includes(query))) return 700;
  const qTokens=normalize(q).split(' ').filter(Boolean);
  const nTokens=name.split(' ').filter(Boolean);
  if(qTokens.length && qTokens.every(qt=>nTokens.some(nt=>nt===qt || nt.startsWith(qt)))) return 650;
  return -1;
}

function resolveChannel(guild, query, {voiceOnly=false}={}) {
  const raw=String(query||'').trim();
  const mention=raw.match(/^<#(\d+)>$/);
  const channels=[...guild.channels.cache.values()].filter(c=>!voiceOnly || [ChannelType.GuildVoice,ChannelType.GuildStageVoice].includes(c.type));
  if (mention) {
    const channel=guild.channels.cache.get(mention[1]);
    return channel ? {status:'resolved',channel,candidates:[channel]} : {status:'missing',channel:null,candidates:[]};
  }
  const matches=channels.map(c=>({channel:c,score:channelScore(c,raw)})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score || a.channel.id.localeCompare(b.channel.id));
  if(!matches.length) return {status:'missing',channel:null,candidates:[]};
  if(matches.length>1 && matches[0].score===matches[1].score) return {status:'ambiguous',channel:null,candidates:matches.slice(0,10).map(x=>x.channel)};
  return {status:'resolved',channel:matches[0].channel,candidates:matches.slice(0,10).map(x=>x.channel)};
}

function splitTargets(text='') {
  return String(text).replace(/\s+(?:and|n|&)\s+/gi, ',').split(',').map(x=>x.trim()).filter(Boolean);
}

module.exports={ensureMembers,resolveMember,resolveChannel,splitTargets};
