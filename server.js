const express = require('express');
const session = require('express-session');
const passport = require('passport');
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');
const DiscordStrategy = require('passport-discord').Strategy;

dotenv.config();
const port = Number(process.env.PORT) || 3000;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const guildId = process.env.DISCORD_GUILD_ID;
const staffRoleIds = String(process.env.DISCORD_STAFF_ROLE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
const discordConfigured = Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && guildId);

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET || 'ERLCARMY-CHANGE-ME',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  if (discordConfigured) {
    passport.use(new DiscordStrategy({
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: `${baseUrl}/auth/discord/callback`,
      scope: ['identify', 'guilds'],
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const guilds = await axios.get('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${accessToken}` } });
        const guild = guilds.data.find((entry) => entry.id === guildId);
        let roles = [];
        if (guild && process.env.DISCORD_BOT_TOKEN) {
          const member = await axios.get(`https://discord.com/api/guilds/${guildId}/members/${profile.id}`, { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }).catch(() => null);
          roles = member?.data?.roles || [];
        }
        return done(null, { id: profile.id, username: profile.username, avatar: profile.avatar, guildMembership: Boolean(guild), isStaff: staffRoleIds.some((id) => roles.includes(id)) });
      } catch (error) {
        return done(error);
      }
    }));
  }

  app.get('/auth/discord', (req, res, next) => {
    if (!discordConfigured) return res.status(500).send('Discord OAuth is not configured.');
    req.session.redirectTo = typeof req.query.redirect === 'string' ? req.query.redirect : '/staff';
    passport.authenticate('discord')(req, res, next);
  });
  app.get('/auth/discord/callback', (req, res, next) => passport.authenticate('discord', { failureRedirect: '/staff', successRedirect: req.session.redirectTo || '/staff' })(req, res, next));
  app.get('/logout', (req, res, next) => req.logout((error) => { if (error) return next(error); req.session.destroy(() => res.redirect('/')); }));
  app.get('/api/session', (req, res) => res.json(req.isAuthenticated() ? { authenticated: true, user: req.user } : { authenticated: false }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/staff', (req, res) => res.sendFile(path.join(__dirname, 'staff.html')));
  app.use(express.static(__dirname, { index: false }));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  app.use((req, res) => res.status(404).send('ERLCARMY route not found.'));
  return app;
}

const app = createApp();
if (require.main === module) app.listen(port, () => console.log(`ERLCARMY is running on ${baseUrl}`));
module.exports = { app, createApp };
