const { PermissionsBitField, ChannelType } = require('discord.js');
const { parseAgentPlan } = require('../ai');
const { resolveMember, resolveChannel } = require('./resolver');
const { resolveRole, resolveChannelAny, normalizePermission } = require('./discordActionUtils');
const { execute } = require('./executor');
const journal = require('./journal');
const { getSession } = require('../v8/core');
const snapshots = require('./snapshots');
const risk = require('./risk');
const serverBrain = require('./serverBrain');
const awareness = require('./awareness');
const serverKnowledge = require('./serverKnowledge');
const serverGraph = require('./serverGraph');
const { validatePlan, summarize: summarizePlan } = require('./planValidator');

const MAX_STEPS = 20;
const MAX_AGENT_LOOPS = Math.min(Math.max(Number(process.env.JARVIS_AGENT_LOOPS || 2), 1), 4);
const HIGH_RISK = new Set(['ban','kick','timeout','role_permissions','role_add','role_remove','channel_edit','channel_delete','role_delete','channel_create','role_create','member_nickname','channel_permissions','server_restore','autopilot','server_relationship']);


// Deterministic safety-net for common multi-step administration requests.
// The AI planner remains the primary natural-language planner, but a temporary
// model failure must not turn a clearly structured request into "no valid plan".
function deterministicAgentPlan(prompt) {
  const raw=String(prompt||'').replace(/^jarvis\b[,:!\s-]*/i,'').trim();
  if(!raw)return null;
  const base=(action,extra={})=>({action,targets:[],excludeTargets:[],source:'',destination:'',role:'',channel:'',parent:'',channelType:'text',name:'',permissionChanges:[],reason:'Owner-directed JARVIS action',durationMs:600000,...extra});
  if(/^(?:undo|reverse|revert)(?:\s+(?:the\s+)?(?:last|previous)(?:\s+(?:thing|action|change|command))?(?:\s+jarvis\s+(?:did|made))?)?\s*$/i.test(raw))return{summary:'Undo the most recent reversible JARVIS action.',needsConfirmation:false,steps:[base('undo')]};
  let m=raw.match(/^(?:move|drag|send)\s+(everyone|everybody|all)\s+in\s+(.+?)\s+(?:to|into)\s+(.+?)(?:\s+except\s+(.+))?$/i);
  if(m)return{summary:`Move everyone from ${m[2].trim()} to ${m[3].trim()}.`,needsConfirmation:false,steps:[base('voicemove',{targets:['everyone'],source:m[2].trim(),destination:m[3].trim(),excludeTargets:m[4]?splitVoiceTargets(m[4]):[]})]};
  m=raw.match(/^(?:move|drag|send)\s+(.+?)\s+(?:from\s+(.+?)\s+)?(?:to|into)\s+(.+)$/i);
  if(m){let targetText=m[1].trim(),source=(m[2]||'').trim(),excludeTargets=[];const ex=targetText.match(/^(.+?)\s+except\s+(.+)$/i);if(ex){targetText=ex[1].trim();excludeTargets=splitVoiceTargets(ex[2]);}return{summary:`Move ${targetText} to ${m[3].trim()}.`,needsConfirmation:false,steps:[base('voicemove',{targets:splitVoiceTargets(targetText),excludeTargets,source,destination:m[3].trim()})]};}
  // Accept both "make a role" and "make the role". The V14.5.4 parser only
  // accepted the former, causing the exact owner request "make the role named
  // \"labubu\" ..." to fall through to the conversational/V9 router.
  m=raw.match(/^(?:make|create)\s+(?:(?:a|the)\s+)?role\s+named\s+["“](.+?)["”]\s*,?\s*(?:with|that\s+has)\s+(.+?)\s*(?:,?\s+and\s+then|\s+then)\s+(?:give|add)\s+(?:it|that\s+role|the\s+role)\s+to\s+(.+)$/i);
  if(!m)m=raw.match(/^(?:make|create)\s+(?:(?:a|the)\s+)?role\s+named\s+["“](.+?)["”]\s*,?\s*(?:with|that\s+has)\s+(.+?)\s*,?\s+and\s+(?:give|add)\s+(?:it|that\s+role|the\s+role)\s+to\s+(.+)$/i);
  if(m){const permissionChanges=parsePermissionList(m[2]);if(m[1].trim()&&permissionChanges.length&&m[3].trim())return{summary:`Create role "${m[1].trim()}" with the requested permissions and assign it to ${m[3].trim()}.`,needsConfirmation:false,steps:[base('role_create',{name:m[1].trim(),permissionChanges}),base('role_add',{role:m[1].trim(),targets:splitVoiceTargets(m[3].trim())})]};}
  // Also accept an unquoted role name for ordinary natural-language commands.
  if(!m)m=raw.match(/^(?:make|create)\s+(?:(?:a|the)\s+)?role\s+named\s+(.+?)\s+(?:with|that\s+has)\s+(.+?)\s*,?\s+and\s+(?:give|add)\s+(?:it|that\s+role|the\s+role)\s+to\s+(.+)$/i);
  if(m){const permissionChanges=parsePermissionList(m[2]);const name=m[1].trim().replace(/^["“]|["”]$/g,'').trim();if(name&&permissionChanges.length&&m[3].trim())return{summary:`Create role "${name}" with the requested permissions and assign it to ${m[3].trim()}.`,needsConfirmation:false,steps:[base('role_create',{name,permissionChanges}),base('role_add',{role:name,targets:splitVoiceTargets(m[3].trim())})]};}
  m=raw.match(/^(?:make|create)\s+(?:a\s+)?(?:text\s+)?channel\s+named\s+["“]?(.+?)["”]?\s+in\s+(?:a\s+)?(?:category|catagory)\s+named\s+["“]?(.+?)["”]?\s*$/i);
  if(m)return{summary:`Create channel "${m[1].trim()}" in category "${m[2].trim()}".`,needsConfirmation:true,steps:[base('channel_create',{name:m[1].trim(),parent:m[2].trim(),channelType:'text',createParentIfMissing:true})]};
  m=raw.match(/^(?:make|create)\s+(?:a\s+)?(voice|stage|forum|announcement|text|category)\s+channel\s+named\s+["“]?(.+?)["”]?\s*$/i);
  if(m)return{summary:`Create ${m[1].toLowerCase()} channel "${m[2].trim()}".`,needsConfirmation:true,steps:[base('channel_create',{name:m[2].trim(),channelType:m[1].toLowerCase()})]};
  m=raw.match(/^(?:make|create)\s+(?:a\s+)?channel\s+named\s+["“]?(.+?)["”]?\s*$/i);
  if(m)return{summary:`Create channel "${m[1].trim()}".`,needsConfirmation:true,steps:[base('channel_create',{name:m[1].trim(),channelType:'text'})]};
  return null;
}
function splitVoiceTargets(text=''){return String(text).replace(/\s+(?:and|n|&)\s+/gi,',').split(',').map(x=>x.trim()).filter(Boolean);}
function parsePermissionList(text=''){const changes=[];for(const part of String(text).split(/\s*(?:,|\band\b)\s*/i)){const x=part.trim();if(!x)continue;const off=x.match(/^(?:without|no|remove|deny|disable|take away|revoke)\s+(.+?)(?:\s+access)?$/i);const on=x.match(/^(?:with|has|have|allow|enable|grant|give)\s+(.+?)(?:\s+access)?$/i);if(off)changes.push({permission:off[1].trim(),enabled:false});else if(on)changes.push({permission:on[1].trim(),enabled:true});else changes.push({permission:x.replace(/\s+access$/i,'').trim(),enabled:true});}return changes;}

function cleanPlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) return null;
  const steps = plan.steps.slice(0, MAX_STEPS).map((s) => ({
    action: String(s?.action || '').trim().toLowerCase(),
    targets: Array.isArray(s?.targets) ? s.targets.map(String).map(x => x.trim()).filter(Boolean).slice(0, 50) : [],
    excludeTargets: Array.isArray(s?.excludeTargets) ? s.excludeTargets.map(String).map(x => x.trim()).filter(Boolean).slice(0, 50) : [],
    source: String(s?.source || '').trim(), destination: String(s?.destination || '').trim(),
    role: String(s?.role || '').trim(), channel: String(s?.channel || '').trim(), parent: String(s?.parent || '').trim(), channelType: String(s?.channelType || 'text').trim().toLowerCase(), name: String(s?.name || '').trim().slice(0,100),
    permissionChanges: Array.isArray(s?.permissionChanges) ? s.permissionChanges.map(x => ({permission:String(x?.permission||'').trim(),enabled:Boolean(x?.enabled)})).filter(x=>x.permission).slice(0,30) : [],
    createParentIfMissing:Boolean(s?.createParentIfMissing),
    reason: String(s?.reason || '').trim().slice(0,500), durationMs: Math.min(Math.max(Number(s?.durationMs)||600000,1000),28*24*60*60*1000),
  })).filter(s => s.action);
  return { summary:String(plan.summary||'').trim().slice(0,500), needsConfirmation:Boolean(plan.needsConfirmation)||steps.some(s=>HIGH_RISK.has(s.action)), steps };
}

