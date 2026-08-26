const messageCounts = new Map();
const hourly = new Map();
const daily = new Map();

function recordMessage(guildId, userId) {
  const k = `${guildId}:${userId}`;
  messageCounts.set(k, (messageCounts.get(k) || 0) + 1);
  const now = new Date();
  const hourKey = `${guildId}:${now.toISOString().slice(0,13)}`;
  const dayKey = `${guildId}:${now.toISOString().slice(0,10)}`;
  hourly.set(hourKey, (hourly.get(hourKey) || 0) + 1);
  daily.set(dayKey, (daily.get(dayKey) || 0) + 1);
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
module.exports={recordMessage,getTopUsers,getAnalytics};
