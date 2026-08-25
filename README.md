# JARVIS Discord Bot

A clean ProBot-inspired starter bot built with Node.js + discord.js.

## Included
- `/help`
- `/ban`
- `/kick`
- `/timeout`
- `/clear`
- `/warn` with JSON persistence
- `/server`
- `/user`
- `/avatar`
- `/setwelcome`
- `/setlogs`
- Automatic welcome messages
- Basic member join/leave logs
- JARVIS presence

## Setup

1. Install Node.js 20+.
2. Create a Discord application in the Developer Portal.
3. Add a Bot user.
4. Copy `.env.example` to `.env`.
5. Put your bot token, application/client ID, and test server ID in `.env`.
6. In the Developer Portal, enable the privileged intents required by the features you use.
7. In this folder run:

```bash
npm install
npm run deploy
npm start
```

For development, keep `GUILD_ID` set so commands register to your test server quickly. Remove it later for global commands.

## Important
Never upload your `.env` file or bot token to GitHub. If the token is exposed, reset it immediately.

## Next upgrades
This is intentionally a solid starter rather than a fake "copy" of ProBot. The next layer can add:
- XP/levels + rank cards
- reaction/select roles
- automod
- moderation case database
- warnings dashboard
- tickets
- custom commands
- embeds
- autoroles
- anti-raid
- server configuration dashboard
