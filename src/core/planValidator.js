const { PermissionsBitField, ChannelType } = require('discord.js');
const risk = require('./risk');
const { normalizePermission } = require('./discordActionUtils');

const ACTIONS = new Set([
  'server_analyze','server_relationship','server_investigate','server_snapshot','server_audit','server_restore','server_diff','undo','autopilot','history','incident_report','case_explain','member_profile','health_score','schedule_action','schedule_list','schedule_cancel','watch','watch_off',
  'pc_open_app','pc_close_app','pc_processes','pc_system_status','pc_active_window','pc_network_status','pc_state','pc_volume','pc_key','pc_mouse','pc_hotkey','pc_type','pc_screenshot','pc_open_url','pc_browser_search','pc_spotify_play','pc_spotify_control','pc_shell','pc_file_read','pc_file_write','pc_file_copy','pc_file_move','pc_file_delete','voicemove','voicedisconnect','voicemute','voiceunmute','voicedeafen','voiceundeafen',
  'textmute','textunmute','timeout','untimeout','kick','ban','warn',
  'role_permissions','role_edit','role_add','role_remove','role_create','role_delete',
  'channel_edit','channel_create','channel_delete','channel_permissions','member_nickname'
]);
const MAX_TARGETS = 100;
const MAX_STEPS = 20;

function cleanRef(x){ return String(x ?? '').trim().slice(0,120); }
function cleanPlan(plan){
  if (!plan || !Array.isArray(plan.steps)) return null;
  const steps = plan.steps.slice(0, MAX_STEPS).map(s => ({
    action: String(s?.action||'').trim().toLowerCase(),
    targets: Array.isArray(s?.targets) ? s.targets.map(cleanRef).filter(Boolean).slice(0,MAX_TARGETS) : [],
    excludeTargets: Array.isArray(s?.excludeTargets) ? s.excludeTargets.map(cleanRef).filter(Boolean).slice(0,MAX_TARGETS) : [],
    source: cleanRef(s?.source), destination: cleanRef(s?.destination), role: cleanRef(s?.role),
    channel: cleanRef(s?.channel), parent: cleanRef(s?.parent), channelType: cleanRef(s?.channelType || 'text').toLowerCase(), createParentIfMissing:Boolean(s?.createParentIfMissing), name: cleanRef(s?.name).slice(0,100), color: cleanRef(s?.color).slice(0,20), hoist: typeof s?.hoist==='boolean'?s.hoist:null, mentionable: typeof s?.mentionable==='boolean'?s.mentionable:null, reason: cleanRef(s?.reason).slice(0,500),
    durationMs: String(s?.action||'').toLowerCase()==='pc_volume' ? Number(s?.durationMs ?? s?.percent ?? s?.volume ?? 50) : Math.min(Math.max(Number(s?.durationMs)||600000,1000),28*24*60*60*1000),
    caseId: String(s?.caseId||'').trim(),
    permissionChanges: Array.isArray(s?.permissionChanges) ? s.permissionChanges.map(x=>({permission:cleanRef(x?.permission),enabled:Boolean(x?.enabled)})).filter(x=>x.permission).slice(0,30) : []
  })).filter(s=>ACTIONS.has(s.action));
  const needsConfirmation = Boolean(plan.needsConfirmation) || steps.some(s=>risk.level(s)>=3) || steps.some(s=>s.targets.some(t=>/^(everyone|everybody|all)$/i.test(t)) && ['role_add','role_remove','kick','ban','timeout','textmute'].includes(s.action)) || steps.some(s=>['role_create','role_permissions','channel_permissions'].includes(s.action) && s.permissionChanges.some(c=>c.enabled && /administrator|manage server|ban members|manage roles|manage channels/i.test(c.permission)));
  return {summary:cleanRef(plan.summary).slice(0,500), needsConfirmation, steps};
}

