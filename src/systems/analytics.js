const messageCounts = new Map();
const hourly = new Map();
const daily = new Map();
const minutely = new Map(); // V11: rolling per-minute counts per guild, for spike detection

function recordMessage(guildId, userId) {
  const k = `${guildId}:${userId}`;
  messageCounts.set(k, (messageCounts.get(k) || 0) + 1);
  const now = new Date();
  const hourKey = `${guildId}:${now.toISOString().slice(0,13)}`;
  const dayKey = `${guildId}:${now.toISOString().slice(0,10)}`;
  hourly.set(hourKey, (hourly.get(hourKey) || 0) + 1);
  daily.set(dayKey, (daily.get(dayKey) || 0) + 1);
  const minuteKey = `${guildId}:${now.toISOString().slice(0,16)}`;
  minutely.set(minuteKey, (minutely.get(minuteKey) || 0) + 1);
}
function getTopUsers(guildId, limit=10) {
  return [...messageCounts.entries()].filter(([k])=>k.startsWith(guildId+':')).map(([k,count])=>({userId:k.split(':')[1],count})).sort((a,b)=>b.count-a.count).slice(0,limit);
}
function getAnalytics(guildId) {
  const prefix=guildId+':';
  const total=[...messageCounts.entries()].filter(([k])=>k.startsWith(prefix)).reduce((n,[,v])=>n+v,0);
  const days=[...daily.entries()].filter(([k])=>k.startsWith(prefix)).sort().slice(-14).map(([k,v])=>({day:k.split(':')[1],count:v}));
  return {totalMessages:total, topUsers:getTopUsers(guildId,10), daily:days};
}

// V11: activity-spike detection. Compares the current minute's message count
// against the average of the previous 10 minutes for the same guild. This is
// read-only and informational — it does not moderate, mute, or block anyone;
// it only reports a signal that a moderator (or the anti-raid system, in a
// future release) could act on.
function getRecentRate(guildId) {
  const now = new Date();
  const prefix = guildId + ':';
  const currentKey = `${prefix}${now.toISOString().slice(0,16)}`;
  const current = minutely.get(currentKey) || 0;
  const history = [];
  for (let i = 1; i <= 10; i++) {
    const t = new Date(now.getTime() - i * 60000);
    const key = `${prefix}${t.toISOString().slice(0,16)}`;
    history.push(minutely.get(key) || 0);
  }
  const baseline = history.reduce((a,b)=>a+b,0) / history.length;
  return { current, baseline: Number(baseline.toFixed(2)) };
}
function isSpiking(guildId, { minCurrent = 8, multiplier = 3 } = {}) {
  const { current, baseline } = getRecentRate(guildId);
  return current >= minCurrent && current >= baseline * multiplier;
}

module.exports={recordMessage,getTopUsers,getAnalytics,getRecentRate,isSpiking};