async function resolveTargets(message, refs, {voiceOnly=false}={}) {
  const members=[];
  for (const ref of refs) {
    if (/^(everyone|everybody|all)$/i.test(ref)) {
      await message.guild.members.fetch().catch(()=>{});
      members.push(...message.guild.members.cache.values());
      continue;
    }
    if (/^(me|myself|i)$/i.test(ref)) { if (message.member) members.push(message.member); continue; }
    const r=await resolveMember(message.guild,ref);
    if (r.status==='ambiguous') throw new Error(`Multiple members match **${ref}**: ${r.candidates.slice(0,6).map((m,i)=>`${i+1}. ${m.user.tag}`).join(', ')}`);
    if (r.status==='missing') throw new Error(`I couldn't find **${ref}**.`);
    if (r.member && !members.some(m=>m.id===r.member.id)) members.push(r.member);
  }
  let result=members.filter(m=>!m.user.bot);
  if (voiceOnly) result=result.filter(m=>m.voice?.channel);
  return result;
}

function exclude(members, refs) { const ids=new Set(refs.map(String)); return members.filter(m=>!ids.has(m.id)); }

async function resolveDestination(guild, query, voiceOnly=false) {
  if (!query) return null;
  const r=resolveChannel(guild,query,{voiceOnly});
  if (r.status==='ambiguous') throw new Error(`Multiple channels match **${query}**: ${r.candidates.slice(0,6).map(c=>c.name).join(', ')}`);
  if (!r.channel) throw new Error(`I couldn't find channel **${query}**.`);
  return r.channel;
}

