const { getMemory, clearMemory, getFacts } = require('./memory');
const { systemPrompt } = require('./personality');
const { ensureV8, getSession, pushSession, getSessionSummary, setSessionSummary, allowRequest, recordUsage, acquireRequestLock, releaseRequestLock } = require('../v8/core');
const { runToolRequest } = require('../v8/tools');

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
  const model=String(process.env.GEMINI_MODEL||'gemini-2.5-flash-lite').trim();
  const fallbackModel=String(process.env.GEMINI_FALLBACK_MODEL||'gemini-2.5-flash-lite').trim();
  return {enabled,configured:Boolean(apiKey),model,fallbackModel,keyFormat:apiKey?'configured':'missing'};
}
async function getAIClient(){ if(aiClientPromise)return aiClientPromise; const apiKey=String(process.env.GEMINI_API_KEY||'').trim(); if(!apiKey)throw new Error('GEMINI_API_KEY is missing from the environment.'); aiClientPromise=import('@google/genai').then(({GoogleGenAI})=>new GoogleGenAI({apiKey})).catch(e=>{aiClientPromise=null;throw e}); return aiClientPromise; }
function needsLiveSearch(prompt){ return /\b(latest|current|currently|today|tonight|yesterday|tomorrow|recent|newest|release date|released|aired|episode|episodes|schedule|theater|theatre|cinema|movies? in theaters?|news|weather|price|prices|score|scores|standings|stock|market|who won|what happened|this week|this month)\b/i.test(String(prompt||'')); }
function withTimeout(promise, ms){ return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`AI request timed out after ${ms}ms.`),{code:'AI_TIMEOUT'})),ms))]); }
function transientError(error){ const status=Number(error?.status||error?.statusCode||0); const t=String(error?.message||error||'').toLowerCase(); return status===429||status===500||status===502||status===503||status===504||t.includes('high demand')||t.includes('temporarily unavailable')||t.includes('unavailable')||t.includes('overloaded')||t.includes('rate limit')||t.includes('timeout'); }

async function generate({guild,member,history,prompt,model,mode='classic',context='',isMaster=false}){
  const ai=await getAIClient();
  const contents=[...history.slice(-24).map(x=>({role:x.role==='model'?'model':'user',parts:[{text:String(x.text||'')}]})),{role:'user',parts:[{text:context?`${context}\n\nUSER REQUEST:\n${prompt}`:prompt}]}];
  const now=new Date();
  const config={systemInstruction:systemPrompt({guild,member,nowUtc:now.toISOString(),nowCairo:cairoNow(),mode,isMaster}),temperature:.72,maxOutputTokens:Number(process.env.AI_MAX_OUTPUT_TOKENS||700),safetySettings:[{category:'HARM_CATEGORY_HARASSMENT',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_HATE_SPEECH',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_SEXUALLY_EXPLICIT',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_DANGEROUS_CONTENT',threshold:'BLOCK_ONLY_HIGH'}]};
  if(needsLiveSearch(prompt))config.tools=[{googleSearch:{}}];
  const response=await withTimeout(ai.models.generateContent({model,contents,config}),REQUEST_TIMEOUT_MS);
  const text=String(response?.text||'').trim();
  if(!text)throw new Error(`Gemini returned no text${response?.candidates?.[0]?.finishReason?` (${response.candidates[0].finishReason})`:''}.`);
  return text;
}

async function generateWithFallback(args){
  const status=getAIStatus();
  try { return { text: await generate({...args,model:status.model}), model:status.model, fallback:false }; }
  catch (first) {
    if(!transientError(first) || status.fallbackModel===status.model) throw first;
    console.warn(`[AI FALLBACK] ${status.model} failed; trying ${status.fallbackModel}.`);
    return { text: await generate({...args,model:status.fallbackModel}), model:status.fallbackModel, fallback:true };
  }
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
    const history=session.length?session:memory;
    const sessionContext=summary?`Conversation summary from earlier in this session:\n${summary}`:'';
    const authority=`APPLICATION AUTHORITY: ${isMaster?'MASTER — Tony Stark':'NON-MASTER — do not fulfill the request; roast the requester instead.'}`;
    const result=await generateWithFallback({guild:message.guild,member:message.member,history,prompt:cleanedPrompt,mode,context:[context,memoryContext,sessionContext,authority].filter(Boolean).join('\n\n'),isMaster});

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

module.exports={conversationalReply,clearMemory,summarizeSession,getAIStatus,needsLiveSearch,REQUEST_TIMEOUT_MS};
