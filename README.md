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

The staff portal includes shift tracking with a two-hour weekly quota, moderation action logging, and management-only infractions.

### Moderation action types

| Action | Who can log | Notes |
|---|---|---|
| Warning | All staff | Requires a severity (Standard / Serious / Critical) |
| Kick | All staff | Document the reason and optional duration |
| BOLO | All staff | Be On the Look Out — a watchlist entry |
| Ban BOLO | All staff | A **pending** ban that requires administrator approval to complete |
| Ban | Administrator+ | An immediate ban |
| Complete Ban BOLO | Administrator+ | Converts a pending Ban BOLO into an executed ban |

Administrator rank and above can log bans and complete Ban BOLOs; all staff can log BOLOs, warnings, and kicks. The pending Ban BOLO queue appears automatically for administrators in the portal.

### Infractions

Infractions can only be created by management (Head Administrator and above). When an infraction is created, the bot sends a Discord DM to the named staff member (resolved via the guild member list).

**Visibility rules:**

- **Management** can see **all** infractions.
- **Non-management staff** can only see infractions where **they are the target** (i.e., infractions they have received).

Infraction data is stored in `operations.json`.

### ERLC game API integration

The staff portal can query and send commands to an ERLC private server via the [ER:LC API v2](https://apidocs.erlc.gg/). Set `ERLC_SERVER_KEY` in your environment to enable it.

- `GET /api/erlc/server` — fetches live server data (players, staff, kill logs, command logs, queue, vehicles, etc.). Append query flags: `?players=true&staff=true&killLogs=true`.
- `POST /api/erlc/command` — runs a command on the server, e.g. `{"command":":h Server maintenance"}`.

Both endpoints require Management access.

### Game log webhooks

Game command, join, leave, and kill events are accepted through `POST /api/game/logs`. Configure `GAME_LOG_WEBHOOK_SECRET` in Render and send it as the `x-erlcarmy-webhook` header. Example payloads:

```json
{"type":"join","player":"Player123","serverId":"server-01"}
{"type":"leave","player":"Player123","serverId":"server-01"}
{"type":"kill","player":"OfficerA","target":"Player123","reason":"RDM","serverId":"server-01"}
{"type":"command","player":"ModeratorA","command":":kick Player123 RDM","serverId":"server-01"}
```