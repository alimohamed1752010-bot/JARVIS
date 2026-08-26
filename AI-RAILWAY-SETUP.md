# JARVIS AI — Railway Setup

This build uses Google's official `@google/genai` JavaScript SDK.

## Railway Variables

Set these in Railway → Variables:

```env
AI_ENABLED=true
GEMINI_API_KEY=your_real_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
JARVIS_OWNER_ID=797626962494488636
```

Do not commit `.env` or your real API key.

## Expected startup diagnostic

When JARVIS starts, Railway should show something like:

```text
[AI CONFIG] enabled=true configured=true model=gemini-3.5-flash-lite key=API key
```

The key itself is never printed.

## Current-information questions

JARVIS automatically requests Gemini's Google Search grounding for questions that look time-sensitive, such as latest episodes, current news, release dates, current schedules, weather, prices and movies in theaters.

If your selected Gemini project/model does not allow grounding, JARVIS should report that it could not verify the current information rather than inventing a current answer.

## Master-only behavior

`JARVIS_OWNER_ID` is the only Discord user ID that can use JARVIS for normal assistance. Other users are not sent to Gemini. If they directly insult or provoke JARVIS, he can respond with a short in-character comeback. JARVIS will not roast the configured master.

If AI fails, the console prints the actual Gemini SDK error, including its HTTP status when available.
