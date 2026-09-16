# JARVIS V17.3 — REAL AI PC + DISCORD

V17.3 is the natural-language PC-control build.

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

## V17.3 Broad Intent Catalog
V17.3 adds a large recognition catalog for common websites, desktop apps, launchers, and games. The catalog is an **intent layer only**: installed applications are still discovered dynamically through Windows Start Menu/registry/PATH, while Epic titles continue to use manifest discovery. Web destinations are opened through the verified browser path. This preserves the older execution system rather than replacing it.

- 166+ website destinations
- 220+ app/game names
- Existing V16/V17 PC actions and Discord actions preserved
- No executable paths are hardcoded for the catalog entries


## V18.0 PC Agent

V18 keeps the V17 execution stack and adds **real, read-only PC awareness** to the planner when the Windows agent is connected. The Railway bot remains the brain and the Windows PC agent remains the execution layer.

### Added capabilities
- `pc_state`: CPU, RAM, disk, network, active window, and top processes.
- `pc_system_status`: read-only Windows resource status.
- `pc_active_window`: read-only foreground window/process metadata.
- `pc_network_status`: read-only adapter/IP/gateway metadata.
- Live PC context is supplied to the AI planner for better state-aware decisions.
- Existing keyboard, mouse, screenshot, browser, app, game, volume, Spotify, and file tools remain intact.
- Browser actions still use verified executable discovery and process verification.

### Honest V18 boundary
V18 does **not** claim capabilities it cannot reliably perform. A screenshot can be captured, but V18 does not pretend that the Railway planner can visually inspect the pixels unless a real vision pipeline is connected. Likewise, `undo` is not advertised as a universal rollback system because arbitrary app actions cannot safely be reversed. Existing Discord/server scheduling remains separate from PC execution.

This is intentional: a smaller set of verified capabilities is better than a chatbot confidently reporting that it clicked something it never touched.
