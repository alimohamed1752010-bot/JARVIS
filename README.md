# JARVIS V8 — Ultimate Railway Build

JARVIS V8 is the upgraded continuation of the V7.4 Ultimate Railway bot. It keeps the existing administrator-only Discord management system while adding a real assistant architecture: persistent sessions, memory, fallback AI models, request protection, tools, health diagnostics, usage tracking, and optional voice output.

## V8 additions

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
