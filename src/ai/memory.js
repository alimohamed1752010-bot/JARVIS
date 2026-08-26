const MAX_HISTORY = 12;
const MEMORY_TTL_MS = 72 * 60 * 60 * 1000;
function getMemory(config, guildId, userId) { config.ai ??= {}; config.ai.memory ??= {}; config.ai.memory[guildId] ??= {}; config.ai.memory[guildId][userId] ??= []; const cutoff=Date.now()-MEMORY_TTL_MS; const memory=config.ai.memory[guildId][userId].filter(item=>{const at=Date.parse(item.at||''); return !Number.isFinite(at)||at>=cutoff;}); config.ai.memory[guildId][userId]=memory; while(memory.length>MAX_HISTORY) memory.shift(); return memory; }
function clearMemory(config,guildId,userId){ if(config.ai?.memory?.[guildId]?.[userId]) delete config.ai.memory[guildId][userId]; }
module.exports={getMemory,clearMemory,MAX_HISTORY,MEMORY_TTL_MS};
