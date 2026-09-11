const express = require('express');
const session = require('express-session');
const passport = require('passport');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const DiscordStrategy = require('passport-discord').Strategy;

dotenv.config();

const OPERATIONS_FILE = path.join(__dirname, 'data', 'operations.json');
const ERLC_API_BASE = 'https://api.erlc.gg';
const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY;
const isErlcMockMode = !ERLC_SERVER_KEY;
const sendInfractionDms = process.env.DISCORD_SEND_INFRACTION_DMS === 'true';

const port = Number(process.env.PORT) || 3000;
function normalizeBaseUrl(value) {
  const fallback = `http://localhost:${port}`;
  const configuredUrl = String(value || fallback).trim().replace(/\/+$/, '');
  return configuredUrl.replace(/\/auth\/discord\/callback(?:\/auth\/discord\/callback)?$/, '');
}

const baseUrl = normalizeBaseUrl(process.env.BASE_URL);

function normalizeOAuthRedirectUri(value) {
  if (!value) return null;
  const trimmed = String(value).trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().replace(/\/+$/, '') : null;
  } catch (error) {
    return null;
  }
}

function getOAuthRedirectUri(req) {
  const configured = normalizeOAuthRedirectUri(process.env.DISCORD_REDIRECT_URI);
  if (configured) return configured;
  if (!req) return `${baseUrl}/auth/discord/callback`;

  const protocol = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!host || !['http:', 'https:'].includes(protocol)) {
    return `${baseUrl}/auth/discord/callback`;
  }

  try {
    return new URL('/auth/discord/callback', `${protocol}://${host}`).toString().replace(/\/+$/, '');
  } catch (error) {
    return `${baseUrl}/auth/discord/callback`;
  }
}

const discordRedirectUri = getOAuthRedirectUri();

const guildId = process.env.DISCORD_GUILD_ID;
const staffRoleMap = parseStaffRoleMap(process.env.DISCORD_STAFF_ROLE_MAP);
const legacyStaffRoleIds = parseStaffRoleIds(process.env.DISCORD_STAFF_ROLE_IDS);
const discordCache = {
  roles: { value: [], expiresAt: 0 },
  uniqueHoldings: { value: {}, expiresAt: 0 },
};
const usedDiscordCallbackCodes = new Map();
let discordTokenCooldownUntil = 0;
let discordRateLimitStreak = 0;

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

