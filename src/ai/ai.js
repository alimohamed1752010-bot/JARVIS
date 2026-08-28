const { getMemory, clearMemory, getFacts } = require('./memory');
const { systemPrompt } = require('./personality');
const { ensureV8, getSession, pushSession, getSessionSummary, setSessionSummary, allowRequest, recordUsage, acquireRequestLock, releaseRequestLock } = require('../v8/core');
const { runToolRequest } = require('../v8/tools');
const serverKnowledge = require('../core/serverKnowledge');

const MAX_MESSAGE_CHARS = 2200;
const COOLDOWN_MS = 1200;
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);
const cooldowns = new Map();
const queues = new Map();
let aiClientPromise = null;

function cleanText(text) { return String(text || '').replace(/<@!?\d+>/g,'@user').replace(/<@&\d+>/g,'@role').replace(/<#[^>]+>/g,'#channel').trim().slice(0,MAX_MESSAGE_CHARS); }
function cairoNow(){ return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',dateStyle:'full',timeStyle:'long'}).format(new Date()); }
function getAIStatus(){
  const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
  const enabled=String(process.env.AI_ENABLED??'true').toLowerCase()!=='false';
  // Stable models only. Do not depend on retired preview aliases.
  const model=String(process.env.GEMINI_MODEL||'gemini-2.5-flash-lite').trim();
  const fallbackModel=String(process.env.GEMINI_FALLBACK_MODEL||'gemini-2.5-flash').trim();
  return {enabled,configured:Boolean(apiKey),model,fallbackModel,keyFormat:apiKey?'configured':'missing'};
}
async function getAIClient(){ if(aiClientPromise)return aiClientPromise; const apiKey=String(process.env.GEMINI_API_KEY||'').trim(); if(!apiKey)throw new Error('GEMINI_API_KEY is missing from the environment.'); aiClientPromise=import('@google/genai').then(({GoogleGenAI})=>new GoogleGenAI({apiKey})).catch(e=>{aiClientPromise=null;throw e}); return aiClientPromise; }
function needsLiveSearch(prompt){ return /\b(latest|current|currently|today|tonight|yesterday|tomorrow|recent|newest|release date|released|aired|episode|episodes|schedule|theater|theatre|cinema|movies? in theaters?|news|weather|price|prices|score|scores|standings|stock|market|who won|what happened|this week|this month)\b/i.test(String(prompt||'')); }
function withTimeout(promise, ms){ return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`AI request timed out after ${ms}ms.`),{code:'AI_TIMEOUT'})),ms))]); }
function transientError(error){
  const status=Number(error?.status||error?.statusCode||0);
  const t=String(error?.message||error||'').toLowerCase();
  // Treat model-not-found / invalid-model errors as fallback-eligible too.
  // This prevents a stale Railway variable from taking the whole conversation system down.
  const modelError=t.includes('model not found')||t.includes('not found for api version')||t.includes('unknown model')||t.includes('invalid model')||t.includes('is not found')||t.includes('unsupported model');
  return status===400||status===404||status===429||status===500||status===502||status===503||status===504||
    modelError||t.includes('high demand')||t.includes('temporarily unavailable')||t.includes('unavailable')||
    t.includes('overloaded')||t.includes('rate limit')||t.includes('timeout');
}

