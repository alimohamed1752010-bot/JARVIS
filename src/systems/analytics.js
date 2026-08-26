const messageCounts = new Map();
function recordMessage(guildId, userId) { const k=`${guildId}:${userId}`; messageCounts.set(k,(messageCounts.get(k)||0)+1); }
function getTopUsers(guildId, limit=10) { return [...messageCounts.entries()].filter(([k])=>k.startsWith(guildId+':')).map(([k,count])=>({userId:k.split(':')[1],count})).sort((a,b)=>b.count-a.count).slice(0,limit); }
module.exports={recordMessage,getTopUsers};
