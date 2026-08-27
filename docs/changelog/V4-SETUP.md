# JARVIS V4 setup

Required Railway variables:

```env
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key
JARVIS_OWNER_ID=797626962494488636
GEMINI_MODEL=gemini-2.5-flash-lite
AI_ENABLED=true
```

V4 behavior:
- Only JARVIS_OWNER_ID receives normal AI assistance.
- Non-owners who insult JARVIS receive a witty comeback.
- Non-owner insult requests roast the requester instead, unless the target is the master; the master is always protected.
- Owner roast requests target the mentioned non-owner.
- Date/time questions are answered locally from the application clock and do not consume Gemini quota.
- Owner natural-language moderation requests with a mentioned member can produce a confirmation button before execution.
- Current-information questions request Gemini Google Search grounding when supported by the selected model/API project.
- AI memory is capped and expires after 72 hours.

After changing Railway variables, redeploy the service.
