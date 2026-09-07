const express = require('express');
const session = require('express-session');
const passport = require('passport');
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');
const DiscordStrategy = require('passport-discord').Strategy;

dotenv.config();

const port = Number(process.env.PORT) || 3000;
function normalizeBaseUrl(value) {
  const fallback = `http://localhost:${port}`;
  const configuredUrl = String(value || fallback).trim().replace(/\/+$/, '');
  return configuredUrl.replace(/\/auth\/discord\/callback(?:\/auth\/discord\/callback)?$/, '');
}

const baseUrl = normalizeBaseUrl(process.env.BASE_URL);
const guildId = process.env.DISCORD_GUILD_ID;
const staffRoleMap = parseStaffRoleMap(process.env.DISCORD_STAFF_ROLE_MAP);
const legacyStaffRoleIds = parseStaffRoleIds(process.env.DISCORD_STAFF_ROLE_IDS);
const discordCache = {
  roles: { value: [], expiresAt: 0 },
  uniqueHoldings: { value: {}, expiresAt: 0 },
};

const isDiscordConfigured = Boolean(
  process.env.DISCORD_CLIENT_ID
  && process.env.DISCORD_CLIENT_SECRET
  && process.env.DISCORD_GUILD_ID
  && baseUrl
);

const STAFF_RANK_STRUCTURE = [
  {
    slug: 'founder',
    label: 'Founder',
    level: 12,
    uniqueHolder: true,
    permissions: {
      accessName: 'Founder access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: true,
      canManageRankStructure: true,
      canBypassRestrictions: true,
      canOverrideModeration: true,
      canManageFounderAssignments: true,
    },
  },
  {
    slug: 'deputy-director',
    label: 'Deputy Director',
    level: 11,
    uniqueHolder: true,
    permissions: {
      accessName: 'Deputy Director access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: true,
      canManageAdministrativeActions: true,
      canApproveStaffActions: true,
      canOverrideModeration: true,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'director',
    label: 'Director',
    level: 10,
    uniqueHolder: false,
    permissions: {
      accessName: 'Director access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: true,
      canManageAdministrativeActions: true,
      canApproveStaffActions: true,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'executive-director',
    label: 'Executive Director',
    level: 9,
    uniqueHolder: false,
    permissions: {
      accessName: 'Executive Director access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: true,
      canManageAdministrativeActions: true,
      canApproveStaffActions: true,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'chief-of-staff',
    label: 'Chief of Staff',
    level: 8,
    uniqueHolder: false,
    permissions: {
      accessName: 'Chief of Staff access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: true,
      canManageAdministrativeActions: true,
      canApproveStaffActions: false,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'head-administrator',
    label: 'Head Administrator',
    level: 7,
    uniqueHolder: false,
    permissions: {
      accessName: 'Head Administrator access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: true,
      canManageAdministrativeActions: true,
      canApproveStaffActions: false,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'administrator',
    label: 'Administrator',
    level: 6,
    uniqueHolder: false,
    permissions: {
      accessName: 'Administrator access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: false,
      canManageAdministrativeActions: true,
      canApproveStaffActions: false,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'junior-administrator',
    label: 'Junior Administrator',
    level: 5,
    uniqueHolder: false,
    permissions: {
      accessName: 'Junior Administrator access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: false,
      canManageAdministrativeActions: false,
      canApproveStaffActions: false,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'senior-moderator',
    label: 'Senior Moderator',
    level: 4,
    uniqueHolder: false,
    permissions: {
      accessName: 'Senior Moderator access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: false,
      canManageAdministrativeActions: false,
      canApproveStaffActions: false,
      canOverrideModeration: true,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'moderator',
    label: 'Moderator',
    level: 3,
    uniqueHolder: false,
    permissions: {
      accessName: 'Moderator access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: false,
      canManageAdministrativeActions: false,
      canApproveStaffActions: false,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'junior-moderator',
    label: 'Junior Moderator',
    level: 2,
    uniqueHolder: false,
    permissions: {
      accessName: 'Junior Moderator access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: false,
      canManageAdministrativeActions: false,
      canApproveStaffActions: false,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
  {
    slug: 'trial-moderator',
    label: 'Trial Moderator',
    level: 1,
    uniqueHolder: false,
    permissions: {
      accessName: 'Trial Moderator access',
      canAccessStaffPortal: true,
      canViewEntireCommandBoard: false,
      canManageAdministrativeActions: false,
      canApproveStaffActions: false,
      canOverrideModeration: false,
      canManageRankStructure: false,
    },
  },
];

const STAFF_RANK_LOOKUP = new Map(
  STAFF_RANK_STRUCTURE.map((rank) => [rank.slug, rank])
);

const DEFAULT_STAFF_ACCESS = {
  accessName: 'Staff access',
  canAccessStaffPortal: true,
  canViewEntireCommandBoard: false,
  canManageAdministrativeActions: false,
  canApproveStaffActions: false,
  canOverrideModeration: false,
  canManageRankStructure: false,
};

function normalizeRankSlug(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseStaffRoleIds(value = '') {
  return value.split(',').map((id) => id.trim()).filter(Boolean);
}

function parseStaffRoleMap(value = '') {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawSlug, ...roleParts] = entry.split(':');
      const roleId = roleParts.join(':').trim();
      if (!rawSlug || !roleId) {
        return null;
      }
      return {
        slug: normalizeRankSlug(rawSlug),
        roleId: roleId.trim(),
      };
    })
    .filter(Boolean);
}

function getDiscordFailureReason(error) {
  const status = error?.response?.status || error?.oauthError?.statusCode;
  const errorMessage = String(error?.message || '').toLowerCase();
  const errorDetails = JSON.stringify(getDiscordErrorDetails(error)).toLowerCase();
  if (errorMessage.includes('1015') || errorDetails.includes('1015') || errorMessage.includes('rate limit')) {
    return 'discord-rate-limited';
  }
  if (errorMessage.includes('access token')) {
    return 'discord-token-exchange';
  }
  const discordCode = error?.response?.data?.code || error?.oauthError?.code;
  if (status) {
    return `discord-callback-${status}${discordCode ? `-${discordCode}` : ''}`;
  }
  return 'discord-callback';
}

function isDiscordRateLimitError(error) {
  const errorMessage = String(error?.message || '').toLowerCase();
  const errorDetails = JSON.stringify(getDiscordErrorDetails(error)).toLowerCase();
  return errorMessage.includes('1015')
    || errorDetails.includes('1015')
    || errorMessage.includes('rate limit');
}

function getDiscordErrorDetails(error) {
  return error?.oauthError?.data
    || error?.oauthError?.message
    || error?.response?.data
    || error?.message
    || 'unknown-discord-error';
}

function addDiscordOAuthTimeout(strategy, timeoutMs = 15000) {
  const oauthClient = strategy._oauth2;
  const request = oauthClient._request.bind(oauthClient);

  oauthClient._request = (method, url, headers, postBody, accessToken, callback) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const error = new Error('Discord OAuth request timed out');
      error.code = 'DISCORD_OAUTH_TIMEOUT';
      callback(error);
    }, timeoutMs);

    request(method, url, headers, postBody, accessToken, (error, result, response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback(error, result, response);
    });
  };
}

function resolveRankDetails(slug = '') {
  const normalized = normalizeRankSlug(slug);
  return STAFF_RANK_LOOKUP.get(normalized) || {
    slug: normalized,
    label: slug || 'Staff Member',
    level: 0,
    uniqueHolder: false,
    permissions: {
      ...DEFAULT_STAFF_ACCESS,
      accessName: 'Custom staff access',
    },
  };
}

function inferRankSlugFromRoleName(roleName = '') {
  const normalizedName = normalizeRankSlug(roleName);
  if (STAFF_RANK_LOOKUP.has(normalizedName)) {
    return normalizedName;
  }
  return null;
}

function getRoleNameMap(discordRoles = []) {
  return new Map(discordRoles.map((role) => [role.id, role.name]));
}

function matchStaffRoles(roleIds, roleMap, fallbackRoleIds = [], discordRoles = []) {
  const roles = new Set(roleIds || []);
  const roleNames = getRoleNameMap(discordRoles);
  const matches = roleMap.filter(({ roleId }) => roles.has(roleId)).map(({ slug }) => slug);
  const inferredMatches = fallbackRoleIds
    .filter((roleId) => roles.has(roleId))
    .map((roleId) => inferRankSlugFromRoleName(roleNames.get(roleId)) || 'legacy-staff');
  const allMatches = [...new Set([...matches, ...inferredMatches])];
  if (allMatches.length > 0) {
    return { isStaff: true, staffRoleSlug: allMatches[0], staffRoleSlugs: allMatches };
  }
  return {
    isStaff: false,
    staffRoleSlug: null,
    staffRoleSlugs: [],
  };
}

function getHighestRankFromRoleList(roleIds = [], roleMap = [], fallbackRoleIds = [], discordRoles = []) {
  const roles = new Set(roleIds || []);
  const roleNames = getRoleNameMap(discordRoles);
  const matchingSlugs = [
    ...roleMap.filter(({ roleId }) => roles.has(roleId)).map(({ slug }) => slug),
    ...fallbackRoleIds
      .filter((roleId) => roles.has(roleId))
      .map((roleId) => inferRankSlugFromRoleName(roleNames.get(roleId))),
  ].filter(Boolean);
  if (matchingSlugs.length > 0) {
    return matchingSlugs
      .map((slug) => resolveRankDetails(slug))
      .sort((a, b) => b.level - a.level)[0] || null;
  }

  if (fallbackRoleIds.some((roleId) => roles.has(roleId))) {
    return {
      slug: 'legacy-staff',
      label: 'Staff Member',
      level: 0,
      uniqueHolder: false,
      permissions: { ...DEFAULT_STAFF_ACCESS, accessName: 'Legacy staff access' },
    };
  }

  return null;
}

async function getGuildRoleMembershipSummary(guildIdValue, botToken, roleMapValue = []) {
  if (!guildIdValue || !botToken || !roleMapValue.length) {
    return {};
  }

  if (discordCache.uniqueHoldings.expiresAt > Date.now()) {
    return discordCache.uniqueHoldings.value;
  }

  const uniqueHoldings = {};
  for (const entry of roleMapValue) {
    const slug = normalizeRankSlug(entry.slug);
    if (['founder', 'deputy-director'].includes(slug)) {
      uniqueHoldings[slug] = 0;
    }
  }

  if (!Object.keys(uniqueHoldings).length) {
    return {};
  }

  let after = null;
  while (true) {
    const query = after ? `?limit=1000&after=${after}` : '?limit=1000';
    const response = await axios
      .get(`https://discord.com/api/guilds/${guildIdValue}/members${query}`, {
        headers: { Authorization: `Bot ${botToken}` },
        timeout: 10000,
      })
      .catch(() => ({ data: [] }));

    const members = Array.isArray(response.data) ? response.data : [];

    for (const member of members) {
      const roleIds = member.roles || [];
      for (const entry of roleMapValue) {
        const slug = normalizeRankSlug(entry.slug);
        if (['founder', 'deputy-director'].includes(slug) && roleIds.includes(entry.roleId)) {
          uniqueHoldings[slug] = (uniqueHoldings[slug] || 0) + 1;
        }
      }
    }

    if (members.length < 1000) {
      break;
    }

    after = members[members.length - 1]?.user?.id;
    if (!after) {
      break;
    }
  }

  discordCache.uniqueHoldings = {
    value: uniqueHoldings,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
  return uniqueHoldings;
}

async function getGuildRoles(guildIdValue, botToken) {
  if (!guildIdValue || !botToken) {
    return [];
  }

  if (discordCache.roles.expiresAt > Date.now()) {
    return discordCache.roles.value;
  }

  const response = await axios.get(`https://discord.com/api/guilds/${guildIdValue}/roles`, {
    headers: { Authorization: `Bot ${botToken}` },
    timeout: 10000,
  }).catch(() => ({ data: [] }));
  const roles = Array.isArray(response.data) ? response.data : [];
  discordCache.roles = {
    value: roles,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
  return roles;
}

function getUniqueRankConflict(slug, uniqueHolderSummary = {}) {
  if (!slug) {
    return false;
  }
  const normalized = normalizeRankSlug(slug);
  if (!['founder', 'deputy-director'].includes(normalized)) {
    return false;
  }
  return Number(uniqueHolderSummary[normalized] || 0) > 1;
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  if (!isDiscordConfigured) {
    console.warn('Discord OAuth is not fully configured yet. Set BASE_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_GUILD_ID in the environment.');
  }

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'ERLCARMY-CHANGE-ME',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 8,
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  if (isDiscordConfigured) {
    const discordStrategy = new DiscordStrategy(
        {
          clientID: process.env.DISCORD_CLIENT_ID,
          clientSecret: process.env.DISCORD_CLIENT_SECRET,
          callbackURL: `${baseUrl}/auth/discord/callback`,
          scope: ['identify', 'guilds.members.read'],
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            let isStaff = false;
            let guildMembership = false;
            let staffRoleSlug = null;
            let staffRoleSlugs = [];
            let accessDetails = { ...DEFAULT_STAFF_ACCESS };

            if (guildId) {
              let memberError = null;
              let memberResponse = await axios.get(
                `https://discord.com/api/users/@me/guilds/${guildId}/member`,
                {
                  headers: { Authorization: `Bearer ${accessToken}` },
                  timeout: 10000,
                }
              ).catch((error) => {
                memberError = error;
                return null;
              });

              if (!memberResponse && process.env.DISCORD_BOT_TOKEN) {
                memberResponse = await axios.get(
                  `https://discord.com/api/guilds/${guildId}/members/${profile.id}`,
                  {
                    headers: {
                      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                    },
                    timeout: 10000,
                  }
                ).catch((error) => {
                  memberError = error;
                  return null;
                });
              }

              if (memberError) {
                console.error('Discord member verification failed:', {
                  status: memberError.response?.status,
                  code: memberError.response?.data?.code,
                  message: memberError.response?.data?.message || memberError.message,
                });
              }

              guildMembership = Boolean(memberResponse?.data);

              const discordRoles = await getGuildRoles(guildId, process.env.DISCORD_BOT_TOKEN);

              const roleAccess = matchStaffRoles(
                memberResponse?.data?.roles || [],
                staffRoleMap,
                legacyStaffRoleIds,
                discordRoles
              );

              isStaff = roleAccess.isStaff;
              staffRoleSlug = roleAccess.staffRoleSlug;
              staffRoleSlugs = roleAccess.staffRoleSlugs;

              if (isStaff) {
                const highestRank = getHighestRankFromRoleList(
                  memberResponse?.data?.roles || [],
                  staffRoleMap,
                  legacyStaffRoleIds,
                  discordRoles
                );

                const rankDetails = highestRank || resolveRankDetails(staffRoleSlug);
                accessDetails = { ...DEFAULT_STAFF_ACCESS, ...rankDetails.permissions };

                if (process.env.DISCORD_ENFORCE_UNIQUE_RANKS === 'true') {
                  const uniqueRoleSummary = await getGuildRoleMembershipSummary(
                    guildId,
                    process.env.DISCORD_BOT_TOKEN,
                    staffRoleMap
                  );

                  if (getUniqueRankConflict(staffRoleSlug, uniqueRoleSummary)) {
                    isStaff = false;
                    staffRoleSlug = null;
                    staffRoleSlugs = [];
                    accessDetails = {
                      ...DEFAULT_STAFF_ACCESS,
                      accessName: 'Rank conflict detected',
                    };
                  }
                }
              }
            }

            const user = {
              id: profile.id,
              username: profile.username,
              avatar: profile.avatar,
              isStaff,
              staffRoleSlug: staffRoleSlug || null,
              staffRoleSlugs: staffRoleSlugs || [],
              rankLevel: staffRoleSlug ? resolveRankDetails(staffRoleSlug).level : 0,
              accessName: accessDetails.accessName || 'Staff access',
              permissions: accessDetails,
              guildMembership,
              guildId,
            };

            return done(null, user);
          } catch (error) {
            console.error('Discord auth error:', error.response?.data || error.message);
            return done(error, null);
          }
        }
      );
    addDiscordOAuthTimeout(discordStrategy);
    passport.use(discordStrategy);
  }

  function requireStaffAccess(req, res, next) {
    if (!req.isAuthenticated() || !req.user || !req.user.isStaff) {
      return res.status(403).send(`
        <html>
          <head>
            <title>ERLCARMY Staff Access</title>
            <style>
              body { font-family: Arial, sans-serif; background: #0c1220; color: white; padding: 40px; }
              a { color: #5ea7ff; }
              .box { max-width: 640px; margin: 0 auto; padding: 32px; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: #111c2b; }
            </style>
          </head>
          <body>
            <div class="box">
              <h1>Access Denied</h1>
              <p>You must have a verified ERLC Discord staff role to access this portal.</p>
              <p><a href="/auth/discord?redirect=/staff">Log in with Discord</a></p>
              <p><a href="/">Return to the public ERLCARMY site</a></p>
            </div>
          </body>
        </html>
      `);
    }
    next();
  }

  app.get('/auth/discord', (req, res, next) => {
    if (!isDiscordConfigured) {
      return res.status(500).send(`
        <html>
          <head><title>Discord OAuth misconfigured</title></head>
          <body style="font-family:Arial,sans-serif;background:#0c1220;color:#edf3ff;padding:40px;line-height:1.6;">
            <div style="max-width:700px;margin:0 auto;padding:32px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:#111c2b;">
              <h1>Discord OAuth is not configured</h1>
              <p>The staff portal login cannot work until the Discord app values are set in <strong>.env</strong>.</p>
              <p>Required values:</p>
              <ul>
                <li>DISCORD_CLIENT_ID</li>
                <li>DISCORD_CLIENT_SECRET</li>
                <li>DISCORD_GUILD_ID</li>
                <li>BASE_URL</li>
              </ul>
              <p><code>DISCORD_BOT_TOKEN</code> is optional for sign-in, but enables the fallback member lookup and unique-rank checks.</p>
              <p>Redirect URL must be set in Discord Developer Portal:</p>
              <code style="display:block;padding:12px;border-radius:8px;background:#0b1320;white-space:pre-wrap;">${baseUrl}/auth/discord/callback</code>
              <p><a href="/" style="color:#5ea7ff;">Return to the public site</a></p>
            </div>
          </body>
        </html>
      `);
    }

    const redirectTo = typeof req.query.redirect === 'string' ? req.query.redirect : '/staff';
    req.session.redirectTo = redirectTo;
    passport.authenticate('discord')(req, res, next);
  });

  app.get('/auth/discord/callback', (req, res, next) => {
    const authenticateDiscord = (attempt = 0) => passport.authenticate('discord', (error, user) => {
      if (error) {
        console.error('Discord callback failed:', getDiscordErrorDetails(error));
        if (attempt === 0 && isDiscordRateLimitError(error)) {
          return setTimeout(() => authenticateDiscord(1)(req, res, next), 2000);
        }
        return res.redirect(`/staff?auth=failed&reason=${getDiscordFailureReason(error)}`);
      }

      if (!user) {
        return res.redirect('/staff?auth=failed&reason=discord-access');
      }

      return req.logIn(user, (loginError) => {
        if (loginError) {
          console.error('Discord session failed:', loginError.message);
          return res.redirect('/staff?auth=failed&reason=session');
        }

        return res.redirect(req.session.redirectTo || '/staff');
      });
    })(req, res, next);
  });

  app.get('/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      req.session.destroy(() => {
        res.redirect('/');
      });
    });
  });

  app.get('/api/session', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      user: req.user,
    });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/staff', requireStaffAccess, (req, res) => {
    res.sendFile(path.join(__dirname, 'staff.html'));
  });

  app.use(express.static(__dirname, { index: false }));

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.use((req, res) => {
    res.status(404).send('ERLCARMY route not found.');
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  app.listen(port, () => {
    console.log(`ERLCARMY is running on http://localhost:${port}`);
    console.log(`Base URL configured: ${baseUrl}`);
    console.log(`Discord OAuth configured: ${isDiscordConfigured ? 'yes' : 'no'}`);
  });
}

module.exports = {
  app,
  createApp,
  parseStaffRoleIds,
  parseStaffRoleMap,
  matchStaffRoles,
  resolveRankDetails,
  getHighestRankFromRoleList,
  getGuildRoleMembershipSummary,
  STAFF_RANK_STRUCTURE,
};
