# JARVIS AI — Railway Setup

This build uses Google's official `@google/genai` JavaScript SDK.

## Railway Variables

Set these in Railway → Variables:

```env
AI_ENABLED=true
GEMINI_API_KEY=your_real_key_here
GEMINI_MODEL=gemini-3.7-flash
```

Do not commit `.env` or your real API key.

## Expected startup diagnostic

When JARVIS starts, Railway should show something like:

```text
[AI CONFIG] enabled=true configured=true model=gemini-3.7-flash key=AQ authorization key
```

The key itself is never printed.

If AI fails, the console now prints the actual Gemini SDK error, including its HTTP status when available.
