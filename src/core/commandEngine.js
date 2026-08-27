const {parseCommandIntent}=require('../ai');
const {resolveMember,resolveChannel,splitTargets}=require('./resolver');
const {execute,undo}=require('./executor');
const context=require('./context');
const confirmations=require('./confirmations');
const journal=require('./journal');
const awareness=require('./awareness');
const simulator=require('./simulator');
const {createDefaultRegistry}=require('./toolRegistry');
const toolRegistry=createDefaultRegistry();

const ACTION_WORDS=/\b(move|disconnect|deafen|undeafen|mute|unmute|timeout|untimeout|kick|ban|warn|simulate|undo|history|diagnostics|status|who|everyone|except)\b/i;

function parseDuration(text){const m=String(text).match(/(?:for\s*)?(\d+(?:\.\d+)?)\s*(s|m|h|d)\b/i);if(!m)return 10*60*1000;const n=Number(m[1]);const mult={s:1000,m:60000,h:3600000,d:86400000}[m[2].toLowerCase()];return Math.min(Math.max(n*mult,1000),28*24*60*60*1000);}
function normalizeAction(a){return ({move_voice:'voicemove',move:'voicemove',disconnect:'voicedisconnect',deafen:'voicedeafen',undeafen:'voiceundeafen',mute:'voicemute',unmute:'voiceunmute',server_mute:'voicemute',server_unmute:'voiceunmute',timeout:'timeout',untimeout:'untimeout',kick:'kick',ban:'ban'})[a]||a;}
function deterministic(text){
  const t=String(text).trim();
  let m=t.match(/^(?:move|drag|send)\s+(.+?)\s+(?:from\s+(.+?)\s+)?(?:to|into)\s+(.+)$/i);
  if(m){let targetText=m[1], source=m[2]||''; let exclude=[]; const ex=targetText.match(/^(.+?)\s+except\s+(.+)$/i);if(ex){targetText=ex[1];exclude=splitTargets(ex[2]);}return {action:'voicemove',targets:splitTargets(targetText),excludeTargets:exclude,source:source.trim(),destination:m[3].trim()};}
  m=t.match(/^(?:disconnect|dc|pull)\s+(.+)$/i);if(m)return {action:'voicedisconnect',targets:splitTargets(m[1])};
  m=t.match(/^(deafen|undeafen|mute|unmute|server\s+mute|server\s+unmute|server\s+deafen|server\s+undeafen)\s+(.+)$/i);if(m){const a=/undeafen|server\s+undeafen/i.test(m[1])?'voiceundeafen':/deafen|server\s+deafen/i.test(m[1])?'voicedeafen':/unmute|server\s+unmute/i.test(m[1])?'voiceunmute':'voicemute';return {action:a,targets:splitTargets(m[2])};}
  m=t.match(/^(?:text|chat)\s+(mute|unmute)\s+(.+)$/i);if(m)return {action:m[1].toLowerCase()==='mute'?'textmute':'textunmute',targets:splitTargets(m[2])};
  m=t.match(/^timeout\s+(.+?)(?:\s+for\s+.+)?$/i);if(m)return {action:'timeout',targets:splitTargets(m[1]),durationMs:parseDuration(t)};
  m=t.match(/^untimeout\s+(.+)$/i);if(m)return {action:'untimeout',targets:splitTargets(m[1])};
  m=t.match(/^(warn)\s+(.+?)(?:\s+(?:because|for)\s+(.+))?$/i);if(m)return {action:'warn',targets:splitTargets(m[2]),reason:m[3]||''};
  m=t.match(/^(kick|ban)\s+(.+?)(?:\s+(?:because|for)\s+(.+))?$/i);if(m)return {action:m[1].toLowerCase(),targets:splitTargets(m[2]),reason:m[3]||''};
  m=t.match(/^undo(?:\s+case)?\s*(\d+)?$/i);if(m)return {action:'undo',caseId:m[1]||null};
  m=t.match(/^(?:show\s+)?(?:history|moderation\s+history)(?:\s+(.+))?$/i);if(m)return {action:'history',targets:m[1]?[m[1]]:[]};
  m=t.match(/^case\s+(\d+)$/i);if(m)return {action:'caseinfo',caseId:m[1]};
  m=t.match(/^(?:server\s+)?(?:status|diagnostics)$/i);if(m)return {action:'diagnostics'};
  m=t.match(/^simulate\s+(.+)$/i);if(m)return {action:'simulate',raw:m[1]};
  m=t.match(/^(?:trace|debug)\s+(.+)$/i);if(m)return {action:'trace',raw:m[1]};
  m=t.match(/^(?:who\s+am\s+i|who\s+is\s+me|what\s+is\s+my\s+(?:name|username|user(?:name)?|id)|who\s+am\s+i\??)$/i);if(m)return {action:'whoami'};
  m=t.match(/^(?:who(?:'s| is)\s+in|list)\s+(.+)$/i);if(m)return {action:'awareness',destination:m[1]};
  m=t.match(/^(?:who\s+(?:made|created|built)\s+(?:you|u)|who\s+are\s+you|what\s+are\s+you|what\s+is\s+your\s+name)\??$/i);if(m)return {action:'jarvis_identity'};
  return null;
}

async function getIntent(message,text){
  const deterministicIntent=deterministic(text); if(deterministicIntent)return deterministicIntent;
  if(!ACTION_WORDS.test(text))return null;
  try { const parsed=await parseCommandIntent({message,prompt:text}); if(!parsed)return null; parsed.action=normalizeAction(parsed.action); return parsed; } catch { return null; }
}

async function resolveTargets(message, refs){
  const output=[];
  for(const ref of refs||[]){if(/^(?:me|myself|i)$/i.test(ref)){if(message.member)output.push(message.member);continue;}if(/^(?:everyone|everybody|all)$/i.test(ref)){await message.guild.members.fetch().catch(()=>{});output.push(...[...message.guild.members.cache.values()].filter(m=>!m.user.bot&&m.voice?.channel));continue;}const r=await resolveMember(message.guild,ref);if(r.status==='ambiguous')return {error:`I found multiple members matching **${ref}**.\n${r.candidates.map((m,i)=>`**${i+1}.** ${m.user.tag}`).join('\n')}`, candidates:r.candidates};if(r.status==='missing')return {error:`I couldn't find a member matching **${ref}**.`};if(r.member&&!output.some(m=>m.id===r.member.id))output.push(r.member);}
  return {members:output};
}

async function route({message,text,config,saveConfig}){
  const pending=confirmations.consume(message,text);if(pending){if(!pending.confirmed)return {handled:true,text:'Cancelled. No changes were made.'};const p=pending.payload;return perform({message,intent:p.intent,config,saveConfig,confirmed:true});}
  const c=context.get(message);if(c && /^(?:and\s+.+|also\s+.+)$/i.test(text)){const extra=text.replace(/^(?:and|also)\s+/i,'');const refs=splitTargets(extra);const next={...c.intent,targets:refs,destination:c.intent.destination||c.destination};context.clear(message);return perform({message,intent:next,config,saveConfig,confirmed:true});}
  if(c && /^(?:the first|first|1|the second|second|2|cancel|no|yes|confirm)$/i.test(text)){if(/^cancel|no$/i.test(text)){context.clear(message);return {handled:true,text:'Cancelled, sir.'};}const index=/second|2/i.test(text)?1:0;const picked=c.candidates?.[index];if(picked){context.clear(message);return perform({message,intent:{...c.intent,targets:[picked.id],destination:picked.destination||c.destination},config,saveConfig,confirmed:true});}}
  const intent=await getIntent(message,text);if(!intent)return {handled:false};
  return perform({message,intent,config,saveConfig});
}

async function perform({message,intent,config,saveConfig,confirmed=false}){
  if(intent.action==='jarvis_identity'){return {handled:true,text:'I am JARVIS, sir, your Discord AI assistant. I was built for this server to handle commands, moderation, automation, and general assistance.'};}
  if(intent.action==='whoami'){
    const member=message.member || await message.guild.members.fetch(message.author.id).catch(()=>null);
    if(!member) return {handled:true,text:'I could not retrieve your server profile, sir.'};
    const roles=member.roles.cache.filter(r=>r.id!==message.guild.id).sort((a,b)=>b.position-a.position).map(r=>r.name).slice(0,8);
    const voice=member.voice?.channel ? `\n🎙️ Voice: **${member.voice.channel.name}**` : '';
    return {handled:true,text:`**You are ${member.displayName}, sir.**\n• Username: **${member.user.tag}**\n• User ID: \`${member.id}\`\n• Joined: **${member.joinedAt ? member.joinedAt.toLocaleDateString() : 'Unknown'}**${roles.length?`\n• Roles: ${roles.map(r=>`**${r}**`).join(', ')}`:''}${voice}`};
  }
  if(intent.action==='diagnostics'){const snap=await awareness.snapshot(message.guild);return {handled:true,text:`**JARVIS V9 DIAGNOSTICS**\n🟢 Discord ONLINE\n🟢 Command Engine ONLINE\n🟢 Resolver ONLINE\n🟢 Executor ONLINE\n🟢 Journal ONLINE\n🟢 Context ONLINE\n🟢 Tool Registry ONLINE (${toolRegistry.list().length} core tools)\n\n${awareness.format(snap)}`};}
  if(intent.action==='awareness'){const r=resolveChannel(message.guild,intent.destination,{voiceOnly:true});if(r.status==='ambiguous')return {handled:true,text:`I found multiple voice channels matching **${intent.destination}**:\n${r.candidates.map((c,i)=>`**${i+1}.** 🔊 ${c.name}`).join('\n')}`};if(!r.channel)return {handled:true,text:`I couldn't find voice channel **${intent.destination}**.`};return {handled:true,text:`${r.channel.name} currently has **${r.channel.members.filter(m=>!m.user.bot).size}** members.\n${r.channel.members.filter(m=>!m.user.bot).map(m=>`• ${m.displayName}`).join('\n')||'Nobody, apparently.'}`};}
  if(intent.action==='history'){let ref=intent.targets?.[0];if(ref&&!/^\d{15,25}$/.test(ref)){const r=await resolveMember(message.guild,ref);if(r.status==='resolved')ref=r.member.id;}const entries=ref?(config.v9?.actionJournal||[]).filter(x=>x.targetId===ref).slice(-10).reverse():(config.v9?.actionJournal||[]).slice(-10).reverse();return {handled:true,text:`**JARVIS V9 ACTION HISTORY**\n${entries.map(x=>`#${x.id} • ${x.action} • <@${x.targetId||message.author.id}> • ${x.status} • ${new Date(x.at).toLocaleString()}`).join('\n')||'No actions logged yet.'}`};}
  if(intent.action==='caseinfo'){const entry=journal.get(config,intent.caseId);if(!entry)return {handled:true,text:`No case **#${intent.caseId}** exists, sir.`};return {handled:true,text:`**JARVIS V9 CASE #${entry.id}**\nAction: **${entry.action}**\nActor: <@${entry.actorId}>\nTarget: ${entry.targetId?`<@${entry.targetId}>`:'none'}\nDestination: ${entry.destinationId?`<#${entry.destinationId}>`:'none'}\nStatus: **${entry.status}**\nReversible: **${entry.reversible?'yes':'no'}**\nReason: ${entry.reason||'none'}\nAt: ${new Date(entry.at).toLocaleString()}\nBefore: \`${JSON.stringify(entry.before||{})}\`\nAfter: \`${JSON.stringify(entry.after||{})}\``};}
  if(intent.action==='undo'){const entry=intent.caseId?journal.get(config,intent.caseId):journal.latest(config,x=>x.reversible);if(!entry)return {handled:true,text:'I found no reversible action to undo.'};const result=await undo({message,entry,config,saveConfig});return {handled:true,text:result.text};}
  if(intent.action==='trace'){const inner=deterministic(intent.raw)||await getIntent(message,intent.raw);if(!inner)return {handled:true,text:'**V9 TRACE**\nCould not build a structured intent from that input.'};return {handled:true,text:`**JARVIS V9 TRACE**\nINPUT → \`${intent.raw}\`\nACTION → **${normalizeAction(inner.action)}**\nTARGETS → **${(inner.targets||[]).join(', ')||'none'}**\nSOURCE → **${inner.source||'none'}**\nDESTINATION → **${inner.destination||'none'}**\nREASON → **${inner.reason||'none'}**\nMODE → **parse-only, no changes made**`};}
  if(intent.action==='simulate'){const inner=deterministic(intent.raw)||await getIntent(message,intent.raw);if(!inner)return {handled:true,text:'I could not build a simulation plan from that command.'};const targetResult=await resolveTargets(message,inner.targets);if(targetResult.error)return {handled:true,text:targetResult.error};let destination=null;if(inner.destination){const r=resolveChannel(message.guild,inner.destination,{voiceOnly:true});if(r.status==='ambiguous'){return {handled:true,text:`Simulation needs a unique destination.\n${r.candidates.map((c,i)=>`${i+1}. ${c.name}`).join('\n')}`};}destination=r.channel;if(!destination)return {handled:true,text:`Simulation could not resolve **${inner.destination}**.`};}const checks=[];for(const m of targetResult.members){const r=await execute({message,action:normalizeAction(inner.action),target:m,destination,reason:inner.reason,durationMs:inner.durationMs,config,saveConfig,dryRun:true,skipJournal:true});checks.push({action:inner.action,target:m,destination,allowed:r.ok,reason:r.ok?'allowed':r.text});}const plan=simulator.plan(checks);return {handled:true,text:`**JARVIS V9 SIMULATION**\n${plan.map(x=>`${x.step}. ${x.action.toUpperCase()} → ${x.target}${x.destination?` → ${x.destination}`:''} ${x.allowed?'✓':'✗'}${x.reason&&!x.allowed?` — ${x.reason}`:''}`).join('\n')}\n\n**No changes were made.**`};}
  const targetResult=await resolveTargets(message,intent.targets||[]);if(targetResult.error){context.set(message,{intent,candidates:targetResult.candidates||[],destination:intent.destination});return {handled:true,text:targetResult.error};}
  let members=targetResult.members||[];
  if(intent.source){const src=resolveChannel(message.guild,intent.source,{voiceOnly:true});if(src.status==='ambiguous')return {handled:true,text:`I found multiple source voice channels matching **${intent.source}**.`};if(!src.channel)return {handled:true,text:`I couldn't find source voice channel **${intent.source}**.`};members=members.filter(m=>m.voice?.channelId===src.channel.id);}
  if(intent.excludeTargets?.length){const excluded=await resolveTargets(message,intent.excludeTargets);if(excluded.error)return {handled:true,text:excluded.error};const ids=new Set((excluded.members||[]).map(m=>m.id));members=members.filter(m=>!ids.has(m.id));}
  if(!members.length)return {handled:true,text:'I could not resolve anyone for that command.'};
  let destination=null;if(intent.destination){const r=resolveChannel(message.guild,intent.destination,{voiceOnly:true});if(r.status==='ambiguous'){context.set(message,{intent,candidates:r.candidates,destination:intent.destination});return {handled:true,text:`I found multiple voice channels matching **${intent.destination}**:\n${r.candidates.map((c,i)=>`**${i+1}.** 🔊 ${c.name}`).join('\n')}`};}if(!r.channel)return {handled:true,text:`I couldn't find a voice channel matching **${intent.destination}**.`};destination=r.channel;}
  if(['ban','kick','timeout'].includes(intent.action) && !confirmed){confirmations.create(message,{intent});return {handled:true,text:`This will **${intent.action.toUpperCase()}** ${members.length} member${members.length===1?'':'s'}. Reply **yes** to proceed or **no** to cancel.`};}
  const results=[];for(const member of members){if(intent.action==='voicedisconnect'&&!member.voice?.channel){results.push({ok:false,text:`${member.displayName} is not in voice.`});continue;}if(intent.action==='voicemove'&&!member.voice?.channel){results.push({ok:false,text:`${member.displayName} is not in voice.`});continue;}results.push(await execute({message,action:intent.action,target:member,destination,reason:intent.reason,durationMs:intent.durationMs,config,saveConfig}));}
  const ok=results.filter(r=>r.ok).length;if(ok&&intent.destination)context.set(message,{intent,candidates:[],destination:intent.destination});return {handled:true,text:`${ok}/${results.length} action${results.length===1?'':'s'} completed.${results.some(r=>!r.ok)?`\n\n${results.filter(r=>!r.ok).map(r=>`✗ ${r.text}`).join('\n')}`:''}`};
}

module.exports={route,deterministic,getIntent};
