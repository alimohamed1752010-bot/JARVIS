# JARVIS V8 Architecture

V8 adds a real assistant layer on top of the V7.4 command system:

- Persistent per-user sessions and session summaries.
- Persistent user facts and legacy memory compatibility.
- AI request throttling, duplicate/overlap locks and usage accounting.
- Primary/fallback Gemini model routing for temporary model failures.
- Built-in calculator, clock and server-status tools for the verified master.
- Expanded diagnostics/health reporting.
- Optional voice output using Gemini TTS and Discord voice.
- Dashboard compatibility and a cleaner modular extension point.

Voice is optional. Keep `VOICE_ENABLED=false` unless the voice dependencies are installed. The text bot does not require them.
