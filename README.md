# JARVIS — Just A Rather Very Intelligent System

A modular Discord assistant with moderation, AutoMod, anti-raid, anti-nuke detection, AI memory, JARVIS personality modes, cases, logging, and diagnostics.

## Railway / hosting
1. Upload the project or connect the repository.
2. Add environment variables from `.env.example`.
3. Start command: `npm start`
4. Run `npm run deploy` once to register `/jarvis`.

## Required Discord Developer Portal intents
Enable **Server Members Intent** and **Message Content Intent**. The bot also needs the moderation permissions you want it to use.

## Text commands
Commands use `jarvis` by default, e.g. `jarvis help`, `jarvis ban @user spam`, `jarvis roast @user`.

## Slash commands
Use `/jarvis` after running `npm run deploy`.

## AI roast safety
JARVIS receives the mentioned member as the explicit roast target. The administrator is explicitly excluded from being the target, so `jarvis roast @user` is aimed at the mentioned user.

## Storage
Guild configuration uses atomic JSON writes with rolling backups. This is deliberately dependency-free and safe for a small deployment. PostgreSQL/Redis can be added later without changing command handlers because configuration access is centralized in `src/utils/config.js`.