async function runStep({message,step,config,saveConfig,dryRun=false}) {
  const action=step.action;
  if(action==='server_relationship') { const graph=await serverGraph.build(message.guild); const diagnosis=serverGraph.diagnose(graph,step.reason||''); return {ok:true,text:serverGraph.format(graph,diagnosis)}; }
  if(action==='server_analyze') { const report=await serverBrain.analyze(message.guild); return {ok:true,text:serverBrain.format(report)}; }
  if(action==='server_investigate') { const reasoning=require('./reasoning'); const report=await reasoning.investigate(message.guild,config,saveConfig,{focus:step.reason}); return {ok:true,text:reasoning.format(report)}; }
  if(action==='server_snapshot') { if(dryRun)return {ok:true,simulated:true,text:'Would save a complete JARVIS server snapshot.'}; const snap=await snapshots.create(message.guild,config,saveConfig,{reason:step.reason||'Manual snapshot'}); return {ok:true,text:`Saved server snapshot **${snap.id.slice(0,8)}**.`}; }
  if(action==='server_restore') { if(dryRun)return {ok:true,simulated:true,text:'Would restore the latest saved server snapshot where Discord permits.'}; const r=await snapshots.restoreLatest(message.guild,config,saveConfig); return {ok:r.ok,text:r.text}; }
  if(action==='server_audit') { const logs=await message.guild.fetchAuditLogs({limit:15}).catch(()=>null); if(!logs)return {ok:false,text:'I could not access the audit log.'}; return {ok:true,text:`**RECENT AUDIT ACTIVITY**\n${[...logs.entries.values()].slice(0,10).map(e=>`• ${String(e.action)} — ${e.executor?.tag||'unknown'} — ${e.target?.name||e.target?.tag||e.target?.id||'unknown'}`).join('\n')}`}; }
  if(action==='server_diff') { const snap=snapshots.latest(config); if(!snap)return {ok:false,text:'There is no saved snapshot to compare against, sir.'}; const current=await snapshots.capture(message.guild); const d=snapshots.diff(current,snap); return {ok:true,text:`**SNAPSHOT DIFFERENCE**\nRoles — added: ${d.roles.added.length}, removed: ${d.roles.removed.length}, changed: ${d.roles.changed.length}\nChannels — added: ${d.channels.added.length}, removed: ${d.channels.removed.length}, changed: ${d.channels.changed.length}`}; }
  if(action==='undo') { const entry=journal.latest(config,e=>e.reversible); if(!entry)return {ok:false,text:'I could not find a recent reversible JARVIS action, sir.'}; return undo({message,entry,config,saveConfig}); }
  if(action==='autopilot') { config.v12??={}; config.v12.autopilot??={enabled:false}; const on=!/^off|disable|stop$/i.test(step.name||'on'); if(dryRun)return {ok:true,simulated:true,text:`Would turn Autopilot **${on?'ON':'OFF'}**.`}; config.v12.autopilot.enabled=on; saveConfig(message.guild.id,config); return {ok:true,text:`Server Autopilot is now **${on?'ONLINE':'OFFLINE'}**.`}; }
  if (['voicemove','voicedisconnect','voicemute','voiceunmute','voicedeafen','voiceundeafen','textmute','textunmute','timeout','untimeout','kick','ban','warn'].includes(action)) {
    let members=await resolveTargets(message,step.targets,{voiceOnly:action.startsWith('voice')});
    if (step.source) { const source=await resolveDestination(message.guild,step.source,true); members=members.filter(m=>m.voice?.channelId===source.id); }
    if (step.excludeTargets.length) { const ex=await resolveTargets(message,step.excludeTargets); members=exclude(members,ex.map(m=>m.id)); }
    const destination=step.destination?await resolveDestination(message.guild,step.destination,true):null;
    const results=[];
    for (const member of members) {
      if ((action==='voicemove'||action==='voicedisconnect') && !member.voice?.channel) { results.push({ok:false,text:`${member.displayName} is not in voice.`}); continue; }
      results.push(await execute({message,action,target:member,destination,reason:step.reason,durationMs:step.durationMs,config,saveConfig,dryRun}));
    }
    return {ok:results.every(r=>r.ok),text:`${results.filter(r=>r.ok).length}/${results.length} ${action} action(s) completed.`,details:results};
  }
  if (action==='role_permissions'||action==='role_add'||action==='role_remove') {
    const targetResult=action==='role_permissions'?[]:await resolveTargets(message,step.targets);
    const filteredTargets = action==='role_permissions' ? [] : (step.excludeTargets.length ? targetResult.filter(m=>!new Set(step.excludeTargets.map(String)).has(m.id)) : targetResult);
    return execute({message,action,target:null,destination:null,reason:step.reason,config,saveConfig,dryRun,role:step.role,permissionChanges:step.permissionChanges,targets:filteredTargets.map(m=>m.id)});
  }
  if (action==='channel_edit') return execute({message,action,target:null,config,saveConfig,role:step.role,permissionChanges:step.permissionChanges,targets:step.targets,channel:step.channel,name:step.name,reason:step.reason,dryRun});
  if (action==='channel_create') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) throw new Error('You need Manage Channels.');
    if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) throw new Error('I need Manage Channels.');
    const existing=message.guild.channels.cache.find(c=>c.name.toLowerCase()===step.name.toLowerCase()); if(existing) return {ok:false,text:`Channel **${step.name}** already exists.`};
    const typeMap={text:ChannelType.GuildText,voice:ChannelType.GuildVoice,stage:ChannelType.GuildStageVoice,category:ChannelType.GuildCategory,announcement:ChannelType.GuildAnnouncement,forum:ChannelType.GuildForum};
    const type=typeMap[step.channelType]||ChannelType.GuildText;
    let parent=step.parent?await resolveDestination(message.guild,step.parent,false).catch(()=>null):null; let parentEntry=null;
    if(step.parent&&!parent&&step.createParentIfMissing){const existing=message.guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory&&c.name.toLowerCase()===step.parent.toLowerCase());if(existing)parent=existing;else if(!dryRun){parent=await message.guild.channels.create({name:step.parent,type:ChannelType.GuildCategory,reason:'JARVIS: requested parent category'});parentEntry=journal.record(config,{action:'CHANNEL_CREATE',actorId:message.author.id,targetId:parent.id,reason:'Created requested parent category',before:null,after:{name:parent.name,type:parent.type,parentId:null},reversible:true,undo:{kind:'channel_delete',targetId:parent.id}});}else parent={name:step.parent,id:null};}
    if(step.parent&&!parent)throw new Error(`I couldn't find category **${step.parent}**.`);
    if(dryRun) return {ok:true,simulated:true,text:`Would create ${step.channelType||'text'} channel **${step.name}**${parent?` under **${parent.name}**`:''}.`};
    const ch=await message.guild.channels.create({name:step.name,type,parent:parent?.id||undefined});
    const entry=journal.record(config,{action:'CHANNEL_CREATE',actorId:message.author.id,targetId:ch.id,reason:step.reason,before:null,after:{name:ch.name,type:ch.type,parentId:ch.parentId},reversible:true,undo:{kind:'channel_delete',targetId:ch.id}}); saveConfig(message.guild.id,config);
    return {ok:true,text:`Created ${step.channelType||'text'} channel **#${ch.name}**.`,channelId:ch.id,case:entry,cases:[...(parentEntry?[parentEntry]:[]),entry]};
  }
  if (action==='channel_delete') {
    const ch=await resolveDestination(message.guild,step.channel,false); if(!ch.deletable) throw new Error(`Discord will not let me delete **${ch.name}**.`);
    if(dryRun) return {ok:true,simulated:true,text:`Would delete **#${ch.name}**.`};
    const name=ch.name; const id=ch.id; await ch.delete(step.reason||'JARVIS V11'); journal.record(config,{action:'CHANNEL_DELETE',actorId:message.author.id,targetId:id,reason:step.reason,before:{name},after:null,reversible:false}); saveConfig(message.guild.id,config); return {ok:true,text:`Deleted **#${name}**.`};
  }
  if (action==='role_create') {
    if(!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) throw new Error('I need Manage Roles.');
    const perms=new PermissionsBitField();
    for(const c of step.permissionChanges||[]){const flag=normalizePermission(c.permission);if(!flag)throw new Error(`Unknown permission **${c.permission}**.`);if(c.enabled)perms.add(flag);}
    if(dryRun) return {ok:true,simulated:true,text:`Would create role **${step.name}**${step.permissionChanges.length?` with ${step.permissionChanges.length} permission change(s)`:''}.`};
    const role=await message.guild.roles.create({name:step.name,permissions:perms,reason:step.reason||'JARVIS V12'}); journal.record(config,{action:'ROLE_CREATE',actorId:message.author.id,targetId:role.id,reason:step.reason,before:null,after:{name:role.name,permissions:role.permissions.bitfield.toString()},reversible:false}); saveConfig(message.guild.id,config); return {ok:true,text:`Created role **${role.name}**.`,roleId:role.id};
  }
  if (action==='role_delete') {
    const rr=resolveRole(message.guild,step.role); if(rr.status!=='resolved') throw new Error(`I couldn't uniquely resolve role **${step.role}**.`); if(rr.role.managed||!rr.role.editable) throw new Error(`Discord will not let me delete **${rr.role.name}**.`);
    if(dryRun) return {ok:true,simulated:true,text:`Would delete role **${rr.role.name}**.`};
    const name=rr.role.name,id=rr.role.id; await rr.role.delete(step.reason||'JARVIS V11'); journal.record(config,{action:'ROLE_DELETE',actorId:message.author.id,targetId:id,reason:step.reason,before:{name},after:null,reversible:false}); saveConfig(message.guild.id,config); return {ok:true,text:`Deleted role **${name}**.`};
  }
  if (action==='member_nickname') {
    const members=await resolveTargets(message,step.targets); const results=[]; for(const m of members){ if(!m.manageable){results.push(`✗ ${m.displayName}: not manageable`);continue;} if(dryRun){results.push(`✓ would rename ${m.displayName} → ${step.name}`);continue;} await m.setNickname(step.name||null,step.reason||'JARVIS V11'); results.push(`✓ ${m.displayName}`); } return {ok:results.every(x=>x.startsWith('✓')),text:results.join('\n')};
  }
  if (action==='channel_permissions') {
    const ch=await resolveDestination(message.guild,step.channel,false); if(!ch.manageable) throw new Error(`Discord will not let me edit **${ch.name}**.`);
    const rr=resolveRole(message.guild,step.role); if(rr.status!=='resolved') throw new Error(`I couldn't uniquely resolve role **${step.role}**.`);
    const overwrites=step.permissionChanges.map(c=>[normalizePermission(c.permission),c.enabled]); if(overwrites.some(([f])=>!f)) throw new Error('One or more permissions are unknown.');
    if(dryRun) return {ok:true,simulated:true,text:`Would update **#${ch.name}** permissions for **${rr.role.name}**.`};
    const allow=overwrites.filter(([,e])=>e).map(([f])=>f),deny=overwrites.filter(([,e])=>!e).map(([f])=>f); await ch.permissionOverwrites.edit(rr.role,{allow,deny}, step.reason||'JARVIS V11'); return {ok:true,text:`Updated **#${ch.name}** permissions for **${rr.role.name}**.`};
  }
  throw new Error(`Unsupported agent action: ${action}`);
}


