# JARVIS V11.0.0 — Current Build

JARVIS is now on V11.0.0. Everything below this section (V10, V9.0.0, and the V8.x history) still describes real, active parts of the bot — nothing was removed going into V10 or V11, it was all carried forward and built on top of. This section just states what's current.

## What V11 added on top of V10.1.0

- Reminders (`jarvis remind`) now persist to disk and survive a bot restart, instead of only living in memory.
- Server-wide notes (`jarvis note`, `jarvis notes`, `jarvis clearnotes`) and personal preferences (`jarvis pref`, `jarvis myprefs`) — wiring in a memory module that existed in V10 but nothing called.
- Recurring scheduled messages beyond the daily briefing: `jarvis schedule add/remove/list`.
- `jarvis case <id>` for full before/after detail on one moderation/action log entry.
- `jarvis ratecheck` — informational message-activity spike detection.
- The V9 structured command path's tool registry gained `clock` and `server.status`.
- The web dashboard now auto-refreshes every 20 seconds.

See `V11.0.0-RELEASE-NOTES.md` for full detail. No command or feature from V10.1.0 was removed or changed.

## What V10 added on top of V9

- Voice is text-to-speech only: JARVIS reads its own Discord text replies aloud using a British-accent Gemini TTS voice. There is no speech-to-text, no microphone receiving, and no Discord audio receiver.
- `jarvis voice`, `jarvis voice on/off/stop/pause/resume/status`, and `jarvis voice leave` control playback per guild, with a queue so replies don't overlap.
- `who am I`, `who is me`, and `what is my username` are answered directly from the authenticated Discord message author and never pass through the moderation/member-target resolver — this was the V10.0.0 identity fix.
- TTS failures never block the Discord text reply; the text reply always goes out regardless of voice status.

## What V10.1.0 changed

V10.1.0 was a maintenance release: no commands or features were added, changed, or removed. It fixed internal issues found in the V10.0.0 build — see `docs/changelog/V10.1.0-RELEASE-NOTES.md` for the full list. In short: the full test suite now actually runs under `npm test`, a stray leftover file was removed, and documentation (including the environment variable list further down this README) was corrected to match what the code actually does.

## Current default voice configuration

The defaults actually used by the code (see `.env.example` and `src/v8/voice.js`):

- `GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts`
- `JARVIS_TTS_VOICE=Algenib`
- `JARVIS_TTS_LANGUAGE=en-GB`

Historical patch and release notes for V8.x, V9.x, and the original V4 setup guide have been moved into `docs/changelog/` to keep this root README focused on the current build. They're unchanged and still describe real history — nothing in them was deleted.

## V8.3.2 HOTFIX

Hardened owner-tool routing so missing/failed helper functions cannot crash normal `jarvis ...` messages. Removed the stale `liveDiscordContext` dependency from the owner-tool path.

# JARVIS V9.0.0 — Ultimate Railway Build

JARVIS V9.0.0 is the upgraded continuation of the V7.4 Ultimate Railway bot. It keeps the existing administrator-only Discord management system while adding a real assistant architecture: persistent sessions, memory, fallback AI models, request protection, tools, health diagnostics, usage tracking, and optional voice output.

## V8.1.0 additions

- Persistent conversation sessions per server/user.
- `jarvis newchat` / `jarvis resetchat` to reset a session.
- `jarvis summarizechat` to compress a conversation into durable context.
- AI usage tracking with request/failure counters.
- AI request locks and rate limiting to prevent duplicate/parallel API abuse.
- Primary + fallback Gemini model routing.
- Master-only built-in calculator, clock, and server-status tools.
- `jarvis health` diagnostics.
- Optional `jarvis voice` / `jarvis voice leave` voice output.
- Expanded V8 configuration and modular `src/v8/` architecture.

## Railway variables

Required:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `JARVIS_OWNER_ID`
- `GEMINI_API_KEY`

Recommended:
- `GEMINI_MODEL=gemini-2.5-flash-lite`
- `GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite`
- `AI_TIMEOUT_MS=20000`
- `AI_RATE_WINDOW_MS=60000`
- `AI_RATE_MAX=8`
- `JARVIS_MAX_SESSION_MESSAGES=30`

Optional voice:
- `VOICE_ENABLED=true`
- `GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts` (this is what the code defaults to if unset — see "Current default voice configuration" above; earlier README revisions listed a different model/voice that did not match the code)
- `JARVIS_TTS_VOICE=Algenib`

## Commands worth testing after deployment

```text
jarvis health
jarvis usage
jarvis newchat
jarvis summarizechat
jarvis mode sarcastic
jarvis what is 67x69
jarvis what time is it?
jarvis server status
jarvis voice
jarvis voice leave
```

The existing V7.4 commands, moderation, AutoMod, Anti-Raid, cases, dashboard, reminders, analytics and security systems remain part of the build.


## V8.1.0 hybrid behavior

V8.1.0 deliberately combines V7.4's stronger conversational/roast personality contract with V8's persistent sessions, six-model fallback routing, throttling, diagnostics, tools, dashboard, and optional voice. Authority is always enforced by the application and then reinforced in the AI prompt.

## JARVIS V9.0.0

V9 adds the Intelligent Command System architecture: universal routing, ambiguity-safe resolution, centralized permissions, reusable execution, command context, confirmations, undo, simulation, live awareness, event hooks, and V9 diagnostics.

Useful commands:
- `jarvis v9`
- `jarvis undo`
- `jarvis v9simulate <command>`
