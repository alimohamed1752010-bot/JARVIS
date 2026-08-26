const recentActions = new Map();

function recordAction(guildId, actorId, action) {
  const key = `${guildId}:${actorId}`;
  const now = Date.now();
  const list = (recentActions.get(key) || []).filter(x => now - x.at < 15000);
  list.push({ action, at: now });
  recentActions.set(key, list);
  return list;
}

function scoreActions(list) {
  const counts = {};
  for (const x of list) counts[x.action] = (counts[x.action] || 0) + 1;
  return counts;
}

async function inspectAudit(guild, logEvent, addCase) {
  const logs = await guild.fetchAuditLogs({ limit: 20 }).catch(() => null);
  if (!logs) return;
  const now = Date.now();
  for (const entry of logs.entries.values()) {
    if (now - entry.createdTimestamp > 15000 || !entry.executor || entry.executor.bot) continue;
    const action = String(entry.action);
    const list = recordAction(guild.id, entry.executor.id, action);
    const counts = scoreActions(list);
    const destructive = Object.values(counts).reduce((a,b)=>a+b,0);
    if (destructive >= 6 || (counts['12'] || 0) >= 3 || (counts['30'] || 0) >= 3) {
      const c = addCase(guild.id, { action:'SECURITY-ALERT', userId:entry.executor.id, moderatorId:guild.client.user.id, reason:`Possible anti-nuke activity: ${JSON.stringify(counts)}`, evidence:{auditAction:action, counts} });
      await logEvent(guild, `🚨 **JARVIS SECURITY ALERT**\nPossible destructive activity by **${entry.executor.tag}**.\nActions detected: **${destructive}**\nCase #${c.id}`);
      return;
    }
  }
}

module.exports = { inspectAudit };