async function verifyStep(message, step, result) {
  if (!result?.ok) return {ok:false, reason: result?.text || 'Execution failed.'};
  try {
    const guild=message.guild;
    if (step.action==='voicemove') {
      const members=await resolveTargets(message,step.targets,{voiceOnly:false});
      const destination=step.destination?await resolveDestination(guild,step.destination,true):null;
      if(destination && step.targets.length) {
        const excluded=new Set((step.excludeTargets||[]).map(String).map(x=>x.toLowerCase()));
        const failed=members.filter(m=>!excluded.has(m.id)&&!excluded.has(m.user?.username?.toLowerCase())&&m.voice?.channelId!==destination.id);
        if(failed.length) return {ok:false,reason:`${failed.length} member(s) did not end up in **${destination.name}**.`};
      }
    }
    if (step.action==='role_permissions') {
      const rr=resolveRole(guild,step.role); if(rr.status!=='resolved') return {ok:false,reason:`Could not verify role **${step.role}**.`};
      for(const c of step.permissionChanges){const flag=normalizePermission(c.permission);if(flag===null)continue;const actual=rr.role.permissions.has(flag);if(actual!==c.enabled)return {ok:false,reason:`Permission **${c.permission}** did not match the requested state after execution.`};}
    }
    if (step.action==='role_create' && result.roleId) {
      const role=guild.roles.cache.get(result.roleId); if(!role)return {ok:false,reason:'Created role could not be found after creation.'};
      for(const c of step.permissionChanges||[]){const flag=normalizePermission(c.permission);if(flag&&role.permissions.has(flag)!==c.enabled)return {ok:false,reason:`Created role permission **${c.permission}** could not be verified.`};}
    }
    if (step.action==='role_add' || step.action==='role_remove') {
      const rr=resolveRole(guild,step.role); if(rr.status!=='resolved')return {ok:false,reason:`Could not verify role **${step.role}**.`};
      for(const ref of step.targets){const mr=await resolveMember(guild,ref);if(mr.status!=='resolved')continue;const has=mr.member.roles.cache.has(rr.role.id);if(step.action==='role_add'&&!has)return {ok:false,reason:`${mr.member.displayName} does not have **${rr.role.name}** after assignment.`};if(step.action==='role_remove'&&has)return {ok:false,reason:`${mr.member.displayName} still has **${rr.role.name}** after removal.`};}
    }
    if (step.action==='channel_edit') {
      let ch=result.channelId?guild.channels.cache.get(result.channelId):null;
      if(!ch) ch=guild.channels.cache.find(c=>c.name===step.name);
      if(!ch || ch.name!==step.name)return {ok:false,reason:'Channel rename could not be verified.'};
    }
    if (step.action==='channel_create' && result.channelId) {
      const ch=guild.channels.cache.get(result.channelId); if(!ch)return {ok:false,reason:'Created channel could not be found after creation.'};
    }
    if (step.action==='member_nickname') {
      for(const ref of step.targets){const mr=await resolveMember(guild,ref);if(mr.status==='resolved'&&mr.member.displayName!==step.name)return {ok:false,reason:`Nickname for ${mr.member.user.tag} could not be verified.`};}
    }
    return {ok:true};
  } catch(e){ return {ok:false,reason:`Verification error: ${String(e.message||e).slice(0,220)}`}; }
}
async function executePlan({message,plan,config,saveConfig,dryRun=false}) {
  const outputs=[];
  for(let i=0;i<plan.steps.length;i++) {
    const step=plan.steps[i];
    try {
      const result=await runStep({message,step,config,saveConfig,dryRun});
      const verification=await verifyStep(message,step,result);
      const combined={...result,verified:verification.ok};
      if(!verification.ok && result.ok) combined.text=`${result.text}\n⚠ Verification: ${verification.reason}`;
      outputs.push(combined);
      if(!result.ok || !verification.ok) break;
    } catch(e){ outputs.push({ok:false,verified:false,text:String(e.message||e).slice(0,500)}); break; }
  }
  saveConfig(message.guild.id,config);
  const success=outputs.filter(x=>x.ok&&x.verified!==false).length;
  const verified=outputs.filter(x=>x.verified).length;
  const failed=outputs.find(x=>!x.ok||x.verified===false);
  journal.record(config,{action:'PLAN_EXECUTION',actorId:message.author.id,reason:plan.summary,before:null,after:{steps:success,total:plan.steps.length,verified},reversible:false,metadata:{summary:plan.summary,steps:plan.steps.map(s=>s.action)}});
  saveConfig(message.guild.id,config);
  return {handled:true,text:`**JARVIS V12 EXECUTION**\n${success}/${plan.steps.length} step(s) completed and ${verified}/${Math.max(success,1)} verified.${failed?`\n⚠ ${failed.text||'A step failed.'}`:''}${outputs.map((x,i)=>`\n${x.ok&&x.verified!==false?'✓':'✗'} ${i+1}. ${x.text}`).join('')}`};
}