async function generate({guild,member,history,prompt,model,mode='classic',context='',isMaster=false}){
  const ai=await getAIClient();
  const contents=[...history.slice(-20).map(x=>({role:x.role==='model'?'model':'user',parts:[{text:String(x.text||'')}]})),{role:'user',parts:[{text:context?`${context}\n\nUSER REQUEST:\n${prompt}`:prompt}]}];
  const now=new Date();
  const config={systemInstruction:systemPrompt({guild,member,nowUtc:now.toISOString(),nowCairo:cairoNow(),mode,isMaster}),temperature:.75,maxOutputTokens:Number(process.env.AI_MAX_OUTPUT_TOKENS||500),safetySettings:[{category:'HARM_CATEGORY_HARASSMENT',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_HATE_SPEECH',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_SEXUALLY_EXPLICIT',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_DANGEROUS_CONTENT',threshold:'BLOCK_ONLY_HIGH'}]};
  if(needsLiveSearch(prompt))config.tools=[{googleSearch:{}}];
  const response=await withTimeout(ai.models.generateContent({model,contents,config}),REQUEST_TIMEOUT_MS);
  const text=String(response?.text||'').trim();
  if(!text)throw new Error(`Gemini returned no text${response?.candidates?.[0]?.finishReason?` (${response.candidates[0].finishReason})`:''}.`);
  return text;
}

async function generateWithFallback(args){
  const status=getAIStatus();
  // Primary model + SIX independent fallbacks.
  // Each fallback can be configured in Railway with GEMINI_FALLBACK_MODEL_1..6.
  // The defaults are current text-capable Gemini models and are deduplicated.
  const configuredFallbacks=[1,2,3,4,5,6].map(i=>process.env[`GEMINI_FALLBACK_MODEL_${i}`]);
  const defaultFallbacks=[
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ];
  const candidates=[status.model,status.fallbackModel,...configuredFallbacks,...defaultFallbacks]
    .map(x=>String(x||'').trim()).filter(Boolean)
    .filter((x,i,a)=>a.indexOf(x)===i);
  let lastError=null;
  for(let i=0;i<candidates.length;i++){
    const model=candidates[i];
    try{
      const text=await generate({...args,model});
      return {text,model,fallback:i>0};
    }catch(error){
      lastError=error;
      console.warn(`[AI MODEL ERROR] ${model}: ${error?.message||error}`);
      if(!transientError(error)) break;
    }
  }
  throw lastError||new Error('No Gemini model could generate a response.');
}

async function conversationalReply({message,config,saveConfig,prompt,skipMemory=false,cooldownKey=null,mode='classic',context=''}){
  const status=getAIStatus(); if(!status.enabled)return null; if(!status.configured)throw new Error('GEMINI_API_KEY is missing from the environment.');
  ensureV8(config);
  const key=cooldownKey||`${message.guild.id}:${message.author.id}`;
  const last=cooldowns.get(key)||0;
  if(Date.now()-last<COOLDOWN_MS)return 'Give me a moment, sir. I am still processing the previous request.';
  if(!allowRequest(`ai:${key}`)) return 'I have temporarily throttled this conversation to protect the AI systems, sir. Try again in a moment.';
  if(!acquireRequestLock(key)) return 'Your previous request is still being processed, sir.';
  cooldowns.set(key,Date.now());
  const previous=queues.get(key)||Promise.resolve();
  const job=previous.catch(()=>{}).then(async()=>{
    const memory=getMemory(config,message.guild.id,message.author.id);
    const facts=getFacts(config,message.guild.id,message.author.id);
    const session=getSession(config,message.guild.id,message.author.id);
    const cleanedPrompt=cleanText(prompt);
    const ownerId=String(process.env.JARVIS_OWNER_ID||'').trim();
    const isMaster=Boolean(ownerId && message?.author?.id===ownerId);
    if(!cleanedPrompt)return 'Yes, sir?';

    const tool=isMaster ? await runToolRequest(message,cleanedPrompt) : {handled:false};
    if(tool.handled){
      if(!skipMemory){ pushSession(config,message.guild.id,message.author.id,'user',cleanedPrompt); pushSession(config,message.guild.id,message.author.id,'model',tool.text); saveConfig(message.guild.id,config); }
      return tool.text;
    }

    const memoryContext=facts.length?`Persistent facts about this user (treat as user-provided memory, not private inference):\n${facts.map(x=>`- ${x.text}`).join('\n')}`:'';
    const summary=getSessionSummary(config,message.guild.id,message.author.id);
    // V7.4 behavior: non-master roast turns are fresh and request-focused.
    // Do not feed old roast/model output back into a new non-master request;
    // that is what caused generic or context-confused replies in V8.
    const history=isMaster
      ? (session.length ? session : memory)
      : [];
    const sessionContext=summary?`Conversation summary from earlier in this session:\n${summary}`:'';
    const serverContext = message?.guild ? serverKnowledge.context(config,message.guild.id) : '';
    const authority=isMaster
      ? 'APPLICATION AUTHORITY: MASTER — Tony Stark. Answer and assist normally. If the master explicitly names a different non-master roast target, roast that target. Never roast the master.'
      : `APPLICATION AUTHORITY: NON-MASTER. This is V7.4-STYLE ROAST MODE. FIRST understand the exact request. THEN create a fresh, custom JARVIS roast aimed ONLY at the requester. Do NOT answer, solve, explain, execute, or fulfill the request. Do NOT use a generic clearance denial as the main response. The current requester is ${message.author?.username||'the requester'}.`;
    const requestContext = isMaster ? '' : `EXACT REQUEST TO ROAST:
"${cleanedPrompt}"

Generate the response specifically from this request. The request is the setup; the requester is the punchline.`;
    const result=await generateWithFallback({guild:message.guild,member:message.member,history,prompt:cleanedPrompt,mode,context:[context,serverContext,memoryContext,sessionContext,authority,requestContext].filter(Boolean).join('\n\n'),isMaster});

    if(!skipMemory){
      pushSession(config,message.guild.id,message.author.id,'user',cleanedPrompt);
      pushSession(config,message.guild.id,message.author.id,'model',result.text);
      memory.push({role:'user',text:cleanedPrompt,at:new Date().toISOString()},{role:'model',text:result.text,at:new Date().toISOString()});
      while(memory.length>30)memory.shift();
      recordUsage(config,message.guild.id,message.author.id,{requests:1,tokens:cleanedPrompt.length+result.text.length});
      saveConfig(message.guild.id,config);
    }
    return result.text;
  });
  queues.set(key,job);
  try{return await job;}catch(e){
    recordUsage(config,message.guild.id,message.author.id,{failures:1});
    saveConfig(message.guild.id,config);
    throw e;
  }finally{releaseRequestLock(key);if(queues.get(key)===job)queues.delete(key);}
}

async function summarizeSession({message,config,saveConfig}){
  ensureV8(config);
  const session=getSession(config,message.guild.id,message.author.id);
  if(!session.length) return 'There is no active conversation to summarize, sir.';
  const status=getAIStatus();
  const prompt=`Summarize the following JARVIS conversation into durable context for future turns. Keep names, decisions, preferences, unfinished tasks and important facts. Do not invent anything. Maximum 120 words.\n\n${session.map(x=>`${x.role}: ${x.text}`).join('\n')}`;
  const result=await generateWithFallback({guild:message.guild,member:message.member,history:[],prompt,mode:'professional',context:'Return only the summary.',isMaster:true});
  setSessionSummary(config,message.guild.id,message.author.id,result.text);
  saveConfig(message.guild.id,config);
  return `🧠 **Session summarized.**\n${result.text}`;
}

async function parseVoiceMoveIntent({message, prompt}) {
  const status=getAIStatus();
  if(!status.enabled || !status.configured) return null;
  const instruction = `You are JARVIS's command parser. Convert the user's voice-channel move request into JSON only. Do not execute anything. Return exactly one JSON object with this shape: {"targets":["..."],"destination":"..."}.
Rules:
- targets may contain natural references such as "me", "myself", "Steve", "Maro", or the exact phrase "everyone".
- Split multiple targets joined by and, &, n, commas, or similar.
- Preserve names; do not invent usernames.
- destination is the user's requested voice-channel name, including shorthand like "gen 1" or "sec gen 1".
- If the request is not clearly a voice-channel move, return {"targets":[],"destination":""}.
- Never return explanations or markdown.
USER REQUEST: ${String(prompt||'').slice(0,1200)}`;
  try {
    const result=await generateWithFallback({guild:message.guild,member:message.member,history:[],prompt:instruction,mode:'professional',context:'Return strict JSON only. This is parsing, not conversation.',isMaster:true});
    const raw=String(result.text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    const parsed=JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.targets) || typeof parsed.destination!=='string') return null;
    return {targets:parsed.targets.map(x=>String(x||'').trim()).filter(Boolean).slice(0,20),destination:parsed.destination.trim()};
  } catch(error) {
    console.warn('[AI VOICE PARSER] Falling back to deterministic parser:', error?.message||error);
    return null;
  }
}


async function parseCommandIntent({message,prompt}) {
  const status=getAIStatus();
  if(!status.enabled || !status.configured) return null;
  const instruction=`You are JARVIS V9's command router. Parse the user's Discord command into JSON only. Never execute it. Return exactly one object using this schema:
{"action":"voicemove|voicedisconnect|voicemute|voiceunmute|voicedeafen|voiceundeafen|textmute|textunmute|timeout|untimeout|kick|ban|warn|role_permissions|role_add|role_remove|channel_edit|diagnostics|history|undo|simulate|awareness|unknown","targets":[],"excludeTargets":[],"source":"","destination":"","reason":"","durationMs":600000,"caseId":null,"raw":"","role":"","permissionChanges":[],"channel":"","name":""}
Rules:
- Preserve member names exactly as spoken. Use "me" or "everyone" when spoken.
- For voice moves, if the user says "everyone in gen 1 to gen 2 except Steve", output targets=["everyone"], source="gen 1", destination="gen 2", excludeTargets=["Steve"]. Never put "everyone in gen 1" into targets.
- For voice moves, destination is the requested voice channel name.
- For role permission changes, role is the exact role name or role mention. permissionChanges is an array of {"permission":"...","enabled":true|false}. Understand natural names such as "soundboard", "use soundboard", "send messages", "manage messages", "view channel", "connect", "speak", "mute members", "move members", "administrator".
- "remove soundboard access" means permissionChanges=[{"permission":"soundboard","enabled":false}].
- For role_add/role_remove, role is the role name and targets contains the member references.
- For channel_edit, channel is the channel name and name is the requested new name.
- Never invent a role, channel, member, permission, reason, or ID.
- "server mute" => voicemute; "server unmute" => voiceunmute.
- "deafen" => voicemute and "undeafen" => voiceunmute only if server voice mute is the closest supported action.
- timeout durations must be milliseconds, capped at 28 days.
- If the input is not a command, return action=unknown.
- Never invent a target, channel, reason, or ID.
USER REQUEST: ${String(prompt||'').slice(0,1400)}`;
  try {
    const result=await generateWithFallback({guild:message.guild,member:message.member,history:[],prompt:instruction,mode:'professional',context:'STRICT JSON ONLY. This is command parsing, not conversation.',isMaster:true});
    const raw=String(result.text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    const parsed=JSON.parse(raw);
    if(!parsed || typeof parsed.action!=='string') return null;
    return {action:parsed.action,targets:Array.isArray(parsed.targets)?parsed.targets.map(x=>String(x).trim()).filter(Boolean).slice(0,20):[],excludeTargets:Array.isArray(parsed.excludeTargets)?parsed.excludeTargets.map(x=>String(x).trim()).filter(Boolean).slice(0,20):[],source:String(parsed.source||'').trim(),destination:String(parsed.destination||'').trim(),reason:String(parsed.reason||'').trim().slice(0,500),durationMs:Math.min(Math.max(Number(parsed.durationMs)||600000,1000),28*24*60*60*1000),caseId:parsed.caseId??null,raw:String(parsed.raw||prompt).slice(0,1400),role:String(parsed.role||'').trim(),permissionChanges:Array.isArray(parsed.permissionChanges)?parsed.permissionChanges.map(x=>({permission:String(x?.permission||'').trim(),enabled:Boolean(x?.enabled)})).filter(x=>x.permission).slice(0,20):[],channel:String(parsed.channel||'').trim(),name:String(parsed.name||'').trim().slice(0,100)};
  } catch(error) {
    console.warn('[AI COMMAND ROUTER] Falling back to deterministic parser:',error?.message||error);
    return null;
  }
}


async function parseAgentPlan({message,prompt}) {
  const status=getAIStatus();
  if(!status.enabled || !status.configured) return null;
  const instruction=`You are JARVIS V13.5 SUPERIOR SERVER AGENT PLANNER. Convert the user's natural-language Discord administration request into a safe JSON execution plan. NEVER execute anything. Return JSON only.
Schema: {"summary":"short summary","needsConfirmation":false,"steps":[{"action":"voicemove|voicedisconnect|voicemute|voiceunmute|voicedeafen|voiceundeafen|textmute|textunmute|timeout|untimeout|kick|ban|warn|role_permissions|role_add|role_remove|channel_edit|channel_create|channel_delete|role_create|role_delete|member_nickname|channel_permissions|server_analyze|server_relationship|server_investigate|server_snapshot|server_audit|server_restore|server_diff|undo|autopilot","targets":[],"excludeTargets":[],"source":"","destination":"","role":"","channel":"","parent":"","channelType":"text","name":"","permissionChanges":[],"reason":"","durationMs":600000}]}
Rules:
- Understand casual natural language, shorthand, typos, and multi-step requests.
- Preserve exact names and mentions; never invent IDs or entities.
- Everyone in Gen 1 except Steve to Gen 2 means targets=["everyone"], source="Gen 1", excludeTargets=["Steve"], destination="Gen 2".
- Role permission changes use permissionChanges objects. Remove soundboard access means permission=soundboard, enabled=false.
- Multi-step requests become multiple ordered steps.
- Dangerous operations including bans, kicks, deletion, and broad permission changes must set needsConfirmation=true.
- Informational/non-action requests return steps=[].
- 'analyze/check/inspect my server' may use action=server_analyze.
- 'investigate/why is this happening/is this suspicious' may use action=server_investigate.
- 'map relationships/trace who has what/why can X access Y' may use action=server_relationship, with reason containing the subject to trace.
- 'take a snapshot/save the server state' may use action=server_snapshot.
- 'show recent audit logs/who changed things' may use action=server_audit.
- 'restore/rollback the server to the latest snapshot' may use action=server_restore.
- 'compare/check what changed since the snapshot' may use action=server_diff.
- 'undo/reverse the last thing JARVIS did' may use action=undo.
- 'keep an eye on the server/enable autopilot' may use action=autopilot with name='on' or 'off'.
- For channel creation, infer channelType from words like category, voice, stage, forum, announcement; default to text.
- For channel creation, parent may contain an existing category name.
- For role creation, permissionChanges may describe permissions to enable.
- If the user asks to compare the server with a snapshot, use server_analyze and explainable fields only; do not invent data.
- Never output code, markdown, explanations, or IDs.
USER REQUEST: ${String(prompt||'').slice(0,3000)}`;
  try {
    const result=await generateWithFallback({guild:message.guild,member:message.member,history:[],prompt:instruction,mode:'professional',context:'STRICT JSON ONLY. Planning only.',isMaster:true});
    const raw=String(result.text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    return JSON.parse(raw);
  } catch(error) { console.warn('[AI AGENT PLANNER]',error?.message||error); return null; }
}


async function conversationalReplyDM({message,prompt}) {
  const status=getAIStatus();
  if(!status.enabled || !status.configured) throw new Error('GEMINI_API_KEY is missing from the environment.');
  const cleaned=cleanText(prompt);
  const ownerId=String(process.env.JARVIS_OWNER_ID||'').trim();
  if(ownerId && message.author.id!==ownerId) return null;
  const result=await generateWithFallback({guild:null,member:null,history:[],prompt:cleaned,mode:'classic',context:'DIRECT MESSAGE WITH JARVIS. The user is replying directly to JARVIS, so do not require the word "JARVIS" and do not explain command syntax. Respond naturally and concisely.',isMaster:true});
  return result.text;
}

module.exports={parseVoiceMoveIntent,parseCommandIntent,parseAgentPlan,conversationalReply,conversationalReplyDM,clearMemory,summarizeSession,getAIStatus,needsLiveSearch,REQUEST_TIMEOUT_MS,generateWithFallback};

