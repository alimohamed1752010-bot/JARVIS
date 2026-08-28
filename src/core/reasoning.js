const serverKnowledge = require('./serverKnowledge');
const serverGraph = require('./serverGraph');

const WINDOW_MS = 10 * 60 * 1000;
const MAX_EVENTS = 200;

function ensure(config, guildId) {
  config.v14 ??= {};
  config.v14.reasoning ??= {};
  config.v14.reasoning[guildId] ??= { timeline: [], investigations: [] };
  const state = config.v14.reasoning[guildId];
  state.timeline ??= [];
  state.investigations ??= [];
  return state;
}

function addTimeline(config, guildId, event) {
  const state = ensure(config, guildId);
  state.timeline.push({ at: new Date().toISOString(), ...event });
  if (state.timeline.length > MAX_EVENTS) state.timeline = state.timeline.slice(-MAX_EVENTS);
  return state.timeline.at(-1);
}

function recent(state, now = Date.now()) {
  return state.timeline.filter(e => now - Date.parse(e.at || '') <= WINDOW_MS);
}

function correlate(config, guildId, { now = Date.now() } = {}) {
  const state = ensure(config, guildId);
  const events = recent(state, now);
  const byType = new Map();
  for (const e of events) byType.set(e.type, (byType.get(e.type) || 0) + 1);
  const signals = [];
  const push = (severity, title, evidence, recommendation) => signals.push({ severity, title, evidence, recommendation });

  if ((byType.get('member_join') || 0) >= 8) push('HIGH', 'Unusual join burst', `${byType.get('member_join')} member joins in 10 minutes.`, 'Inspect recent audit activity and recent accounts before enabling lockdown.');
  if ((byType.get('channel_delete') || 0) >= 2) push('HIGH', 'Multiple channel deletions', `${byType.get('channel_delete')} channel deletions in 10 minutes.`, 'Inspect audit logs and verify the executor before restoring or changing permissions.');
  if ((byType.get('role_delete') || 0) >= 2) push('HIGH', 'Multiple role deletions', `${byType.get('role_delete')} role deletions in 10 minutes.`, 'Inspect audit logs and verify whether the changes were authorized.');
  if ((byType.get('role_permission_change') || 0) >= 3) push('HIGH', 'Rapid permission changes', `${byType.get('role_permission_change')} role permission changes in 10 minutes.`, 'Inspect audit logs and compare the current server to the latest snapshot.');
  if ((byType.get('ban') || 0) >= 3) push('MEDIUM', 'Unusual ban activity', `${byType.get('ban')} bans in 10 minutes.`, 'Review the audit log and moderation reasons for consistency.');

  return { generatedAt: new Date().toISOString(), windowMs: WINDOW_MS, eventCount: events.length, signals };
}

async function investigate(guild, config, saveConfig, { focus = '' } = {}) {
  const state = ensure(config, guild.id);
  const correlation = correlate(config, guild.id);
  const logs = await guild.fetchAuditLogs({ limit: 25 }).catch(() => null);
  const audit = logs ? [...logs.entries.values()].slice(0, 15).map(e => ({
    id: e.id, action: String(e.action), executor: e.executor?.tag || null,
    target: e.target?.name || e.target?.tag || e.target?.id || null,
    reason: e.reason || null, at: new Date(e.createdTimestamp).toISOString()
  })) : [];
  const knowledge = serverKnowledge.get(config, guild.id);
  const graph = await serverGraph.build(guild).catch(() => null);
  const diagnosis = graph ? serverGraph.diagnose(graph, focus) : null;
  const report = {
    focus: String(focus || '').slice(0, 300),
    correlation,
    audit,
    recentTimeline: state.timeline.slice(-25).reverse(),
    anomalies: (knowledge.anomalies || []).slice(-10).reverse(),
    relationshipDiagnosis: diagnosis,
    recommendation: correlation.signals[0]?.recommendation || (diagnosis?.findings?.find(f=>['HIGH','MEDIUM'].includes(f.severity))?.detail) || 'No strong correlated anomaly detected. Continue monitoring.'
  };
  state.investigations.push({ at: new Date().toISOString(), focus: report.focus, signals: correlation.signals.map(s => s.title) });
  if (state.investigations.length > 50) state.investigations = state.investigations.slice(-50);
  saveConfig(guild.id, config);
  return report;
}

function format(report) {
  const s = report.correlation.signals;
  const lines = [
    '**JARVIS INVESTIGATION**',
    `Window: **${Math.round(report.correlation.windowMs / 60000)} minutes**`,
    `Observed events: **${report.correlation.eventCount}**`,
    s.length ? s.map(x => `${x.severity === 'HIGH' ? '🔴' : '🟡'} **${x.title}** — ${x.evidence}`).join('\n') : '🟢 No strong correlated anomaly detected.',
    '',
    `**Recommendation:** ${report.recommendation}`,
    '',
    '**Recent audit activity:**',
    report.audit.slice(0, 8).map(e => `• ${e.action} — ${e.executor || 'unknown'} → ${e.target || 'unknown'}`).join('\n') || '• Audit log unavailable or empty.'
  ];
  return lines.join('\n');
}

module.exports = { ensure, addTimeline, correlate, investigate, format, WINDOW_MS, MAX_EVENTS };
