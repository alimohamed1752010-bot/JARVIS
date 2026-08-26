const MAX_HISTORY = 60;
const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FACTS = 40;

function ensure(config, guildId, userId) {
  config.ai ??= {};
  config.ai.memory ??= {};
  config.ai.memory[guildId] ??= {};
  config.ai.memory[guildId][userId] ??= [];
  return config.ai.memory[guildId][userId];
}

function getMemory(config, guildId, userId) {
  const memory = ensure(config, guildId, userId);
  const cutoff = Date.now() - MEMORY_TTL_MS;
  const fresh = memory.filter(item => {
    const at = Date.parse(item.at || '');
    return !Number.isFinite(at) || at >= cutoff;
  });
  while (fresh.length > MAX_HISTORY) fresh.shift();
  config.ai.memory[guildId][userId] = fresh;
  return fresh;
}

function addFact(config, guildId, userId, text) {
  config.ai.facts ??= {};
  config.ai.facts[guildId] ??= {};
  config.ai.facts[guildId][userId] ??= [];
  const facts = config.ai.facts[guildId][userId];
  const clean = String(text || '').trim().slice(0, 300);
  if (!clean) return facts;
  if (!facts.some(x => x.text.toLowerCase() === clean.toLowerCase())) {
    facts.push({ text: clean, at: new Date().toISOString() });
  }
  while (facts.length > MAX_FACTS) facts.shift();
  return facts;
}

function getFacts(config, guildId, userId) {
  return config.ai?.facts?.[guildId]?.[userId] || [];
}

function clearMemory(config, guildId, userId) {
  if (config.ai?.memory?.[guildId]?.[userId]) delete config.ai.memory[guildId][userId];
}
function clearFacts(config, guildId, userId) {
  if (config.ai?.facts?.[guildId]?.[userId]) delete config.ai.facts[guildId][userId];
}

module.exports = { getMemory, clearMemory, addFact, getFacts, clearFacts, MAX_HISTORY, MEMORY_TTL_MS, MAX_FACTS };