async function runAgent({message,prompt,config,saveConfig,confirmed=false}) {
  const isOwner=String(process.env.JARVIS_OWNER_ID||'')===String(message.author.id);
  if(!isOwner) return {handled:false};
  const raw=String(prompt||'').replace(/^jarvis\b[,:!\s-]*/i,'').trim();
  if(!raw) return {handled:false};
  const deterministicPlan=deterministicAgentPlan(raw);
  if(deterministicPlan?.steps?.length===1&&deterministicPlan.steps[0].action==='undo'){const entry=journal.latest(config,e=>e.reversible&&e.status==='SUCCESS');if(!entry)return{handled:true,text:'I could not find a recent reversible JARVIS action, sir.'};const result=await undo({message,entry,config,saveConfig});return{handled:true,text:result.text};}
  const session=getSession(config,message.guild.id,message.author.id)||[]; const recentContext=session.slice(-10).map(x=>`${x.role==='model'?'JARVIS':'USER'}: ${String(x.text||'').slice(0,500)}`).join('\n'); const live=await awareness.snapshot(message.guild).catch(()=>null); const liveContext=live?`LIVE SERVER CONTEXT (reference only; do not invent beyond this):\n${awareness.format(live)}`:''; const knowledge=serverKnowledge.context(config,message.guild.id); const plannerPrompt=[liveContext,knowledge,recentContext?`RECENT CONVERSATION CONTEXT:\n${recentContext}`:'',`CURRENT REQUEST:\n${raw}`].filter(Boolean).join('\n\n'); const rawPlan=deterministicPlan||await parseAgentPlan({message,prompt:plannerPrompt});

  // Planner failure is NOT a failed user request. A null plan means the AI
  // planner could not classify the message as an executable Discord action
  // (or the planner temporarily failed). Fall through to the normal V9 /
  // conversational pipeline so questions such as "what is 5x5x5?" or
  // "who is Michael Jackson?" are answered by JARVIS instead of producing
  // the misleading "no valid plan" error.
  if (!rawPlan) return {handled:false};

  const validation=validatePlan(rawPlan,message.guild);
  if(!validation.ok){ return {handled:true,text:`I couldn't safely build that plan, sir.\n${validation.errors.slice(0,5).map(x=>`• ${x}`).join('\n')}`}; }
  const plan=validation.plan;
  if(!plan || !plan.steps.length) return {handled:false};
  const simulation=/^(?:simulate|dry run|dry-run)\b/i.test(raw);
  if(!simulation && (plan.needsConfirmation || plan.steps.some(s=>risk.level(s)>=3)) && !confirmed) {
    const preview=summarizePlan(plan,validation.details);
    const token=Buffer.from(JSON.stringify({plan,createdAt:Date.now()})).toString('base64url');
    config.v11??={}; config.v11.pendingPlans??={}; config.v11.pendingPlans[`${message.guild.id}:${message.author.id}`]={token,plan,expiresAt:Date.now()+60000}; saveConfig(message.guild.id,config);
    return {handled:true,text:`**JARVIS V11 PLAN**\n${plan.summary||'I have prepared the requested operations.'}\n\n${preview}\n\nReply **yes** to execute, or **no** to cancel.`};
  }
  if(confirmed) {
    const key=`${message.guild.id}:${message.author.id}`; const pending=config.v11?.pendingPlans?.[key]; if(!pending||pending.expiresAt<Date.now()) return {handled:true,text:'That plan has expired, sir. Please give the command again.'}; config.v11.pendingPlans[key]=null;
  }
  if(simulation && !confirmed) { return executePlan({message,plan,config,saveConfig,dryRun:true}); }
  if(!config.v12?.snapshots?.disabled) await snapshots.create(message.guild,config,saveConfig,{reason:plan.summary||'Before JARVIS plan'});
  let currentPlan=plan; let finalResult=null;
  for(let loop=0; loop<MAX_AGENT_LOOPS; loop++){
    finalResult=await executePlan({message,plan:currentPlan,config,saveConfig});
    serverKnowledge.recordEvent(config,message.guild.id,{action:'PLAN_EXECUTION',detail:currentPlan.summary||'Agent plan',status:finalResult.text?.includes('⚠')?'PARTIAL':'SUCCESS'});
    if(!finalResult.text?.includes('⚠') || loop===MAX_AGENT_LOOPS-1) break;
    const repairPrompt=`The previous JARVIS plan partially failed. Create a SMALL repair plan using the current live server state. Do not repeat successful actions. Previous result:\n${finalResult.text.slice(0,1800)}\nOriginal request:\n${raw}`;
    const repair=validatePlan(await parseAgentPlan({message,prompt:repairPrompt}),message.guild);
    if(!repair.ok || !repair.plan?.steps?.length) break;
    currentPlan=repair.plan;
  }
  saveConfig(message.guild.id,config);
  return finalResult;
}

async function confirmPending({message,text,config,saveConfig}) {
  const key=`${message.guild.id}:${message.author.id}`; const pending=config.v11?.pendingPlans?.[key]; if(!pending) return null;
  if(Date.now()>pending.expiresAt){config.v11.pendingPlans[key]=null;saveConfig(message.guild.id,config);return {handled:true,text:'The pending plan expired, sir.'};}
  if(/^no|cancel/i.test(text)){config.v11.pendingPlans[key]=null;saveConfig(message.guild.id,config);return {handled:true,text:'Cancelled. No changes were made.'};}
  if(/^yes|confirm|do it/i.test(text)){config.v11.pendingPlans[key]=null;saveConfig(message.guild.id,config);if(!config.v12?.snapshots?.disabled) await snapshots.create(message.guild,config,saveConfig,{reason:pending.plan.summary||'Before confirmed JARVIS plan'});return executePlan({message,plan:pending.plan,config,saveConfig});}
  return null;
}
module.exports={runAgent,confirmPending,cleanPlan,executePlan,deterministicAgentPlan};