function getDiscordErrorDetails(error) {
  return error?.oauthError?.data
    || error?.oauthError?.message
    || error?.response?.data
    || error?.message
    || 'unknown-discord-error';
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

function loadOperations() {
  try {
    const raw = fs.readFileSync(OPERATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { shifts: [], actions: [], infractions: [], gameLogs: parsed };
    }
    return {
      shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      infractions: Array.isArray(parsed.infractions) ? parsed.infractions : [],
      gameLogs: Array.isArray(parsed.gameLogs) ? parsed.gameLogs : [],
    };
  } catch (err) {
    return { shifts: [], actions: [], infractions: [], gameLogs: [] };
  }
}

function saveOperations(ops) {
  const data = {
    shifts: ops.shifts || [],
    actions: ops.actions || [],
    infractions: ops.infractions || [],
    gameLogs: ops.gameLogs || [],
  };
  fs.mkdirSync(path.dirname(OPERATIONS_FILE), { recursive: true });
  fs.writeFileSync(OPERATIONS_FILE, JSON.stringify(data, null, 2));
}

function isManagementUser(user) {
  return Boolean(
    user &&
      user.isStaff &&
      user.permissions &&
      user.permissions.canViewEntireCommandBoard === true
  );
}

function isStaffUser(user) {
  return Boolean(user && user.isStaff);
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function getWeekKey(d = new Date()) {
  const date = new Date(d);
  const year = date.getFullYear();
  const week = getWeekNumber(date);
  return `${year}-${String(week).padStart(2, '0')}`;
}

function getWeeklyShiftMinutes(ops, staffId, weekKey) {
  const shifts = ops.shifts || [];
  const weekly = shifts.filter((s) => s.staffId === staffId && s.weekOf === weekKey);
  return weekly.reduce((total, s) => total + (s.durationMinutes || 0), 0);
}

async function findDiscordUserByUsername(username) {
  if (!guildId || !process.env.DISCORD_BOT_TOKEN || !username) return null;

  const searchTerm = username.toLowerCase().trim();
  let after = null;

  while (true) {
    const query = after ? `?limit=1000&after=${after}` : '?limit=1000';
    const response = await axios
      .get(`https://discord.com/api/guilds/${guildId}/members${query}`, {
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      })
      .catch(() => ({ data: [] }));

    const members = Array.isArray(response.data) ? response.data : [];

    for (const member of members) {
      if (!member.user) continue;
      const discordTag =
        member.user.discriminator && member.user.discriminator !== '0'
          ? `${member.user.username}#${member.user.discriminator}`
          : member.user.username;
      const globalName = member.user.global_name || '';
      if (
        member.user.username.toLowerCase() === searchTerm ||
        discordTag.toLowerCase() === searchTerm ||
        globalName.toLowerCase() === searchTerm
      ) {
        return member.user.id;
      }
    }

    if (members.length < 1000) break;
    after = members[members.length - 1]?.user?.id;
    if (!after) break;
  }

  return null;
}

function formatInfractionDM(infraction) {
  const severityLabel = (infraction.severity || 'standard').toUpperCase();
  const createdAt = new Date(infraction.createdAt).toLocaleString();
  const lines = [
    'Hello, you have received a management infraction on ERLCARMY.',
    '',
    `**Reason:** ${infraction.reason}`,
    `**Severity:** ${severityLabel}`,
    `**Issued by:** ${infraction.createdBy || 'Management'}`,
    `**Date:** ${createdAt}`,
  ];
  if (infraction.notes) {
    lines.push('', `**Notes:** ${infraction.notes}`);
  }
  lines.push('', 'If you have questions or wish to appeal, please contact the management team.');
  return lines.join('\n');
}

async function dmUserInfraction(userId, infraction) {
  if (!userId || !process.env.DISCORD_BOT_TOKEN || !sendInfractionDms) return false;

  try {
    const dmChannel = await axios
      .post(
        'https://discord.com/api/v10/users/@me/channels',
        { recipient_id: userId },
        {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      )
      .catch(() => null);

    const channelId = dmChannel?.data?.id;
    if (!channelId) {
      console.error('Failed to create DM channel for user:', userId);
      return false;
    }

    const message = formatInfractionDM(infraction);
    await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      { content: message },
      {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return true;
  } catch (err) {
    console.error('Failed to DM user:', err.response?.data || err.message);
    return false;
  }
}

function getErlcMockServer() {
  return {
    isMock: true,
    Name: 'ERLC Private Server',
    CurrentPlayers: 12,
    MaxPlayers: 50,
    JoinKey: 'erlc-mock-key',
    Staff: {
      Admins: { '123': { Username: 'AdminPlayer', UserId: 123 } },
      Mods: { '456': { Username: 'ModPlayer', UserId: 456 } },
      Helpers: {},
    },
    Queue: [
      { Username: 'QueuedUser1', UserId: 789 },
      { Username: 'QueuedUser2', UserId: 790 },
    ],
    KillLogs: [
      { Killer: 'OfficerA', Victim: 'CriminalX', Weapon: 'Pistol', Time: new Date().toISOString() },
    ],
    CommandLogs: [
      { Player: 'ModPlayer', Command: ':msg Everyone please follow the rules', Time: new Date().toISOString() },
    ],
    JoinLogs: [
      { Player: 'NewPlayer1', Time: new Date().toISOString() },
      { Player: 'NewPlayer2', Time: new Date().toISOString() },
    ],
    Vehicles: [
      { Name: 'Interceptor', Owner: 'OfficerA' },
      { Name: 'SUV', Owner: 'OfficerB' },
    ],
  };
}

function getErlcMockCommandResult(command) {
  return {
    isMock: true,
    success: true,
    command: String(command || ''),
    message: `Mock command sent: ${command || ''}`,
    playersNotified: [],
  };
}

async function erlcRequest(path, options = {}) {
  if (isErlcMockMode) {
    if (path.includes('/v2/server/command')) {
      return getErlcMockCommandResult(options.data?.command);
    }
    return {};
  }

  if (!ERLC_SERVER_KEY) {
    throw new Error('ERLC server key is not configured');
  }

  const response = await axios({
    url: `${ERLC_API_BASE}${path}`,
    headers: {
      'server-key': ERLC_SERVER_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  return response.data;
}

async function fetchErlcServer(queryParams = {}) {
  if (isErlcMockMode) {
    return getErlcMockServer();
  }

  const query = new URLSearchParams();
  const paramMap = {
    players: 'Players',
    staff: 'Staff',
    killLogs: 'KillLogs',
    commandLogs: 'CommandLogs',
    joinLogs: 'JoinLogs',
    queue: 'Queue',
    modCalls: 'ModCalls',
    emergencyCalls: 'EmergencyCalls',
    vehicles: 'Vehicles',
  };

  for (const [key, erlcKey] of Object.entries(paramMap)) {
    if (queryParams[key]) query.append(erlcKey, 'true');
  }

  const qs = query.toString();
  return await erlcRequest(`/v2/server${qs ? `?${qs}` : ''}`);
}

async function runErlcCommand(command) {
  if (isErlcMockMode) {
    return getErlcMockCommandResult(command);
  }

  return await erlcRequest('/v2/server/command', {
    method: 'POST',
    data: { command },
  });
}

function isDiscordRateLimitError(error) {
  const errorMessage = String(error?.message || '').toLowerCase();
  const errorDetails = JSON.stringify(getDiscordErrorDetails(error)).toLowerCase();
  return errorMessage.includes('1015')
    || errorDetails.includes('1015')
    || errorMessage.includes('rate limit');
}

function getDiscordRetryAfter(error) {
  const retryAfter = error?.response?.data?.retry_after
    || error?.response?.headers?.['retry-after'];
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 30;
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

  let discordStrategy = null;
  if (isDiscordConfigured) {
    discordStrategy = new DiscordStrategy(
        {
          clientID: process.env.DISCORD_CLIENT_ID,
          clientSecret: process.env.DISCORD_CLIENT_SECRET,
          callbackURL: discordRedirectUri,
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
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                  timeout: 10000,
                }
              ).catch((error) => {
                memberError = error;
                return null;
              });

              if (!memberResponse && memberError?.response?.status !== 429 && process.env.DISCORD_BOT_TOKEN) {
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

              let discordRoles = [];
              let roleAccess = matchStaffRoles(
                memberResponse?.data?.roles || [],
                staffRoleMap,
                legacyStaffRoleIds,
                discordRoles
              );

              if (!roleAccess.isStaff && legacyStaffRoleIds.length) {
                discordRoles = await getGuildRoles(guildId, process.env.DISCORD_BOT_TOKEN);
                roleAccess = matchStaffRoles(
                  memberResponse?.data?.roles || [],
                  staffRoleMap,
                  legacyStaffRoleIds,
                  discordRoles
                );
              }

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
    passport.use(discordStrategy);
    addDiscordOAuthTimeout(discordStrategy);
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

  function requireManagement(req, res, next) {
    if (!req.isAuthenticated() || !req.user || !req.user.isStaff) {
      return res.status(403).json({ error: 'Staff access required' });
    }
    if (!isManagementUser(req.user)) {
      return res.status(403).json({ error: 'Management access required' });
    }
    next();
  }

  function requireStaffApi(req, res, next) {
    if (!req.isAuthenticated() || !req.user?.isStaff) {
      return res.status(401).json({ error: 'Staff authentication required.' });
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
              <p>The staff portal login cannot work until the Discord app values are set in the environment.</p>
              <p>Required values:</p>
              <ul>
                <li>DISCORD_CLIENT_ID</li>
                <li>DISCORD_CLIENT_SECRET</li>
                <li>DISCORD_GUILD_ID</li>
                <li>BASE_URL</li>
              </ul>
              <p><code>DISCORD_BOT_TOKEN</code> is optional for sign-in, but enables the fallback member lookup and unique-rank checks.</p>
              <p>Redirect URL must be set in Discord Developer Portal:</p>
              <code style="display:block;padding:12px;border-radius:8px;background:#0b1320;white-space:pre-wrap;">${discordRedirectUri}</code>
              <p><a href="/" style="color:#5ea7ff;">Return to the public site</a></p>
            </div>
          </body>
        </html>
      `);
    }

    const redirectTo = typeof req.query.redirect === 'string' ? req.query.redirect : '/staff';
    req.session.redirectTo = redirectTo;
    const state = crypto.randomBytes(24).toString('hex');
    req.session.discordOAuthState = state;
    const callbackUrl = discordRedirectUri;
    const authorizationUrl = new URL('https://discord.com/oauth2/authorize');
    authorizationUrl.search = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'identify guilds.members.read',
      state,
    }).toString();
    res.redirect(authorizationUrl.toString());
  });

  app.get('/auth/discord/client-callback', (req, res) => {
    res.type('html').send(`
      <!doctype html>
      <html lang="en">
        <head><meta charset="utf-8"><title>Verifying Discord</title></head>
        <body style="font-family:Arial,sans-serif;background:#0c1220;color:#edf3ff;padding:40px;">
          <p id="message">Verifying your Discord account...</p>
          <script>
            const params = new URLSearchParams(window.location.hash.slice(1));
            const accessToken = params.get('access_token');
            const state = params.get('state');
            const error = params.get('error');
            const message = document.getElementById('message');
            if (error || !accessToken || !state) {
              message.textContent = 'Discord authorization was cancelled or did not return a token.';
            } else {
              fetch('/api/auth/discord/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ accessToken, state })
              }).then((response) => response.json()).then((result) => {
                window.location.replace(result.redirect || '/staff?auth=failed&reason=discord-callback');
              }).catch(() => {
                message.textContent = 'Verification failed. Please return to the staff portal and try again.';
              });
            }
          </script>
        </body>
      </html>
    `);
  });

  app.post('/api/auth/discord/verify', async (req, res) => {
    const { accessToken, state } = req.body || {};
    if (!accessToken || !state || state !== req.session.discordOAuthState) {
      return res.status(400).json({ redirect: '/staff?auth=failed&reason=discord-state' });
    }
    delete req.session.discordOAuthState;

    try {
      const profileResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      return discordStrategy._verify(accessToken, null, profileResponse.data, (error, user) => {
        if (error) {
          console.error('Discord profile verification failed:', getDiscordErrorDetails(error));
          return res.json({ redirect: `/staff?auth=failed&reason=${getDiscordFailureReason(error)}` });
        }
        if (!user) {
          return res.json({ redirect: '/staff?auth=failed&reason=discord-access' });
        }
        req.logIn(user, (loginError) => {
          if (loginError) {
            console.error('Discord session failed:', loginError.message);
            return res.json({ redirect: '/staff?auth=failed&reason=session' });
          }
          return res.json({ redirect: req.session.redirectTo || '/staff' });
        });
      });
    } catch (error) {
      console.error('Discord profile request failed:', getDiscordErrorDetails(error));
      return res.json({ redirect: `/staff?auth=failed&reason=${getDiscordFailureReason(error)}` });
    }
  });

  app.get('/auth/discord/callback', (req, res, next) => {
    const callbackState = typeof req.query.state === 'string' ? req.query.state : null;
    if (!discordStrategy || !req.query.code || !callbackState || callbackState !== req.session.discordOAuthState) {
      delete req.session.discordOAuthState;
      return res.redirect('/staff?auth=failed&reason=discord-state');
    }
    delete req.session.discordOAuthState;

    if (discordTokenCooldownUntil > Date.now()) {
      const retryAfter = Math.ceil((discordTokenCooldownUntil - Date.now()) / 1000);
      return res.redirect(`/staff?auth=failed&reason=discord-rate-limited&retryAfter=${retryAfter}`);
    }

    const callbackCode = String(req.query.code);
    const previousUse = usedDiscordCallbackCodes.get(callbackCode);
    if (previousUse && previousUse > Date.now() - 10 * 60 * 1000) {
      return res.redirect('/staff?auth=failed&reason=discord-code-used');
    }
    usedDiscordCallbackCodes.set(callbackCode, Date.now());
    for (const [code, usedAt] of usedDiscordCallbackCodes) {
      if (usedAt < Date.now() - 10 * 60 * 1000) {
        usedDiscordCallbackCodes.delete(code);
      }
    }

    const callbackTimeout = setTimeout(() => {
      console.error('Discord callback timed out before authentication completed');
      if (!res.headersSent) {
        res.redirect('/staff?auth=failed&reason=discord-timeout');
      }
    }, 20000);

    const finish = (redirect) => {
      clearTimeout(callbackTimeout);
      if (!res.headersSent) {
        res.redirect(redirect);
      }
    };

    axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: callbackCode,
      redirect_uri: discordRedirectUri,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }).then(async (tokenResponse) => {
      const accessToken = tokenResponse.data?.access_token;
      if (!accessToken) {
        throw new Error('Discord did not return an access token');
      }

      discordRateLimitStreak = 0;
      discordTokenCooldownUntil = 0;

      const profileResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      return { accessToken, profile: profileResponse.data };
    }).then(({ accessToken, profile }) => {
      discordStrategy._verify(accessToken, null, profile, (error, user) => {
        if (error) {
          console.error('Discord profile verification failed:', getDiscordErrorDetails(error));
          return finish(`/staff?auth=failed&reason=${getDiscordFailureReason(error)}`);
        }
        if (!user) {
          return finish('/staff?auth=failed&reason=discord-access');
        }

        req.logIn(user, (loginError) => {
          if (loginError) {
            console.error('Discord session failed:', loginError.message);
            return finish('/staff?auth=failed&reason=session');
          }
          return finish(req.session.redirectTo || '/staff');
        });
      });
    }).catch((error) => {
      console.error('Discord token exchange failed:', getDiscordErrorDetails(error));
      if (error?.response?.status === 429 || isDiscordRateLimitError(error)) {
        const providerRetryAfter = getDiscordRetryAfter(error);
        discordRateLimitStreak = Math.min(discordRateLimitStreak + 1, 4);
        const retryAfter = Math.max(
          providerRetryAfter,
          30 * (2 ** (discordRateLimitStreak - 1))
        );
        discordTokenCooldownUntil = Date.now() + retryAfter * 1000;
        return finish(`/staff?auth=failed&reason=discord-rate-limited&retryAfter=${retryAfter}`);
      }
      finish(`/staff?auth=failed&reason=${getDiscordFailureReason(error)}`);
    });
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

  app.get('/api/staff/operations', requireStaffApi, (req, res) => {
    const ops = loadOperations();
    const weekKey = getWeekKey();

    const isMgmt = isManagementUser(req.user);
    const isAdmin = Boolean(req.user.permissions?.canManageAdministrativeActions);

    let infractions = ops.infractions || [];
    if (!isMgmt) {
      infractions = infractions.filter((i) => i.playerId === req.user.id);
    }

    let gameLogs = ops.gameLogs || [];
    if (!isMgmt) {
      gameLogs = gameLogs.filter((log) => log.type !== 'ban');
    }

    const activeShift = (ops.shifts || [])
      .filter((s) => s.staffId === req.user.id && !s.endedAt)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;

    const weeklyMinutes = getWeeklyShiftMinutes(ops, req.user.id, weekKey);
    const recentShifts = (ops.shifts || [])
      .filter((s) => s.staffId === req.user.id)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, 10);

    const pendingBanBolos = (ops.actions || [])
      .filter((a) => a.type === 'ban-bolo' && a.status === 'pending');

    res.json({
      infractions,
      gameLogs,
      actions: ops.actions || [],
      shifts: recentShifts,
      activeShift,
      pendingBanBolos,
      weeklyQuotaSeconds: 7200,
      weeklyShiftSeconds: weeklyMinutes * 60,
      canLogBan: isAdmin,
      canCompleteBanBolo: isAdmin,
      canLogInfraction: isMgmt,
    });
  });

  app.post('/api/staff/shifts/start', requireStaffApi, (req, res) => {
    const ops = loadOperations();
    ops.shifts = ops.shifts || [];

    const existingActive = ops.shifts.find(
      (s) => s.staffId === req.user.id && !s.endedAt
    );
    if (existingActive) {
      return res.status(400).json({ error: 'You already have an active shift' });
    }

    const now = new Date();
    const weekKey = getWeekKey(now);

    const newShift = {
      id: `shift-${Date.now()}`,
      staffId: req.user.id,
      staffName: req.user.username,
      startedAt: now.toISOString(),
      endedAt: null,
      durationMinutes: 0,
      weekOf: weekKey,
    };

    ops.shifts.push(newShift);
    saveOperations(ops);

    res.json({ success: true, shift: newShift });
  });

  app.post('/api/staff/shifts/stop', requireStaffApi, (req, res) => {
    const ops = loadOperations();
    ops.shifts = ops.shifts || [];

    const activeShift = ops.shifts
      .filter((s) => s.staffId === req.user.id && !s.endedAt)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];

    if (!activeShift) {
      return res.status(400).json({ error: 'No active shift to end' });
    }

    const now = new Date();
    const started = new Date(activeShift.startedAt);
    const durationMinutes = Math.max(1, Math.round((now - started) / 60000));

    activeShift.endedAt = now.toISOString();
    activeShift.durationMinutes = durationMinutes;

    saveOperations(ops);

    res.json({ success: true, durationMinutes });
  });

  app.post('/api/staff/actions', requireStaffApi, (req, res) => {
    const { type, target, reason, severity, duration } = req.body;

    if (!type || !target || !reason) {
      return res.status(400).json({ error: 'Type, target, and reason are required' });
    }

    const isAdmin = Boolean(req.user.permissions?.canManageAdministrativeActions);

    if (type === 'ban' && !isAdmin) {
      return res.status(403).json({ error: 'Administrator+ access required to log bans' });
    }

    const ops = loadOperations();
    ops.actions = ops.actions || [];

    const action = {
      id: `action-${Date.now()}`,
      type,
      target,
      reason,
      severity: type === 'warn' ? (severity || 'standard') : (severity || null),
      duration: duration || null,
      status: type === 'ban-bolo' ? 'pending' : 'completed',
      actorUsername: req.user.username,
      createdById: req.user.id,
      createdAt: new Date().toISOString(),
    };

    ops.actions.push(action);
    saveOperations(ops);

    res.json({ success: true, id: action.id });
  });

  app.post('/api/staff/actions/:id/complete', requireStaffApi, (req, res) => {
    const isAdmin = Boolean(req.user.permissions?.canManageAdministrativeActions);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Administrator+ access required to complete ban BOLOs' });
    }

    const ops = loadOperations();
    ops.actions = ops.actions || [];

    const action = ops.actions.find((a) => a.id === req.params.id);
    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    if (action.type !== 'ban-bolo') {
      return res.status(400).json({ error: 'Only ban BOLOs can be completed' });
    }

    if (action.status === 'completed') {
      return res.status(400).json({ error: 'Ban BOLO is already completed' });
    }

    action.status = 'completed';
    action.completedBy = req.user.username;
    action.completedAt = new Date().toISOString();
    saveOperations(ops);

    res.json({ success: true, id: action.id });
  });

  app.post('/api/staff/infractions', requireManagement, async (req, res) => {
    const { target, reason, severity, notes, playerId } = req.body;

    if (!target || !reason) {
      return res.status(400).json({ error: 'Target and reason are required' });
    }

    let resolvedPlayerId = playerId;
    if (!resolvedPlayerId) {
      resolvedPlayerId = await findDiscordUserByUsername(target);
    }

    const infraction = {
      id: `inf-${Date.now()}`,
      playerId: resolvedPlayerId || null,
      playerName: target,
      target,
      reason,
      severity: severity || 'standard',
      notes: notes || '',
      managementOnly: true,
      createdBy: req.user.username,
      createdById: req.user.id,
      actorUsername: req.user.username,
      createdAt: new Date().toISOString(),
    };

    const ops = loadOperations();
    ops.infractions = ops.infractions || [];
    ops.infractions.push(infraction);
    saveOperations(ops);

    let dmSent = false;
    let dmError = null;
    if (!sendInfractionDms) {
      dmError = 'DM notifications disabled by configuration (set DISCORD_SEND_INFRACTION_DMS=true to enable)';
    } else if (resolvedPlayerId) {
      try {
        dmSent = await dmUserInfraction(resolvedPlayerId, infraction);
        if (!dmSent) {
          dmError = 'User has DMs disabled or could not be messaged';
        }
      } catch (err) {
        dmError = err.message;
      }
    } else {
      dmError = 'Could not resolve Discord user for this target';
    }

    res.json({ success: true, id: infraction.id, dmSent, dmError });
  });

  app.post('/api/game/logs', (req, res) => {
    const secret = process.env.GAME_LOG_WEBHOOK_SECRET;
    const header = req.headers['x-erlcarmy-webhook'];

    if (!secret || header !== secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const payload = req.body;
    const { type, player, serverId, reason, command, target } = payload;

    const ops = loadOperations();
    ops.gameLogs = ops.gameLogs || [];

    ops.gameLogs.push({
      id: `log-${Date.now()}`,
      type,
      player,
      target: target || null,
      serverId,
      reason: reason || null,
      command: command || null,
      createdAt: new Date().toISOString(),
    });

    saveOperations(ops);
    res.json({ ok: true });
  });

  app.get('/api/erlc/server', requireManagement, async (req, res) => {
    try {
      const data = await fetchErlcServer({
        players: req.query.players === 'true',
        staff: req.query.staff === 'true',
        killLogs: req.query.killLogs === 'true',
        commandLogs: req.query.commandLogs === 'true',
        joinLogs: req.query.joinLogs === 'true',
        queue: req.query.queue === 'true',
        modCalls: req.query.modCalls === 'true',
        emergencyCalls: req.query.emergencyCalls === 'true',
        vehicles: req.query.vehicles === 'true',
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/erlc/command', requireManagement, async (req, res) => {
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    try {
      const data = await runErlcCommand(command);
      res.json(data);
    } catch (err) {
      res.status(err.response?.status || 500).json({ error: err.message });
    }
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
    console.log(`ERLC API configured: ${ERLC_SERVER_KEY ? 'yes' : 'mock mode (no key set)'}`);
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
  loadOperations,
  saveOperations,
  isManagementUser,
  findDiscordUserByUsername,
  dmUserInfraction,
  fetchErlcServer,
  runErlcCommand,
  isErlcMockMode,
};
