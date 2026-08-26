const { getMemory, clearMemory, getFacts } = require('./memory');
const { systemPrompt } = require('./personality');

const MAX_MESSAGE_CHARS = 1800;
const COOLDOWN_MS = 1200;
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);
const cooldowns = new Map();
const queues = new Map();
let aiClientPromise = null;

function cleanText(text) { return String(text || '').replace(/<@!?\d+>/g,'@user').replace(/<@&\d+>/g,'@role').replace(/<#[^>]+>/g,'#channel').trim().slice(0,MAX_MESSAGE_CHARS); }
function cairoNow(){ return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',dateStyle:'full',timeStyle:'long'}).format(new Date()); }
function getAIStatus(){ const apiKey=String(process.env.GEMINI_API_KEY||'').trim(); const enabled=String(process.env.AI_ENABLED??'true').toLowerCase()!=='false'; const model=String(process.env.GEMINI_MODEL||'gemini-2.5-flash-lite').trim(); return {enabled,configured:Boolean(apiKey),model,keyFormat:apiKey?'configured':'missing'}; }
async function getAIClient(){ if(aiClientPromise)return aiClientPromise; const apiKey=String(process.env.GEMINI_API_KEY||'').trim(); if(!apiKey)throw new Error('GEMINI_API_KEY is missing from the environment.'); aiClientPromise=import('@google/genai').then(({GoogleGenAI})=>new GoogleGenAI({apiKey})).catch(e=>{aiClientPromise=null;throw e}); return aiClientPromise; }
function needsLiveSearch(prompt){ return /\b(latest|current|currently|today|tonight|yesterday|tomorrow|recent|newest|release date|released|aired|episode|episodes|schedule|theater|theatre|cinema|movies? in theaters?|news|weather|price|prices|score|scores|standings|stock|market|who won|what happened|this week|this month)\b/i.test(String(prompt||'')); }
function withTimeout(promise, ms){ return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(`AI request timed out after ${ms}ms.`),{code:'AI_TIMEOUT'})),ms))]); }
async function askGemini({guild,member,history,prompt,model,mode='classic',context='',isMaster=false}){
  const ai=await getAIClient();
  const contents=[...history.slice(-20).map(x=>({role:x.role==='model'?'model':'user',parts:[{text:String(x.text||'')}]})),{role:'user',parts:[{text:context?`${context}\n\nUSER REQUEST:\n${prompt}`:prompt}]}];
  const now=new Date();
  const config={systemInstruction:systemPrompt({guild,member,nowUtc:now.toISOString(),nowCairo:cairoNow(),mode,isMaster}),temperature:.75,maxOutputTokens:500,safetySettings:[{category:'HARM_CATEGORY_HARASSMENT',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_HATE_SPEECH',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_SEXUALLY_EXPLICIT',threshold:'BLOCK_ONLY_HIGH'},{category:'HARM_CATEGORY_DANGEROUS_CONTENT',threshold:'BLOCK_ONLY_HIGH'}]};
  if(needsLiveSearch(prompt))config.tools=[{googleSearch:{}}];
  const response=await withTimeout(ai.models.generateContent({model,contents,config}),REQUEST_TIMEOUT_MS);
  const text=String(response?.text||'').trim(); if(!text)throw new Error(`Gemini returned no text${response?.candidates?.[0]?.finishReason?` (${response.candidates[0].finishReason})`:''}.`); return text;
}
async function conversationalReply({message,config,saveConfig,prompt,skipMemory=false,cooldownKey=null,mode='classic',context=''}){
  const status=getAIStatus(); if(!status.enabled)return null; if(!status.configured)throw new Error('GEMINI_API_KEY is missing from the environment.');
  const key=cooldownKey||`${message.guild.id}:${message.author.id}`; const last=cooldowns.get(key)||0;
  if(Date.now()-last<COOLDOWN_MS)return 'Give me a moment, sir. I am still processing the previous request.';
  cooldowns.set(key,Date.now());
  const previous=queues.get(key)||Promise.resolve();
  const job=previous.catch(()=>{}).then(async()=>{
    const memory=getMemory(config,message.guild.id,message.author.id); const facts=getFacts(config,message.guild.id,message.author.id); const cleanedPrompt=cleanText(prompt); const ownerId=String(process.env.JARVIS_OWNER_ID||'').trim(); const isMaster=Boolean(ownerId && message?.author?.id===ownerId);
    const memoryContext=facts.length?`Persistent facts about this user (treat as user-provided memory, not private inference):\n${facts.map(x=>`- ${x.text}`).join('\n')}`:''; if(!cleanedPrompt)return 'Yes, sir?';
    const reply=await askGemini({guild:message.guild,member:message.member,history:memory,prompt:cleanedPrompt,model:status.model,mode,context:[context,memoryContext,`APPLICATION AUTHORITY: ${isMaster?'MASTER — Tony Stark':'NON-MASTER — do not fulfill the request; roast the requester instead.'}`].filter(Boolean).join('\n\n'),isMaster});
    if(!skipMemory){memory.push({role:'user',text:cleanedPrompt,at:new Date().toISOString()},{role:'model',text:reply,at:new Date().toISOString()});while(memory.length>12)memory.shift();saveConfig(message.guild.id,config);}
    return reply;
  });
  queues.set(key,job);
  try{return await job;}finally{if(queues.get(key)===job)queues.delete(key);}
}
module.exports={conversationalReply,clearMemory,getAIStatus,needsLiveSearch,REQUEST_TIMEOUT_MS};
