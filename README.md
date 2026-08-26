JARVIS V7.1.0 PATCH — Non-owner roast requests always roast the requester, never the mentioned target.

# JARVIS V6 — Ultimate Discord Server Assistant

JARVIS is an administrator-only Discord server management bot built with Node.js and discord.js. This version keeps the original moderation, welcome, logging, utility, information, fun, interaction, and conversational features while adding a much larger security and management layer.

## Core rules

- **Administrator-only:** slash commands are registered with Administrator as their default permission, and runtime checks enforce the same rule.
- Non-administrators who try to use JARVIS receive: **🔒 Access denied, go away kid.**
- JARVIS conversational triggers such as `hi jarvis` are also administrator-only.
- `isn't that right jarvis?` receives: **Of course, sir. It's right. You're always right.**

## Existing features preserved

### Moderation
`jarvis ban`, `kick`, `timeout`, `softban`, `unban`, `warn`, `warnings`, `clearwarnings`, `clear`, `purge`, `lock`, `unlock`, `slowmode`, `nick`, `addrole`, `removerole`, `mute`, `unmute`

### Configuration
`setwelcomechannel`, `setwelcomemessage`, `setlogchannel`, `setmuterole`, `config`, `setautorole`, `autorole`, `verifysetup`, `maintenance`, `setstatus`, `custom`

### Information / system
`help`, `ping`, `uptime`, `botinfo`, `stats`, `diagnostics`, `permissions`, `serverinfo`, `userinfo`, `membercount`, `roleinfo`, `channelinfo`, `listroles`, `listchannels`, `avatar`, `avatarurl`, `servericon`, `emojiinfo`, `invite`, `audit`, `snapshot`, `report`

### Utilities
`say`, `sayembed`, `announce`, `poll`, `remind`, `afk`, `percentage`, `verify`

### Fun / interaction
`8ball`, `coinflip`, `dice`, `roll`, `rps`, `choose`, `joke`, `fact`, `quote`, `wyr`, `rate`, `ship`, `hug`, `slap`, `pat`, `compliment`, `roast`, `reverse`, `random`

### JARVIS personality
- `jarvis help`
- `hi jarvis`
- `hey jarvis`
- `jarvis wake up`
- `jarvis activate`
- `jarvis stand down`
- `jarvis listen`
- `isn't that right jarvis?`
- Natural JARVIS-style responses
- Unknown-command guidance
- Custom administrator-defined responses

## New security systems

### AutoMod
- Blocked-word filtering
- Discord invite filtering
- Optional external-link filtering
- Mention-spam detection
- Message-spam detection
- Automatic timeout for spam
- Automatic moderation cases
- Security logging

Commands:
- `jarvis automod on|off|status`
- `jarvis antispam on|off|status`
- `jarvis antilinks on|off|status`
- `jarvis blockword <word>`
- `jarvis unblockword <word>`
- `jarvis blockedwords`

### Anti-raid
JARVIS watches member joins over a short rolling window and can alert staff and optionally activate lockdown mode.

`jarvis antiraid on|off|status`

The anti-raid thresholds can be changed directly in each guild's JSON configuration if you want different limits.

### Emergency lockdown
`jarvis lockdown` secures public text channels.

`jarvis unlockdown` restores their normal @everyone Send Messages overwrite.

## Moderation case system

Moderation actions can create persistent case records with:

- Case ID
- Action
- Target user
- Moderator
- Reason
- Timestamp

Commands:

- `jarvis case <id>`
- `jarvis cases [@user]`

Cases are stored per server in `data/<guild-id>.json`.

## Server management

- Autorole
- Verification role
- Custom commands
- Role creation/deletion
- Channel creation/deletion
- Server snapshots
- JSON server reports
- Audit-log inspection
- JARVIS diagnostics
- Presence/status control
- Maintenance mode configuration

## Data

JARVIS uses per-server JSON configuration for easy deployment without requiring a database. Writes are performed through a temporary file and atomic rename to reduce corruption risk.

For a large public bot, the next production step would be moving this persistence layer to PostgreSQL or another real database.

