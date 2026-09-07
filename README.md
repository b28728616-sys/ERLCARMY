# ERLCARMY

ERLCARMY is an Express website with a Discord-authenticated staff portal.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and fill in the Discord application values.
3. Run `npm install` and `npm start`.
4. Open `http://localhost:3000`.

For Discord staff login, register this callback URL in the Discord Developer Portal:

```text
http://localhost:3000/auth/discord/callback
```

## Deploy to Render

Create a Render Blueprint from this repository. Render will read `render.yaml`; set the private environment variables there and register the matching `/auth/discord/callback` URL in Discord.

Never commit `.env`, bot tokens, or client secrets.

## Staff operations

The staff portal includes shift tracking with a two-hour weekly quota, moderation action logging, and management-only infractions. Administrator rank and above can log bans; all staff can log BOLOs, warnings, and kicks. Director rank and above can create infractions.

Game command, join, leave, and kill events are accepted through `POST /api/game/logs`. Configure `GAME_LOG_WEBHOOK_SECRET` in Render and send it as the `x-erlcarmy-webhook` header. Example payloads:

```json
{"type":"join","player":"Player123","serverId":"server-01"}
{"type":"leave","player":"Player123","serverId":"server-01"}
{"type":"kill","player":"OfficerA","target":"Player123","reason":"RDM","serverId":"server-01"}
{"type":"command","player":"ModeratorA","command":":kick Player123 RDM","serverId":"server-01"}
```