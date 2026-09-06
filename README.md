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