## Setup

1. Install a supported Node.js version for the discord.js version you are using.
2. Create a Discord application in the Discord Developer Portal.
3. Add a Bot user.
4. Copy `.env.example` to `.env`.
5. Put your bot token, application/client ID, and optional test guild ID in `.env`.
6. Enable the privileged intents required by the features you use, especially Server Members Intent and Message Content Intent.
7. Run:

```bash
npm install
npm run deploy
npm start
```

For development, keep `GUILD_ID` set so commands register to a test server quickly. Remove it later for global commands.

## Important security notes

- Never commit `.env` or a bot token.
- If a token is exposed, reset it immediately in the Discord Developer Portal.
- Give JARVIS only the permissions it actually needs if you do not want to grant Administrator.
- Make sure JARVIS's bot role is above roles it needs to manage.
- Test lockdown, AutoMod, anti-raid, and role/channel management in a test server before production use.

## Advanced slash command

The `/jarvis` command provides a structured interface for stats, diagnostics, permissions, lockdown, AutoMod, anti-raid, autorole, verification, cases, audit activity, and snapshots.

## V5 assistant layer

JARVIS now has a controlled live-Discord assistant layer. Owner prompts can directly query the live member roster, online members (when Presence Intent is enabled), member roles, channels, recent channel messages, server counts, simple arithmetic, analytics, memory, personality and daily briefings. Gemini remains the language layer; Discord facts are obtained from Discord.js rather than guessed by Gemini.

### Recommended Railway variables
- `JARVIS_OWNER_ID=797626962494488636`
- `GEMINI_MODEL=gemini-2.5-flash-lite`
- `AI_TIMEOUT_MS=20000`
- `PRESENCE_INTENT=true` if you want reliable online-member lists, and enable the Presence Intent in the Discord Developer Portal.
- `DASHBOARD_ENABLED=false` unless you intentionally want the optional authenticated JSON dashboard.

### Natural-language examples
- `jarvis who's online?`
- `jarvis find Loki`
- `jarvis what roles does Loki have?`
- `jarvis how many members are here?`
- `jarvis list the channels`
- `jarvis analytics`
- `jarvis what is 67x69`
- `jarvis what time is it?`
- `jarvis memory clear`
- `jarvis personality sarcastic`
- `jarvis briefing`

Dangerous natural-language moderation requests still require explicit confirmation and are protected from acting on the master/server owner.


## V6 upgrades

- Unified command engine: the large `jarvis <command>` library is automatically mirrored into slash commands using the same handler, so behavior stays consistent.
- 99 top-level slash commands are deployed safely under Discord's application-command limit.
- `/jarvis` is now the JARVIS command center with security, memory, analytics, emergency protocol, briefing and dashboard controls.
- `/jarvis fun ...` mirrors low-priority interaction commands that are grouped to keep the bot under Discord's 100-command limit.
- `/jarvis community ...` provides suggestions, tickets, reputation, activity, birthdays and giveaways.
- Long-term AI facts plus a larger 30-day conversation memory window.
- AI tools: `jarvis ask`, `jarvis summarize`, `jarvis investigate`.
- Emergency protocol enables lockdown, AutoMod and Anti-Raid together and records a case.
- JARVIS Command Center dashboard with authenticated session access.
- Daily briefings use Africa/Cairo time.

### Slash command parity

Run `npm run deploy` after setting `DISCORD_TOKEN`, `CLIENT_ID`, and optionally `GUILD_ID`. Every text command with a top-level slash equivalent accepts an `args` field using the same argument syntax as the message command. Hand-crafted commands such as `/ban`, `/timeout`, `/avatar`, `/ask`, `/summarize`, `/investigate`, and `/jarvis` have richer Discord options.

### Railway dashboard

Set `DASHBOARD_ENABLED=true` and a strong `DASHBOARD_TOKEN`. The dashboard listens on Railway's `PORT`. Open the service URL once with `?token=YOUR_DASHBOARD_TOKEN`; JARVIS then issues a short-lived HttpOnly session cookie.
