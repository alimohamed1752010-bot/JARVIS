# JARVIS V13.0.0 — SUPERIOR

V13 is the next architecture layer after V12.1: persistent server knowledge, bounded autonomous repair loops, verification, snapshots, risk controls, and natural-language Discord administration.

## Highlights
- Persistent per-server knowledge cache and recent JARVIS event history.
- Startup server scan and explicit `server.scan` tool.
- AI planner receives live server context plus persistent server knowledge.
- Bounded repair loop: when a multi-step plan partially fails, JARVIS can re-plan against the current state without repeating successful steps.
- Post-action verification remains mandatory for agent steps.
- Snapshots are still taken before normal agent plans unless disabled.
- Existing six-model Gemini fallback chain retained.
- Owner/Tony Master Mode and non-master Roast Mode retained.
- DM reply continuity: in a DM, replying directly to a JARVIS message invokes JARVIS without typing his name.

## Natural language examples
- `Jarvis, create a Moderator role, build a staff category, add mod-chat and mod voice, then give the role to Steve.`
- `Jarvis, move everyone in Gen 1 to Gen 2 except Steve.`
- `Jarvis, remove soundboard access from @Members.`
- `Jarvis, analyze the server.`
- `Jarvis, compare the server with the last snapshot.`
- `Jarvis, undo what you just did.`
- `Jarvis, simulate giving @Moderators administrator.`

## Safety model
AI proposes structured actions. The bot validates authority, permissions, hierarchy, risk, and target resolution before execution. The AI is never given arbitrary code execution.
