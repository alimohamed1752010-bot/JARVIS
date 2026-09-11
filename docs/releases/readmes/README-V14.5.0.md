# JARVIS V14.5.0 — SUPERIOR

Relationship Intelligence & Autonomous Server Reasoning.

## Highlights
- Server relationship graph connecting members, roles, channels, category hierarchy, voice state, and permission overwrites.
- Relationship-aware investigation and natural-language tracing.
- Correlated reasoning can use relationship findings alongside learned server behavior and recent events.
- Agent action `server_relationship` for requests such as "why can Steve access Gen 2?" or "trace what roles Steve has".
- Fixed an Autopilot runtime defect where `saveConfig` was referenced without being injected.
- Existing safety, confirmation, snapshots, rollback, verification, learning, and DM reply continuity retained.

## Natural language examples
- `Jarvis, why can Steve access Gen 2?`
- `Jarvis, trace Steve's roles and voice channel.`
- `Jarvis, investigate what's connected to the Moderator role.`
- In a DM reply to JARVIS, simply reply `do it` or ask a follow-up without saying "Jarvis".

Relationship analysis is read-only. Destructive changes still go through the normal plan validator, risk engine, permission checks, confirmation, execution, and verification pipeline.
