# JARVIS V15.0.1 — Ultimate Railway Build

JARVIS V15.0.1 is the current continuation of the V7.4/V8/V9/V11/V12/V13/V14/V14.5 architecture. It keeps the existing Discord management, moderation, security, memory, AI, voice, and autonomous systems while adding the V15 superior layer and a configuration-driven creator identity. It keeps the existing administrator-only Discord management system while adding a real assistant architecture: persistent sessions, memory, fallback AI models, request protection, tools, health diagnostics, usage tracking, and optional voice output.

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
- `GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview`
- `JARVIS_TTS_VOICE=Kore`

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

## Documentation

Version history and release documentation are organized under [`docs/releases`](docs/releases/):

- [`docs/releases/readmes`](docs/releases/readmes) — version READMEs
- [`docs/releases/patch-notes`](docs/releases/patch-notes) — patch/release/architecture notes
- [`docs/setup`](docs/setup) — setup and deployment guides
