# JARVIS V17.1 — REAL AI PC + DISCORD

V17.1 is the natural-language PC-control build.

- Railway remains the AI/Discord brain.
- Windows runs a local PC Agent over an authenticated outbound WebSocket.
- PC requests are interpreted as intent first, so casual wording works: “yo JARVIS, can you run Spotify and Rocket League?”
- Windows apps are discovered dynamically from Start Menu registrations instead of requiring per-user executable paths.
- Epic Games titles are discovered from the installed Epic manifests, then launched through Epic's URI scheme.
- Modrinth profiles are discovered dynamically from the Modrinth App data directory. The Modrinth App does not currently expose a stable documented CLI for launching a named profile, so JARVIS opens Modrinth and reports the discovered profile instead of pretending a game launched when it did not.
- Windows master volume is set directly through Core Audio instead of approximating it with repeated volume-key presses.
- Brave/YouTube/Spotify behavior from V16.5 is preserved.

## Railway

`PC_AGENT_TOKEN` must contain a long random secret.

## Windows

`.env`:

```env
JARVIS_PC_URL=wss://YOUR-RAILWAY-DOMAIN/pc
JARVIS_PC_TOKEN=THE-SAME-SECRET
```

Then run `START-JARVIS-PC.bat`.