function validateStep(step, guild){
  const errors=[]; const warnings=[];
  if (!ACTIONS.has(step.action)) errors.push(`Unsupported action: ${step.action||'empty'}`);
  if (['pc_open_app','pc_close_app','pc_processes','pc_system_status','pc_active_window','pc_network_status','pc_state','pc_volume','pc_key','pc_mouse','pc_hotkey','pc_type','pc_screenshot','pc_open_url','pc_browser_search','pc_spotify_play','pc_spotify_control','pc_shell','pc_file_read','pc_file_write','pc_file_copy','pc_file_move','pc_file_delete','voicemove','channel_create','role_create','channel_edit','channel_delete','role_delete','role_permissions','channel_permissions','role_add','role_remove','member_nickname'].includes(step.action)) {
    if (['role_create','channel_create','channel_edit','channel_delete','role_delete','role_permissions','channel_permissions','role_add','role_remove'].includes(step.action) && !step.role && ['role_permissions','role_edit','role_add','role_remove','role_delete'].includes(step.action)) errors.push('Role is missing.');
  }
  if (['voicemove','voicedisconnect','voicemute','voiceunmute','voicedeafen','voiceundeafen','textmute','textunmute','timeout','untimeout','kick','ban','warn','role_add','role_remove','member_nickname'].includes(step.action) && !step.targets.length) errors.push('Target is missing.');
  if (['voicemove'].includes(step.action) && !step.destination) errors.push('Destination voice channel is missing.');
  if (step.action==='pc_open_app' && !step.name) errors.push('Application name is missing.');
  if (['pc_browser_search','pc_spotify_play'].includes(step.action) && !step.name) errors.push('Search/query is missing.');
  if (['pc_key','pc_mouse','pc_hotkey','pc_screenshot','pc_open_url','pc_browser_search','pc_spotify_play','pc_spotify_control','pc_file_read','pc_file_write','pc_file_copy','pc_file_move','pc_file_delete'].includes(step.action) && !step.name) errors.push('PC action target is missing.');
  if (step.action==='pc_type' && !step.reason) errors.push('Text to type is missing.');
  if (step.action==='pc_shell' && !step.reason) errors.push('Shell command is missing.');
  if (step.action==='pc_file_write' && !step.reason) errors.push('File content is missing.');
  if (['pc_shell','pc_file_delete','pc_file_move','pc_file_write'].includes(step.action)) warnings.push('This PC action can modify the local computer.');
  if (step.action==='channel_edit' && (!step.channel || !step.name)) errors.push('Channel and new name are required.');
  if (step.action==='channel_create' && !step.name) errors.push('Channel name is missing.');
  if (step.action==='role_create' && !step.name) errors.push('Role name is missing.');
  if (step.action==='role_permissions' && (!step.role || !step.permissionChanges.length)) errors.push('Role and permission changes are required.');
  if (step.action==='channel_permissions' && (!step.channel || !step.permissionChanges.length)) errors.push('Channel and permission changes are required.');
  for (const change of step.permissionChanges) if (!normalizePermission(change.permission)) errors.push(`Unknown permission: ${change.permission}`);
  if (step.targets.length > MAX_TARGETS) warnings.push(`Target list capped at ${MAX_TARGETS}.`);
  if (step.action==='server_restore') warnings.push('Restore is best-effort and cannot recreate deleted Discord objects from a snapshot.');
  return {ok:errors.length===0,errors,warnings,risk:risk.label(risk.level(step))};
}
function validatePlan(plan,guild){
  const cleaned=cleanPlan(plan); if(!cleaned) return {ok:false,plan:null,errors:['Planner returned no valid plan.'],warnings:[]};
  const errors=[]; const warnings=[]; const details=[];
  cleaned.steps.forEach((s,i)=>{const v=validateStep(s,guild);details.push({index:i+1,action:s.action,...v});errors.push(...v.errors.map(e=>`Step ${i+1}: ${e}`));warnings.push(...v.warnings.map(w=>`Step ${i+1}: ${w}`));});
  if(cleaned.steps.length===0) warnings.push('No executable steps were produced.');
  if(cleaned.steps.length===MAX_STEPS && Array.isArray(plan.steps) && plan.steps.length>MAX_STEPS) warnings.push(`Plan truncated to ${MAX_STEPS} steps.`);
  return {ok:errors.length===0,plan:cleaned,errors,warnings,details};
}
function summarize(plan, details=[]){
  return plan.steps.map((s,i)=>`${i+1}. **${s.action}**${s.targets.length?` → ${s.targets.join(', ')}`:''}${s.role?` → @${s.role.replace(/^@/,'')}`:''}${s.channel?` → #${s.channel.replace(/^#/,'')}`:''}${s.destination?` → 🔊 ${s.destination}`:''}${s.name?` → ${s.name}`:''} — ${details[i]?.risk||risk.label(risk.level(s))}`).join('\n');
}
module.exports={ACTIONS,MAX_STEPS,cleanPlan,validateStep,validatePlan,summarize};
