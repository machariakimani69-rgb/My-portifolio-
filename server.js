const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Readable } = require('node:stream');
const { promisify } = require('node:util');
const bcrypt = require('bcryptjs');
const { del: deleteBlob, get: getBlob, put: putBlob } = require('@vercel/blob');
const { handleUpload } = require('@vercel/blob/client');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'portfolio.json');
const DRAFT_FILE = path.join(DATA_DIR, 'portfolio.draft.json');
const REVISIONS_DIR = path.join(DATA_DIR, 'portfolio-revisions');
const VISITOR_ACCOUNTS_FILE = path.join(DATA_DIR, 'visitor-accounts.json');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const SESSION_COOKIE = 'portfolio_admin';
const VISITOR_SESSION_COOKIE = 'portfolio_visitor';
const ANALYTICS_CONSENT_COOKIE = 'portfolio_analytics_consent';
const SESSION_DURATION = 30 * 60;
const ANALYTICS_CONSENT_DURATION = 365 * 24 * 60 * 60;
const ANALYTICS_RETENTION_DAYS = 365;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = 7 * 1024 * 1024;
const MAX_ADMIN_PASSWORD_BYTES = 72;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const ADMIN_RESET_TOKEN_DURATION_MS = 15 * 60 * 1000;
const VISITOR_RESET_TOKEN_DURATION_MS = 15 * 60 * 1000;
let analyticsPrunedAt = 0;
let applicationErrorCount = 0;
const derivePasswordHash = promisify(crypto.scrypt);
let database;

function loadLocalEnvironment() {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') return;
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;

  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}

loadLocalEnvironment();
database = require('./database.js');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD_HASH_ENV = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_RECOVERY_KEY = process.env.ADMIN_RECOVERY_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
const corsAllowedOrigins = new Set((process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.origin !== origin
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash) {
      throw new Error(`CORS_ALLOWED_ORIGINS must contain only exact HTTP(S) origins: ${origin}`);
    }
    return parsed.origin;
  }));

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const bcryptHashPattern = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const configuredAdminPassword = ADMIN_PASSWORD_HASH_ENV || ADMIN_PASSWORD;
const adminPasswordIsBcryptHash = typeof configuredAdminPassword === 'string'
  && bcryptHashPattern.test(configuredAdminPassword);
const adminPasswordLooksHashed = typeof configuredAdminPassword === 'string'
  && configuredAdminPassword.startsWith('$2');

if (ADMIN_PASSWORD && ADMIN_PASSWORD_HASH_ENV) {
  console.error('Set either ADMIN_PASSWORD or ADMIN_PASSWORD_HASH, not both.');
  process.exit(1);
}

if (!configuredAdminPassword || (adminPasswordLooksHashed && !adminPasswordIsBcryptHash)) {
  console.error('Set ADMIN_PASSWORD or a valid bcrypt ADMIN_PASSWORD_HASH in .env.');
  process.exit(1);
}

if (!adminPasswordIsBcryptHash
  && (configuredAdminPassword.length < 12
    || Buffer.byteLength(configuredAdminPassword, 'utf8') > MAX_ADMIN_PASSWORD_BYTES)) {
  console.error('Use an admin password with at least 12 characters and no more than 72 UTF-8 bytes.');
  process.exit(1);
}

let ADMIN_PASSWORD_HASH = adminPasswordIsBcryptHash
  ? configuredAdminPassword
  : bcrypt.hashSync(configuredAdminPassword, 12);

if (ADMIN_RECOVERY_KEY && Buffer.byteLength(ADMIN_RECOVERY_KEY, 'utf8') < 32) {
  console.error('ADMIN_RECOVERY_KEY must contain at least 32 UTF-8 bytes.');
  process.exit(1);
}

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Set SESSION_SECRET in .env; use at least 32 random characters.');
  process.exit(1);
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://unpkg.com; connect-src 'self' https://*.blob.vercel-storage.com https://*.private.blob.vercel-storage.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(isProduction ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}),
  };
}

function sendJson(response, statusCode, value, headers = {}) {
  if (statusCode >= 500) applicationErrorCount += 1;
  response.writeHead(statusCode, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function adminSessionKey(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

async function adminSessionFromRequest(request) {
  const cookies = (request.headers.cookie || '').split(';').map((entry) => entry.trim());
  const cookie = cookies.find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;

  const tokenHash = adminSessionKey(token);
  const session = await database.getAdminSession(tokenHash);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await database.deleteAdminSession(tokenHash);
    return null;
  }
  return { tokenHash, expiresAt: Date.parse(session.expiresAt) };
}

async function makeSessionCookie() {
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = adminSessionKey(token);
  await database.createAdminSession(tokenHash, now + SESSION_DURATION * 1000);
  const secureFlag = isProduction ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION}${secureFlag}`;
}

async function hasValidSession(request) {
  return Boolean(await adminSessionFromRequest(request));
}

async function clearAdminSession(request) {
  const session = await adminSessionFromRequest(request);
  if (session) await database.deleteAdminSession(session.tokenHash);
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isProduction ? '; Secure' : ''}`;
}

function readVisitorAccounts() {
  let contents;
  try {
    contents = fs.readFileSync(VISITOR_ACCOUNTS_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const data = JSON.parse(contents);
  if (!data || !Array.isArray(data.accounts)) throw new Error('Visitor account data is invalid.');
  if (!data.accounts.every((account) => account
    && typeof account.id === 'string'
    && typeof account.name === 'string'
    && typeof account.email === 'string'
    && typeof account.passwordSalt === 'string'
    && typeof account.passwordHash === 'string'
    && typeof account.createdAt === 'string'
    && typeof account.privacyAcknowledgedAt === 'string')) {
    throw new Error('Visitor account records are invalid.');
  }
  return data.accounts;
}

async function readVisitorAccountsFromStore() {
  const databaseAccounts = await database.listVisitorAccounts();
  if (databaseAccounts.length > 0) return databaseAccounts;

  const legacyAccounts = readVisitorAccounts();
  if (legacyAccounts.length > 0) {
    await database.replaceVisitorAccounts(legacyAccounts);
    return legacyAccounts;
  }
  return [];
}

async function writeVisitorAccountsToStore(accounts) {
  await database.replaceVisitorAccounts(accounts);
}

function visitorAccountSummary(account) {
  return { id: account.id, name: account.name, email: account.email, createdAt: account.createdAt };
}

async function visitorSessionFromRequest(request) {
  const cookies = (request.headers.cookie || '').split(';').map((entry) => entry.trim());
  const cookie = cookies.find((entry) => entry.startsWith(`${VISITOR_SESSION_COOKIE}=`));
  const token = cookie?.slice(VISITOR_SESSION_COOKIE.length + 1);
  if (!token) return null;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await database.getVisitorSession(tokenHash);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await database.deleteVisitorSession(tokenHash);
    return null;
  }

  const account = await database.getVisitorAccountById(session.accountId);
  return account ? { tokenHash, account } : null;
}

async function createVisitorSession(account) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await database.createVisitorSession(tokenHash, account.id, Date.now() + SESSION_DURATION * 1000);
  const secureFlag = isProduction ? '; Secure' : '';
  return `${VISITOR_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION}${secureFlag}`;
}

async function clearVisitorSession(request) {
  const session = await visitorSessionFromRequest(request);
  if (session) await database.deleteVisitorSession(session.tokenHash);
  return `${VISITOR_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isProduction ? '; Secure' : ''}`;
}

function getCookieValue(request, name) {
  const cookie = (request.headers.cookie || '').split(';').map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1) || '';
}

function analyticsVisitorHash(visitorId) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(visitorId).digest('hex');
}

function analyticsConsentCookie(visitorHash) {
  const expiresAt = Math.floor(Date.now() / 1000) + ANALYTICS_CONSENT_DURATION;
  const message = `${visitorHash}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(message).digest('base64url');
  return `${ANALYTICS_CONSENT_COOKIE}=${message}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ANALYTICS_CONSENT_DURATION}${isProduction ? '; Secure' : ''}`;
}

function analyticsConsentFromRequest(request) {
  const value = getCookieValue(request, ANALYTICS_CONSENT_COOKIE);
  const match = value.match(/^([a-f0-9]{64})\.(\d{10})\.([A-Za-z0-9_-]{43})$/);
  if (!match || Number(match[2]) <= Math.floor(Date.now() / 1000)) return null;
  const message = `${match[1]}.${match[2]}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(message).digest();
  const supplied = Buffer.from(match[3], 'base64url');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  return match[1];
}

function clearAnalyticsConsentCookie() {
  return `${ANALYTICS_CONSENT_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isProduction ? '; Secure' : ''}`;
}

function rateLimitKey(scope, identifier) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`${scope}:${identifier}`).digest('hex');
}

function adminResetTokenHash(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

function visitorResetTokenHash(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`visitor:${token}`).digest('hex');
}

function matchesAdminRecoveryKey(suppliedKey) {
  if (!ADMIN_RECOVERY_KEY || typeof suppliedKey !== 'string' || Buffer.byteLength(suppliedKey, 'utf8') > 256) {
    return false;
  }
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(ADMIN_RECOVERY_KEY).digest();
  const supplied = crypto.createHmac('sha256', SESSION_SECRET).update(suppliedKey).digest();
  return crypto.timingSafeEqual(supplied, expected);
}

async function consumeRateLimit(scope, identifier, limit, windowMs) {
  const bucket = await database.consumeRateLimit(rateLimitKey(scope, identifier), windowMs);
  return bucket.count <= limit;
}

async function allowAnalyticsRequest(address) {
  return consumeRateLimit('analytics', address, 60, 60 * 1000);
}

async function allowVisitorRegistrationAttempt(address) {
  return consumeRateLimit('visitor_registration', address, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
}

function clientAddress(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const realIp = request.headers['x-real-ip'];
  const address = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return address || (typeof realIp === 'string' ? realIp.trim() : '') || request.socket?.remoteAddress || 'unknown';
}

function requestHost(request) {
  const forwarded = request.headers['x-forwarded-host'];
  const forwardedHost = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return (forwardedHost || request.headers.host || '').toLowerCase();
}

function allowedCorsOrigin(request) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string') return null;
  try {
    const parsedOrigin = new URL(origin);
    return corsAllowedOrigins.has(parsedOrigin.origin) ? parsedOrigin.origin : null;
  } catch {
    return null;
  }
}

function hasSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    const referer = request.headers.referer;
    if (!referer) return false;
    try {
      const parsedReferer = new URL(referer);
      return parsedReferer.host.toLowerCase() === requestHost(request)
        || corsAllowedOrigins.has(parsedReferer.origin);
    } catch {
      return false;
    }
  }
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host.toLowerCase() === requestHost(request)
      || corsAllowedOrigins.has(parsedOrigin.origin);
  } catch {
    return false;
  }
}

function isValidApiBaseUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && url.pathname === '/';
  } catch {
    return false;
  }
}

function escapeJsString(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (request.body !== undefined) {
    const body = Buffer.isBuffer(request.body) ? request.body.toString('utf8')
      : typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
      return Promise.reject(new Error('Request body is too large.'));
    }
    try {
      return Promise.resolve(typeof request.body === 'object' && !Buffer.isBuffer(request.body)
        ? request.body
        : JSON.parse(body));
    } catch {
      return Promise.reject(new Error('Request body must be valid JSON.'));
    }
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function isSafeHref(value) {
  return typeof value === 'string' && /^(https:\/\/|mailto:|tel:|#)/i.test(value) && value.length <= 500;
}

function validatePortfolio(data) {
  const requiredText = ['name', 'tagline', 'intro', 'aboutHeading'];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!requiredText.every((key) => typeof data[key] === 'string' && data[key].length <= 1200)) return false;
  if (!Array.isArray(data.aboutParagraphs) || data.aboutParagraphs.length > 5) return false;
  if (!data.aboutParagraphs.every((item) => typeof item === 'string' && item.length <= 1200)) return false;
  if (!Array.isArray(data.skills) || data.skills.length > 30) return false;
  if (!data.skills.every((item) => typeof item === 'string' && item.length <= 80)) return false;
  if (!Array.isArray(data.focus) || data.focus.length > 12) return false;
  if (!data.focus.every((item) => item && typeof item.title === 'string' && item.title.length <= 120 && typeof item.description === 'string' && item.description.length <= 600 && /^[a-z0-9-]{1,40}$/i.test(item.icon))) return false;
  if (!Array.isArray(data.education) || data.education.length > 12) return false;
  if (!data.education.every((item) => item && ['period', 'title', 'description'].every((key) => typeof item[key] === 'string' && item[key].length <= 500))) return false;
  if (!Array.isArray(data.projects) || data.projects.length > 20) return false;
  if (!data.projects.every((item) => item && ['number', 'title', 'category', 'description'].every((key) => typeof item[key] === 'string' && item[key].length <= 800) && isSafeHref(item.url))) return false;
  if (!Array.isArray(data.contacts) || data.contacts.length > 12) return false;
  return data.contacts.every((item) => item && typeof item.label === 'string' && item.label.length <= 120 && isSafeHref(item.href) && /^[a-z0-9-]{1,40}$/i.test(item.icon) && typeof item.external === 'boolean');
}

function validateExtensions(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!Array.isArray(data.certificates) || data.certificates.length > 100) return false;
  if (!data.certificates.every((item) => item
    && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 160
    && typeof item.issuer === 'string' && item.issuer.length <= 160
    && typeof item.issuedAt === 'string' && item.issuedAt.length <= 80
    && typeof item.url === 'string' && item.url.length <= 500
    && (!item.url || /^https:\/\//i.test(item.url) || /^\/uploads\/[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/i.test(item.url)))) return false;
  if (!data.seo || typeof data.seo !== 'object' || Array.isArray(data.seo)) return false;
  if (!Object.entries(data.seo).every(([page, value]) => Object.hasOwn(publicPages, page)
    && value && typeof value.title === 'string' && value.title.length <= 160
    && typeof value.description === 'string' && value.description.length <= 320)) return false;
  return data.appearance
    && typeof data.appearance === 'object'
    && /^#[0-9a-f]{6}$/i.test(data.appearance.accentColor)
    && ['light', 'dark'].includes(data.appearance.defaultTheme);
}

async function readPortfolio() {
  const stored = await database.getPortfolioDocument('published');
  if (stored) return stored;
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

async function writePortfolio(data) {
  await database.savePortfolioDocument('published', data);
}

async function readPortfolioDraft() {
  return database.getPortfolioDocument('draft');
}

async function savePortfolioDraft(data) {
  await database.savePortfolioDocument('draft', data);
}

async function archivePortfolioRevision(data) {
  const id = `${Date.now().toString().padStart(13, '0')}-${crypto.randomUUID()}`;
  await database.savePortfolioRevision({
    id,
    createdAt: new Date().toISOString(),
    content: data,
  });
  return id;
}

async function listPortfolioRevisions() {
  return database.listPortfolioRevisions();
}

async function readPortfolioRevision(id) {
  if (typeof id !== 'string' || !/^\d{13}-[0-9a-f-]{36}$/i.test(id)) return null;
  return database.getPortfolioRevision(id);
}

async function readAnalytics() {
  const analyticsFile = path.join(DATA_DIR, 'analytics.json');
  const stored = await database.getLegacyAnalytics();
  let data = stored;
  if (!data && !database.isRemoteDatabase) {
    try {
      data = JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
      await database.saveLegacyAnalytics(data);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  if (!data) data = {};
  const dailyViews = data.dailyViews && typeof data.dailyViews === 'object' ? data.dailyViews : {};
  const retentionCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  for (const day of Object.keys(dailyViews)) {
    const timestamp = Date.parse(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(timestamp) || timestamp < retentionCutoff) {
      delete dailyViews[day];
    }
  }
  return {
    pageViews: data.pageViews && typeof data.pageViews === 'object' ? data.pageViews : {},
    skillInterests: data.skillInterests && typeof data.skillInterests === 'object' ? data.skillInterests : {},
    followClicks: data.followClicks && typeof data.followClicks === 'object' ? data.followClicks : {},
    engagement: data.engagement && typeof data.engagement === 'object' ? data.engagement : {},
    dailyViews,
    likes: Number.isSafeInteger(data.likes) && data.likes >= 0 ? data.likes : 0,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
  };
}

async function writeAnalytics(data) {
  data.updatedAt = new Date().toISOString();
  await database.saveLegacyAnalytics(data);
}

const publicPages = {
  'index.html': 'Home',
  'about.html': 'About',
  'skills.html': 'Skills',
  'education.html': 'Education',
  'projects.html': 'Projects',
  'athletics.html': 'Athletics',
  'coding.html': 'Coding',
  'academic-record.html': 'Academic Record',
  'professional-focus.html': 'Professional Focus',
  'contact.html': 'Contact',
};

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function analyticsPeriod(requestUrl) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayText = today.toISOString().slice(0, 10);
  const mode = requestUrl.searchParams.get('range') || 'last30';
  let first = new Date(today);
  let last = new Date(today);

  if (mode === 'yesterday') {
    first.setUTCDate(first.getUTCDate() - 1);
    last = new Date(first);
  } else if (mode === 'last7') {
    first.setUTCDate(first.getUTCDate() - 6);
  } else if (mode === 'last30') {
    first.setUTCDate(first.getUTCDate() - 29);
  } else if (mode === 'last90') {
    first.setUTCDate(first.getUTCDate() - 89);
  } else if (mode === 'thisYear') {
    first = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  } else if (mode === 'custom') {
    first = dateOnly(requestUrl.searchParams.get('from'));
    last = dateOnly(requestUrl.searchParams.get('to'));
    if (!first || !last || first > last) throw new Error('Choose a valid custom date range.');
    if (last > today) throw new Error('Custom date ranges cannot include future dates.');
    if (last.getTime() - first.getTime() > 365 * 24 * 60 * 60 * 1000) {
      throw new Error('Custom date ranges cannot exceed one year.');
    }
  } else if (mode !== 'today') {
    throw new Error('Choose a supported analytics date range.');
  }

  const until = new Date(last);
  until.setUTCDate(until.getUTCDate() + 1);
  return {
    range: mode,
    fromDate: first.toISOString().slice(0, 10),
    toDate: last.toISOString().slice(0, 10),
    from: first.toISOString(),
    until: until.toISOString(),
  };
}

function analyticsDevice(userAgent = '') {
  const value = userAgent.toLowerCase();
  const deviceCategory = /ipad|tablet|kindle|silk/.test(value)
    ? 'Tablet'
    : /mobile|iphone|ipod|android/.test(value) ? 'Mobile' : 'Desktop';
  let browser = 'Other';
  if (/edg\//.test(value)) browser = 'Edge';
  else if (/firefox\//.test(value)) browser = 'Firefox';
  else if (/chrome\//.test(value) && !/edg\//.test(value)) browser = 'Chrome';
  else if (/safari\//.test(value) && !/chrome\//.test(value)) browser = 'Safari';
  let operatingSystem = 'Other';
  if (/windows/.test(value)) operatingSystem = 'Windows';
  else if (/android/.test(value)) operatingSystem = 'Android';
  else if (/iphone|ipad|ios/.test(value)) operatingSystem = 'iOS';
  else if (/mac os|macintosh/.test(value)) operatingSystem = 'macOS';
  else if (/linux/.test(value)) operatingSystem = 'Linux';
  return { deviceCategory, browser, operatingSystem };
}

function analyticsReferrer(request) {
  try {
    const referrer = new URL(request.headers.referer);
    if (referrer.host.toLowerCase() === (request.headers.host || '').toLowerCase()) {
      return { sourceCategory: 'Direct', sourceHost: null };
    }
    const sourceHost = referrer.hostname.toLowerCase().replace(/^www\./, '').slice(0, 255);
    if (/(^|\.)((google|bing|yahoo|duckduckgo|baidu)\.)/.test(sourceHost)) {
      return { sourceCategory: 'Search', sourceHost };
    }
    if (/(^|\.)((facebook|instagram|linkedin|x|twitter|tiktok|reddit|github)\.)/.test(sourceHost)) {
      return { sourceCategory: 'Social', sourceHost };
    }
    return { sourceCategory: 'Referral', sourceHost };
  } catch {
    return { sourceCategory: 'Direct', sourceHost: null };
  }
}

async function analyticsSnapshot(period) {
  const snapshot = await database.getAnalyticsSnapshot(period);
  const legacy = await readAnalytics();
  const legacySummary = analyticsSummary(legacy);
  const oldDaily = new Map(Object.entries(legacy.dailyViews));
  snapshot.daily = snapshot.daily.map((day) => ({
    ...day,
    pageViews: day.pageViews + (Number.isSafeInteger(oldDaily.get(day.day)) ? oldDaily.get(day.day) : 0),
  }));
  snapshot.totals.pageViews += snapshot.daily.reduce((sum, day) => (
    sum + (Number.isSafeInteger(oldDaily.get(day.day)) ? oldDaily.get(day.day) : 0)
  ), 0);
  snapshot.legacy = {
    totalPageViews: legacySummary.totalPageViews,
    pages: legacySummary.pages,
    skills: legacySummary.skills,
    follows: legacySummary.follows,
    engagement: legacySummary.engagement,
    likes: legacySummary.likes,
  };
  const adminSummary = await database.getAdminDashboardSummary();
  snapshot.activity = [
    ...snapshot.activity,
    ...adminSummary.activity.map((entry) => ({
      eventType: entry.action,
      pagePath: '',
      eventLabel: null,
      createdAt: entry.createdAt,
    })),
  ].sort((first, second) => second.createdAt.localeCompare(first.createdAt)).slice(0, 50);
  snapshot.period = { range: period.range, from: period.fromDate, to: period.toDate };
  snapshot.updatedAt = new Date().toISOString();
  return snapshot;
}

function analyticsSummary(data) {
  const toEntries = (values, labels = {}) => Object.entries(values)
    .filter(([key, count]) => typeof key === 'string' && Number.isSafeInteger(count) && count > 0)
    .map(([key, count]) => ({ key, label: labels[key] || key, count }))
    .sort((first, second) => second.count - first.count);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dailyViews = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (13 - index));
    const day = date.toISOString().slice(0, 10);
    return { day, count: Number.isSafeInteger(data.dailyViews[day]) ? data.dailyViews[day] : 0 };
  });
  return {
    likes: data.likes,
    totalPageViews: Object.values(data.pageViews).reduce((sum, count) => sum + (Number.isSafeInteger(count) ? count : 0), 0),
    pages: toEntries(data.pageViews, publicPages),
    skills: toEntries(data.skillInterests),
    follows: toEntries(data.followClicks),
    engagement: toEntries(data.engagement, { project: 'Project links', share: 'Page shares', contact: 'Contact actions' }),
    dailyViews,
    updatedAt: data.updatedAt,
  };
}

async function adminDashboardSnapshot() {
  const startedAt = process.hrtime.bigint();
  const now = Date.now();
  const [databaseSummary, legacyData, recentAnalytics, databaseBytes, adminSessionCount, portfolio, draft] = await Promise.all([
    database.getAdminDashboardSummary(),
    readAnalytics(),
    database.getAnalyticsSnapshot({
      from: new Date(now - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      until: new Date(now + 1).toISOString(),
    }),
    database.getDatabaseStorageBytes(),
    database.getAdminSessionCount(),
    readPortfolio(),
    readPortfolioDraft(),
  ]);
  const legacyAnalytics = analyticsSummary(legacyData);
  const contentBytes = Buffer.byteLength(JSON.stringify(portfolio))
    + (draft ? Buffer.byteLength(JSON.stringify(draft)) : 0);

  return {
    statistics: {
      optInPageViews: legacyAnalytics.totalPageViews + recentAnalytics.totals.pageViews,
      profileLikes: legacyAnalytics.likes,
      registeredAccounts: databaseSummary.registeredAccounts,
      projects: portfolio.projects.length,
    },
    system: {
      server: { status: 'online', uptimeSeconds: Math.floor(process.uptime()), nodeVersion: process.version },
      database: { status: databaseSummary.databaseIntegrity, storageBytes: databaseBytes },
      content: { status: 'available', storageBytes: contentBytes },
      api: {
        status: databaseSummary.databaseIntegrity === 'ok' ? 'ok' : 'error',
        responseTimeMs: Number((process.hrtime.bigint() - startedAt) / 1000000n),
        applicationErrors: applicationErrorCount,
      },
    },
    security: {
      activeSessions: adminSessionCount,
      passwordUpdatedAt: databaseSummary.passwordUpdatedAt,
      failedLoginAttempts: recentAnalytics.totals.failedAdminLogins,
      suspiciousRequests: recentAnalytics.totals.suspiciousRequests,
    },
    recentActivity: databaseSummary.activity,
    measurementNote: 'Detailed session and engagement records are collected only after analytics consent. Visitor identifiers are random pseudonyms; account IDs, IP addresses, exact locations, and full referrer URLs are not stored. Detailed analytics are retained for 365 days.',
  };
}

async function isRateLimited(scope, address) {
  return !await consumeRateLimit(scope, address, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
}

async function allowCommunityAction(visitorId) {
  return consumeRateLimit('community', visitorId, 20, LOGIN_WINDOW_MS);
}

function validateContactMessage(payload, account, requireName) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'Contact details must be sent as a JSON object.' };
  }
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if ((requireName && (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)))
    || (!requireName && name && (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)))) {
    return { error: 'Enter a name between 2 and 100 characters.' };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Enter a valid reply email address.' };
  }
  if (message.length < 2 || message.length > 5000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) {
    return { error: 'Enter a message of 2–5000 characters.' };
  }
  return {
    message: {
      id: crypto.randomUUID(),
      visitorId: account.id,
      displayName: name || account.name,
      email,
      message,
      createdAt: new Date().toISOString(),
    },
  };
}

function analyticsExportRows(report) {
  const rows = [
    ['Section', 'Metric', 'Value'],
    ['Report', 'From', report.period.from],
    ['Report', 'To', report.period.to],
    ...Object.entries(report.totals).map(([key, value]) => ['Totals', key, value]),
  ];
  report.pages.forEach((row) => rows.push(['Pages', row.label, row.count]));
  report.popularProjects.forEach((row) => rows.push(['Projects', row.label, row.count]));
  report.popularSections.forEach((row) => rows.push(['Sections', row.label, row.count]));
  report.landingPages.forEach((row) => rows.push(['Landing pages', row.key, row.count]));
  report.exitPages.forEach((row) => rows.push(['Exit pages', row.key, row.count]));
  report.engagement.forEach((row) => rows.push(['Engagement', row.eventType, row.count]));
  report.devices.forEach((row) => rows.push(['Devices', row.key, row.count]));
  report.sources.forEach((row) => rows.push(['Sources', `${row.category}: ${row.key}`, row.count]));
  report.browsers.forEach((row) => rows.push(['Browsers', row.key, row.count]));
  report.operatingSystems.forEach((row) => rows.push(['Operating systems', row.key, row.count]));
  report.legacy.pages.forEach((row) => rows.push(['Legacy aggregate pages (date unavailable)', row.label, row.count]));
  report.legacy.skills.forEach((row) => rows.push(['Legacy aggregate skills (date unavailable)', row.label, row.count]));
  report.legacy.follows.forEach((row) => rows.push(['Legacy aggregate follows (date unavailable)', row.label, row.count]));
  report.legacy.engagement.forEach((row) => rows.push(['Legacy aggregate engagement (date unavailable)', row.label, row.count]));
  report.daily.forEach((row) => rows.push(['Daily', row.day, `visits=${row.visits}; pageViews=${row.pageViews}`]));
  report.rankings.forEach((row, index) => rows.push([
    'Engagement ranking',
    `Visitor ${index + 1} (${row.authenticated ? 'authenticated' : 'anonymous'})`,
    `score=${row.score}; visits=${row.visits}; pageViews=${row.pageViews}; durationSeconds=${row.durationSeconds}; projectClicks=${row.projectClicks}`,
  ]));
  report.activity.forEach((row) => rows.push([
    'Recent activity',
    row.eventType,
    `${row.createdAt} ${row.eventLabel || row.pagePath || ''}`.trim(),
  ]));
  return rows;
}

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function createAnalyticsPdf(report) {
  const text = [
    'Website Analytics Report',
    `Period: ${report.period.from} to ${report.period.to}`,
    '',
    ...Object.entries(report.totals).map(([key, value]) => `${key}: ${value}`),
    '',
    'Most visited pages',
    ...report.pages.map((row) => `${row.label}: ${row.count}`),
    '',
    'Landing pages',
    ...report.landingPages.map((row) => `${row.key}: ${row.count}`),
    '',
    'Exit pages',
    ...report.exitPages.map((row) => `${row.key}: ${row.count}`),
    '',
    'Popular projects',
    ...report.popularProjects.map((row) => `${row.label}: ${row.count}`),
    '',
    'Popular portfolio sections',
    ...report.popularSections.map((row) => `${row.label}: ${row.count}`),
    '',
    'Devices',
    ...report.devices.map((row) => `${row.key}: ${row.count}`),
    '',
    'Browsers',
    ...report.browsers.map((row) => `${row.key}: ${row.count}`),
    '',
    'Operating systems',
    ...report.operatingSystems.map((row) => `${row.key}: ${row.count}`),
    '',
    'Engagement actions',
    ...report.engagement.map((row) => `${row.eventType}: ${row.count}`),
    '',
    'Traffic sources',
    ...report.sources.map((row) => `${row.category} - ${row.key}: ${row.count}`),
    '',
    'Legacy aggregate activity (dates unavailable)',
    `Legacy page views: ${report.legacy.totalPageViews}`,
    ...report.legacy.pages.map((row) => `Page ${row.label}: ${row.count}`),
    ...report.legacy.skills.map((row) => `Skill ${row.label}: ${row.count}`),
    ...report.legacy.follows.map((row) => `Follow ${row.label}: ${row.count}`),
    '',
    'Daily visits and page views',
    ...report.daily.map((row) => `${row.day}: ${row.visits} visits, ${row.pageViews} page views`),
    '',
    'Engagement ranking (pseudonymous; no visitor identity is included)',
    ...report.rankings.map((row, index) => (
      `Visitor ${index + 1} (${row.authenticated ? 'authenticated' : 'anonymous'}): score ${row.score}, ${row.visits} visits, ${row.pageViews} pages, ${row.projectClicks} project clicks`
    )),
    '',
    'Recent activity (no visitor identities)',
    ...report.activity.slice(0, 30).map((row) => `${row.createdAt} ${row.eventType} ${row.eventLabel || row.pagePath || ''}`),
    '',
    'Privacy: analytics are opt-in. No account IDs, IP addresses, or exact locations are included.',
  ].map((line) => line.replace(/[^\x20-\x7E]/g, '?'));
  const pages = [];
  for (let index = 0; index < text.length; index += 48) pages.push(text.slice(index, index + 48));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((lines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const commands = [
      'BT',
      '/F1 10 Tf',
      '50 790 Td',
      '14 TL',
      ...lines.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`),
      'ET',
    ].join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(commands, 'ascii')} >>\nstream\n${commands}\nendstream`);
  });
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, 'ascii'));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document, 'ascii');
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function detectUploadType(buffer) {
  const signatures = [
    { type: 'image/jpeg', extension: 'jpg', matches: () => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9 },
    { type: 'image/png', extension: 'png', matches: () => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { type: 'image/webp', extension: 'webp', matches: () => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
    { type: 'application/pdf', extension: 'pdf', matches: () => buffer.toString('ascii', 0, 5) === '%PDF-' },
  ];
  return signatures.find((signature) => signature.matches()) || null;
}

function safeOriginalName(value) {
  if (typeof value !== 'string') return '';
  return path.basename(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160);
}

async function serveStatic(request, response, pathname, search = '') {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(response, 400, { error: 'Invalid path.' });
  }

  const isChartLibrary = decodedPath === '/vendor/chart.js';
  const isBlobClient = decodedPath === '/blob-upload.js';
  if (isBlobClient && !process.env.BLOB_READ_WRITE_TOKEN) {
    response.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return response.end();
  }
  if (decodedPath === '/portfolio-api-config.js') {
    const apiBaseUrl = process.env.PORTFOLIO_API_BASE_URL;
    if (!apiBaseUrl || !isValidApiBaseUrl(apiBaseUrl)) {
      if (!apiBaseUrl) {
        console.warn('PORTFOLIO_API_BASE_URL is not set; serving static portfolio-api-config.js with empty base URL.');
      } else {
        console.warn(`PORTFOLIO_API_BASE_URL is invalid: ${apiBaseUrl}; serving static portfolio-api-config.js with empty base URL.`);
      }
    } else {
      response.writeHead(200, {
        ...securityHeaders(),
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return response.end(`window.PORTFOLIO_API_BASE_URL = '${escapeJsString(apiBaseUrl.trim())}';`);
    }
  }
  const relativePath = isChartLibrary
    ? path.join('node_modules', 'chart.js', 'dist', 'chart.umd.js')
    : isBlobClient ? path.join('dist', 'blob-upload.js')
    : decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) return sendJson(response, 404, { error: 'Not found.' });
  if (!isChartLibrary && /(^|[\\/])node_modules([\\/]|$)/i.test(relativePath)) {
    return sendJson(response, 404, { error: 'Not found.' });
  }
  if (/(^|[\\/])\.|(?:^|[\\/])(server\.js|package\.json|README\.md)(?:$|[\\/])/i.test(relativePath)) {
    return sendJson(response, 404, { error: 'Not found.' });
  }
  const canonicalRelativePath = path.relative(ROOT, filePath).split(path.sep).join('/');
  const isUploadPath = /^uploads\//i.test(canonicalRelativePath);
  if (isUploadPath
    && !/^uploads\/[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/i.test(canonicalRelativePath)) {
    return sendJson(response, 404, { error: 'Not found.' });
  }
  if (isUploadPath) {
    const session = await visitorSessionFromRequest(request);
    if (!session) {
      const destination = `${pathname}${search}`;
      response.writeHead(302, {
        ...securityHeaders(),
        Location: `/account.html?next=${encodeURIComponent(destination)}`,
        'Cache-Control': 'no-store',
      });
      return response.end();
    }
  }
  if (Object.hasOwn(publicPages, canonicalRelativePath)) {
    const session = await visitorSessionFromRequest(request);
    if (!session) {
      const destination = `${pathname}${search}`;
      response.writeHead(302, {
        ...securityHeaders(),
        Location: `/account.html?next=${encodeURIComponent(destination)}`,
        'Cache-Control': 'no-store',
      });
      return response.end();
    }
  }

  const contentType = contentTypes[path.extname(filePath).toLowerCase()];
  if (!contentType) return sendJson(response, 404, { error: 'Not found.' });

  try {
    if (isUploadPath) {
      const uploadId = path.basename(canonicalRelativePath).split('.')[0];
      const upload = await database.getPortfolioUpload(uploadId);
      if (!upload) return sendJson(response, 404, { error: 'Not found.' });
      const expectedExtension = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'application/pdf': '.pdf',
      }[upload.contentType];
      if (path.extname(canonicalRelativePath).toLowerCase() !== expectedExtension) {
        return sendJson(response, 404, { error: 'Not found.' });
      }
      if (upload.blobPath) {
        let result;
        try {
          result = await getBlob(upload.blobPath, { access: 'private' });
        } catch (error) {
          console.error('Private upload could not be retrieved:', error);
          return sendJson(response, 500, { error: 'The file could not be retrieved.' });
        }
        if (!result || result.statusCode !== 200) return sendJson(response, 404, { error: 'Not found.' });
        response.writeHead(200, {
          ...securityHeaders(),
          'Content-Type': upload.contentType,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
          ...(upload.contentType === 'application/pdf' ? { 'Content-Disposition': 'attachment' } : {}),
        });
        if (request.method === 'HEAD') return response.end();
        Readable.fromWeb(result.stream).pipe(response);
        return;
      }
      if (database.isRemoteDatabase) return sendJson(response, 404, { error: 'Not found.' });
    }
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) return sendJson(response, 404, { error: 'Not found.' });
    response.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': contentType,
      'Cache-Control': ['.html', '.js'].includes(path.extname(filePath).toLowerCase())
        || isUploadPath
        ? 'private, no-store'
        : 'public, max-age=300',
      ...(isUploadPath && path.extname(filePath) === '.pdf'
        ? { 'Content-Disposition': 'attachment' }
        : {}),
    });
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
  }
}

async function handlePrivateBlobUpload(request, response) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return sendJson(response, 503, { error: 'Persistent upload storage is not configured.' });
  }
  try {
    const body = await readJson(request);
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        if (!hasSameOrigin(request) || !await hasValidSession(request)) {
          throw new Error('Administrator authentication is required.');
        }
        let clientDetails;
        try {
          clientDetails = JSON.parse(clientPayload || '{}');
        } catch {
          throw new Error('Upload details are invalid.');
        }
        const originalName = safeOriginalName(clientDetails.fileName);
        if (!originalName) throw new Error('A file name is required.');
        return {
          access: 'private',
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ id: crypto.randomUUID(), originalName }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const metadata = JSON.parse(tokenPayload);
        const stored = await getBlob(blob.pathname, { access: 'private' });
        if (!stored || stored.statusCode !== 200) {
          throw new Error('The uploaded file could not be verified.');
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of Readable.fromWeb(stored.stream)) {
          size += chunk.length;
          if (size > MAX_UPLOAD_BYTES) throw new Error('Choose a file up to 5 MB.');
          chunks.push(chunk);
        }
        const detected = detectUploadType(Buffer.concat(chunks));
        if (!detected || detected.type !== blob.contentType) {
          await deleteBlob(blob.pathname);
          throw new Error('Only valid JPEG, PNG, WebP, or PDF files can be uploaded.');
        }
        await database.addPortfolioUpload({
          id: metadata.id,
          originalName: safeOriginalName(metadata.originalName),
          contentType: detected.type,
          fileSize: size,
          uploadedAt: new Date().toISOString(),
          blobPath: blob.pathname,
        });
      },
    });
    return sendJson(response, 200, result);
  } catch (error) {
    if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
      return sendJson(response, 400, { error: error.message });
    }
    console.error('Persistent portfolio upload failed:', error);
    return sendJson(response, 400, { error: 'The file could not be uploaded.' });
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || '/', 'http://localhost');
  const pathname = requestUrl.pathname;

  if (pathname.startsWith('/api/')) {
    const origin = allowedCorsOrigin(request);
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      const requestedMethod = request.headers['access-control-request-method'];
      const requestedHeaders = (request.headers['access-control-request-headers'] || '')
        .split(',')
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      const allowedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'];
      const allowedHeaders = new Set(['accept', 'content-type']);
      if (!origin
        || !allowedMethods.includes(requestedMethod)
        || requestedHeaders.some((header) => !allowedHeaders.has(header))) {
        return sendJson(response, 403, { error: 'Request origin or preflight headers are not allowed.' });
      }
      response.writeHead(204, {
        ...securityHeaders(),
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': `${allowedMethods.join(', ')}, OPTIONS`,
        'Access-Control-Allow-Headers': 'Accept, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      });
      return response.end();
    }
  }

  if (request.method === 'GET' && pathname === '/api/health') {
    const startedAt = Date.now();
    try {
      await database.getAdminPasswordHash();
      return sendJson(response, 200, {
        status: 'ok',
        database: {
          status: 'ok',
          provider: database.isRemoteDatabase ? 'turso-libsql' : 'sqlite',
        },
        responseTimeMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.error('Health check could not reach the database:', error);
      return sendJson(response, 503, {
        status: 'error',
        database: { status: 'error' },
        responseTimeMs: Date.now() - startedAt,
      });
    }
  }

  if (request.method === 'GET' && pathname === '/api/portfolio') {
    const session = await visitorSessionFromRequest(request);
    if (!session) {
      return sendJson(response, 401, { error: 'Sign in with a visitor account to access portfolio content.' });
    }
    try {
      return sendJson(response, 200, await readPortfolio());
    } catch {
      return sendJson(response, 500, { error: 'Portfolio content is unavailable.' });
    }
  }

  if (request.method === 'GET' && pathname === '/api/site') {
    const session = await visitorSessionFromRequest(request);
    if (!session) return sendJson(response, 401, { error: 'Sign in with a visitor account to access portfolio content.' });
    try {
      const pageKey = requestUrl.searchParams.get('page');
      const extensions = await database.getPortfolioExtensions();
      const [comments, follows] = await Promise.all([
        Object.hasOwn(publicPages, pageKey) ? database.listApprovedComments(pageKey) : [],
        database.getPortfolioFollowSummary(session.account.id),
      ]);
      return sendJson(response, 200, {
        certificates: extensions.certificates,
        seo: extensions.seo[pageKey] || null,
        appearance: extensions.appearance,
        comments,
        follows,
        account: visitorAccountSummary(session.account),
      });
    } catch (error) {
      console.error('Public portfolio extensions could not be loaded:', error);
      return sendJson(response, 500, { error: 'Portfolio extensions are unavailable.' });
    }
  }

  if (pathname.startsWith('/api/community/')) {
    if (request.method !== 'POST' || !hasSameOrigin(request)) {
      return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    }
    const session = await visitorSessionFromRequest(request);
    if (!session) return sendJson(response, 401, { error: 'Sign in with a visitor account to continue.' });
    if (!['/api/community/follow', '/api/community/comment', '/api/community/contact'].includes(pathname)) {
      return sendJson(response, 404, { error: 'Not found.' });
    }
    if (!await allowCommunityAction(session.account.id)) {
      return sendJson(response, 429, { error: 'Too many community actions. Please try again later.' });
    }
    try {
      const payload = await readJson(request);
      if (pathname === '/api/community/follow') {
        if (typeof payload?.following !== 'boolean') {
          return sendJson(response, 400, { error: 'Choose whether to follow this portfolio.' });
        }
        await database.togglePortfolioFollow(session.account.id, payload.following);
        const summary = await database.getPortfolioFollowSummary(session.account.id);
        return sendJson(response, 200, summary);
      }

      if (pathname === '/api/community/comment') {
        const pageKey = typeof payload?.pageKey === 'string' ? payload.pageKey : '';
        const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
        if (!['projects.html', 'contact.html'].includes(pageKey) || message.length < 2 || message.length > 1000) {
          return sendJson(response, 400, { error: 'Choose a portfolio page and enter a comment of 2–1000 characters.' });
        }
        await database.addComment({
          id: crypto.randomUUID(),
          visitorId: session.account.id,
          displayName: session.account.name,
          pageKey,
          message,
          createdAt: new Date().toISOString(),
        });
        return sendJson(response, 201, { submitted: true, moderated: true });
      }

      if (pathname === '/api/community/contact') {
        const submission = validateContactMessage({
          email: typeof payload?.email === 'string' ? payload.email.trim() : session.account.email,
          message: payload?.message,
        }, session.account, false);
        if (submission.error) return sendJson(response, 400, { error: submission.error });
        await database.addContactMessage(submission.message);
        return sendJson(response, 201, { submitted: true, delivery: 'local-inbox' });
      }
    } catch (error) {
      if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
        return sendJson(response, 400, { error: error.message });
      }
      console.error('Community request failed:', error);
      return sendJson(response, 500, { error: 'The request could not be completed.' });
    }
    return sendJson(response, 404, { error: 'Not found.' });
  }

  if (pathname === '/api/contact') {
    if (request.method !== 'POST') {
      return sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
    }
    if (!hasSameOrigin(request)) return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    try {
      const session = await visitorSessionFromRequest(request);
      if (!session) return sendJson(response, 401, { error: 'Sign in with a visitor account to send a message.' });
      if (!await allowCommunityAction(session.account.id)) {
        return sendJson(response, 429, { error: 'Too many community actions. Please try again later.' });
      }
      const payload = await readJson(request);
      const submission = validateContactMessage(payload, session.account, true);
      if (submission.error) return sendJson(response, 400, { error: submission.error });
      await database.addContactMessage(submission.message);
      return sendJson(response, 201, { submitted: true, delivery: 'local-inbox' });
    } catch (error) {
      if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
        return sendJson(response, 400, { error: error.message });
      }
      console.error('Contact request failed:', error);
      return sendJson(response, 500, { error: 'The contact request could not be completed.' });
    }
  }

  if (pathname.startsWith('/api/analytics/')) {
    if (request.method === 'GET' && pathname === '/api/analytics/like-count') {
      return sendJson(response, 200, { likes: (await readAnalytics()).likes });
    }

    if (request.method === 'GET' && pathname === '/api/analytics/live-visitors') {
      if (!await allowAnalyticsRequest(clientAddress(request))) {
        return sendJson(response, 429, { error: 'Analytics request limit reached. Try again shortly.' });
      }
      try {
        return sendJson(response, 200, {
          activeVisitors: await database.getActiveAnalyticsSessionCount(),
        });
      } catch (error) {
        console.error('Live visitor count could not be loaded:', error);
        return sendJson(response, 500, { error: 'Live visitor count is unavailable.' });
      }
    }

    if (request.method !== 'POST' || !hasSameOrigin(request)) {
      return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    }
    if (!await allowAnalyticsRequest(clientAddress(request))) {
      return sendJson(response, 429, { error: 'Analytics event limit reached. Try again shortly.' });
    }

    try {
      const payload = await readJson(request);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return sendJson(response, 400, { error: 'Analytics details must be sent as a JSON object.' });
      }

      if (pathname === '/api/analytics/consent') {
        if (typeof payload.visitorId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.visitorId)) {
          return sendJson(response, 400, { error: 'A valid anonymous browser identifier is required.' });
        }
        return sendJson(response, 200, { consented: true }, {
          'Set-Cookie': analyticsConsentCookie(analyticsVisitorHash(payload.visitorId)),
        });
      }

      if (pathname === '/api/analytics/consent/revoke') {
        const visitorHash = analyticsConsentFromRequest(request);
        if (visitorHash) await database.revokeAnalyticsVisitor(visitorHash);
        return sendJson(response, 200, { consented: false, deleted: Boolean(visitorHash) }, {
          'Set-Cookie': clearAnalyticsConsentCookie(),
        });
      }

      if (pathname === '/api/analytics/event') {
        const visitorHash = analyticsConsentFromRequest(request);
        if (!visitorHash) return sendJson(response, 403, { error: 'Analytics consent is required.' });
        const eventTypes = new Set([
          'page_view',
          'skill_interest',
          'follow_click',
          'project_click',
          'share',
          'contact_click',
          'cv_download',
          'github_click',
          'linkedin_click',
          'whatsapp_click',
          'certificate_view',
          'contact_submission',
          'section_view',
          'vcard_download',
          'session_heartbeat',
          'session_end',
        ]);
        if (!eventTypes.has(payload.eventType)
          || typeof payload.sessionId !== 'string'
          || !/^[0-9a-f-]{36}$/i.test(payload.sessionId)
          || typeof payload.pagePath !== 'string'
          || !Object.hasOwn(publicPages, payload.pagePath)) {
          return sendJson(response, 400, { error: 'Analytics event details are invalid.' });
        }

        const label = typeof payload.label === 'string' ? payload.label.trim() : '';
        if (label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) {
          return sendJson(response, 400, { error: 'Analytics event label is invalid.' });
        }
        const labelTypes = new Set(['skill_interest', 'follow_click', 'project_click', 'certificate_view', 'section_view']);
        if (label && !labelTypes.has(payload.eventType)) {
          return sendJson(response, 400, { error: 'This analytics event cannot include a label.' });
        }
        if (payload.eventType === 'skill_interest') {
          const portfolio = await readPortfolio();
          if (!label || !portfolio.skills.some((skill) => skill.toLowerCase() === label.toLowerCase())) {
            return sendJson(response, 400, { error: 'Unknown skill.' });
          }
        }
        if (payload.eventType === 'project_click') {
          const portfolio = await readPortfolio();
          if (!label || !portfolio.projects.some((project) => project.title === label)) {
            return sendJson(response, 400, { error: 'Unknown project.' });
          }
        }
        if (payload.eventType === 'follow_click' && !['LinkedIn', 'GitHub'].includes(label)) {
          return sendJson(response, 400, { error: 'Unknown social link.' });
        }
        if (payload.eventType === 'certificate_view') {
          const extensions = await database.getPortfolioExtensions();
          if (!label || !extensions.certificates.some((certificate) => certificate.title === label)) {
            return sendJson(response, 400, { error: 'Unknown certificate.' });
          }
        }
        if (payload.eventType === 'section_view'
          && (!label || /@|https?:\/\/|wa\.me|[0-9]{5,}/i.test(label))) {
          return sendJson(response, 400, { error: 'Section labels must be public, non-identifying headings.' });
        }
        if (['session_heartbeat', 'session_end'].includes(payload.eventType) && label) {
          return sendJson(response, 400, { error: 'Session activity cannot include a label.' });
        }

        const source = analyticsReferrer(request);
        const device = analyticsDevice(request.headers['user-agent']);
        const visitor = await visitorSessionFromRequest(request);
        const event = {
          visitorHash,
          sessionId: payload.sessionId,
          eventType: payload.eventType,
          pagePath: payload.pagePath,
          eventLabel: label || null,
          createdAt: new Date().toISOString(),
          authenticated: Boolean(visitor),
          ...device,
          ...source,
        };
        if (payload.eventType === 'session_heartbeat') {
          await database.touchAnalyticsSession(event);
        } else {
          await database.recordAnalyticsEvent(event);
        }
        const retentionCutoff = Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        if (Date.now() - analyticsPrunedAt > 24 * 60 * 60 * 1000) {
          await database.pruneAnalytics(new Date(retentionCutoff).toISOString());
          analyticsPrunedAt = Date.now();
        }
        return sendJson(response, 200, { recorded: true });
      }

      if (pathname === '/api/analytics/like') {
        if (typeof payload.liked !== 'boolean') return sendJson(response, 400, { error: 'Like state is required.' });
        if (typeof payload.clientId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.clientId)) {
          return sendJson(response, 400, { error: 'A valid browser like token is required.' });
        }
        const clientIdHash = crypto.createHmac('sha256', SESSION_SECRET).update(payload.clientId).digest('hex');
        const changed = await database.setProfileLike(clientIdHash, payload.liked);
        const likeAnalytics = await readAnalytics();
        if (changed) likeAnalytics.likes = Math.max(0, likeAnalytics.likes + (payload.liked ? 1 : -1));
        await writeAnalytics(likeAnalytics);
        return sendJson(response, 200, { likes: likeAnalytics.likes });
      }
      return sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
        return sendJson(response, 400, { error: error.message });
      }
      if (error.message === 'Analytics session does not match the visitor consent.') {
        return sendJson(response, 403, { error: 'Analytics session is invalid.' });
      }
      console.error('Analytics event could not be recorded:', error);
      return sendJson(response, 500, { error: 'Analytics event could not be recorded.' });
    }
  }

  if (pathname === '/api/user/forgot-password') {
    if (request.method !== 'POST' || !hasSameOrigin(request)) {
      return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    }
    const address = clientAddress(request);
    if (await isRateLimited('visitor_password_recovery', address)) {
      return sendJson(response, 429, { error: 'Too many recovery attempts. Try again in 15 minutes.' });
    }
    try {
      const payload = await readJson(request);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return sendJson(response, 400, { error: 'Recovery details must be sent as a JSON object.' });
      }
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      const recoveryKey = typeof payload.recoveryKey === 'string' ? payload.recoveryKey : '';
      const validEmail = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const account = validEmail ? await database.getVisitorAccountByEmail(email) : null;
      const credential = account ? await database.getVisitorRecoveryCredential(account.id) : null;
      const recoverySalt = credential?.recoveryKeySalt || 'portfolio-visitor-recovery';
      const suppliedHash = await derivePasswordHash(
        recoveryKey.slice(0, 128),
        recoverySalt,
        64,
      );
      const storedHash = credential ? Buffer.from(credential.recoveryKeyHash, 'base64url') : Buffer.alloc(64);
      const recoveryKeyMatches = recoveryKey.length >= 12 && recoveryKey.length <= 128
        && Buffer.byteLength(recoveryKey, 'utf8') <= 256
        && storedHash.length === suppliedHash.length
        && crypto.timingSafeEqual(storedHash, suppliedHash);
      if (!account || !credential || !recoveryKeyMatches) {
        return sendJson(response, 200, {
          resetToken: null,
          message: 'If the account details are valid, a reset token will be issued. Verify the email and recovery key.',
        });
      }

      const resetToken = crypto.randomBytes(32).toString('base64url');
      await database.setVisitorPasswordResetToken(
        visitorResetTokenHash(resetToken),
        account.id,
        Date.now() + VISITOR_RESET_TOKEN_DURATION_MS,
      );
      return sendJson(response, 200, {
        resetToken,
        message: 'Recovery verified. Set a new password within 15 minutes.',
      });
    } catch (error) {
      if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
        return sendJson(response, 400, { error: error.message });
      }
      console.error('Visitor password recovery could not be completed:', error);
      return sendJson(response, 500, { error: 'Visitor password recovery could not be completed.' });
    }
  }

  if (pathname === '/api/user/reset-password') {
    if (request.method !== 'POST' || !hasSameOrigin(request)) {
      return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    }
    const address = clientAddress(request);
    if (await isRateLimited('visitor_password_reset', address)) {
      return sendJson(response, 429, { error: 'Too many password reset attempts. Try again in 15 minutes.' });
    }
    try {
      const payload = await readJson(request);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return sendJson(response, 400, { error: 'Password reset details must be sent as a JSON object.' });
      }
      const resetToken = typeof payload.resetToken === 'string' ? payload.resetToken : '';
      const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
      const confirmPassword = typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(resetToken)) {
        return sendJson(response, 400, { error: 'The reset token is invalid or expired.' });
      }
      if (newPassword.length < 8 || newPassword.length > 128) {
        return sendJson(response, 400, { error: 'Choose a password between 8 and 128 characters.' });
      }
      if (newPassword !== confirmPassword) {
        return sendJson(response, 400, { error: 'The new password and confirmation do not match.' });
      }

      const passwordSalt = crypto.randomBytes(16).toString('base64url');
      const passwordHash = (await derivePasswordHash(newPassword, passwordSalt, 64)).toString('base64url');
      const accountId = await database.consumeVisitorPasswordResetToken(visitorResetTokenHash(resetToken));
      if (!accountId) {
        return sendJson(response, 400, { error: 'The reset token is invalid or expired.' });
      }
      const passwordUpdated = await database.updateVisitorPassword(accountId, passwordSalt, passwordHash);
      if (!passwordUpdated) {
        return sendJson(response, 400, { error: 'The reset token is invalid or expired.' });
      }
      return sendJson(response, 200, { reset: true }, { 'Set-Cookie': await clearVisitorSession(request) });
    } catch (error) {
      if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
        return sendJson(response, 400, { error: error.message });
      }
      console.error('Visitor password reset could not be completed:', error);
      return sendJson(response, 500, { error: 'Visitor password reset could not be completed.' });
    }
  }

  if (pathname.startsWith('/api/visitor/')) {
    if (request.method !== 'GET' && !hasSameOrigin(request)) {
      return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    }

    try {
      if (request.method === 'GET' && pathname === '/api/visitor/session') {
        const session = await visitorSessionFromRequest(request);
        return sendJson(response, 200, {
          authenticated: Boolean(session),
          account: session ? visitorAccountSummary(session.account) : null,
        });
      }

      if (request.method === 'POST' && pathname === '/api/visitor/register') {
        const address = clientAddress(request);
        if (!await allowVisitorRegistrationAttempt(address)) {
          return sendJson(response, 429, { error: 'Too many account requests. Try again in 15 minutes.' });
        }

        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(response, 400, { error: 'Account details must be sent as a JSON object.' });
        }
        if (payload.privacyAccepted !== true) {
          return sendJson(response, 400, { error: 'Confirm the account data notice to continue.' });
        }
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
        const password = typeof payload.password === 'string' ? payload.password : '';
        const recoveryKey = typeof payload.recoveryKey === 'string' ? payload.recoveryKey : '';
        const recoveryKeyConfirmation = typeof payload.recoveryKeyConfirmation === 'string'
          ? payload.recoveryKeyConfirmation
          : '';
        if (name.length < 2 || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
          return sendJson(response, 400, { error: 'Enter a display name between 2 and 60 characters.' });
        }
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return sendJson(response, 400, { error: 'Enter a valid email address.' });
        }
        if (password.length < 8 || password.length > 128) {
          return sendJson(response, 400, { error: 'Choose a password between 8 and 128 characters.' });
        }
        if (recoveryKey.length < 12 || recoveryKey.length > 128
          || Buffer.byteLength(recoveryKey, 'utf8') > 256) {
          return sendJson(response, 400, { error: 'Choose a recovery key between 12 and 128 characters.' });
        }
        if (recoveryKey !== recoveryKeyConfirmation) {
          return sendJson(response, 400, { error: 'The recovery key and confirmation do not match.' });
        }

        const passwordSalt = crypto.randomBytes(16).toString('base64url');
        const passwordHash = (await derivePasswordHash(password, passwordSalt, 64)).toString('base64url');
        const recoveryKeySalt = crypto.randomBytes(16).toString('base64url');
        const recoveryKeyHash = (await derivePasswordHash(recoveryKey, recoveryKeySalt, 64)).toString('base64url');
        const accounts = await readVisitorAccountsFromStore();
        if (accounts.some((account) => account.email === email)) {
          return sendJson(response, 409, { error: 'An account already uses that email. Sign in instead.' });
        }
        const account = {
          id: crypto.randomUUID(),
          name,
          email,
          passwordSalt,
          passwordHash,
          recoveryKeySalt,
          recoveryKeyHash,
          createdAt: new Date().toISOString(),
          privacyAcknowledgedAt: new Date().toISOString(),
        };
        accounts.push(account);
        await writeVisitorAccountsToStore(accounts);
        await database.resetRateLimit(rateLimitKey('visitor_registration', address));
        return sendJson(response, 201, { authenticated: true, account: visitorAccountSummary(account) }, {
          'Set-Cookie': await createVisitorSession(account),
        });
      }

      if (request.method === 'POST' && pathname === '/api/visitor/login') {
        const address = clientAddress(request);
        if (await isRateLimited('visitor_login', address)) {
          return sendJson(response, 429, { error: 'Too many account requests. Try again in 15 minutes.' });
        }

        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(response, 400, { error: 'Sign-in details must be sent as a JSON object.' });
        }
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
        const password = typeof payload.password === 'string' ? payload.password : '';
        if (password.length > 128) {
          return sendJson(response, 401, { error: 'Email or password was not accepted.' });
        }
        const account = (await readVisitorAccountsFromStore()).find((item) => item.email === email);
        const salt = account?.passwordSalt || 'portfolio-visitor-signin';
        const suppliedHash = await derivePasswordHash(password, salt, 64);
        const storedHash = account ? Buffer.from(account.passwordHash, 'base64url') : Buffer.alloc(64);
        const accepted = Boolean(account) && storedHash.length === suppliedHash.length
          && crypto.timingSafeEqual(storedHash, suppliedHash);
        if (!accepted) {
          return sendJson(response, 401, { error: 'Email or password was not accepted.' });
        }

        await database.resetRateLimit(rateLimitKey('visitor_login', address));
        return sendJson(response, 200, { authenticated: true, account: visitorAccountSummary(account) }, {
          'Set-Cookie': await createVisitorSession(account),
        });
      }

      if (request.method === 'POST' && pathname === '/api/visitor/logout') {
        return sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': await clearVisitorSession(request) });
      }

      if (request.method === 'POST' && pathname === '/api/visitor/recovery-key') {
        const session = await visitorSessionFromRequest(request);
        if (!session) return sendJson(response, 401, { error: 'Sign in to continue.' });
        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(response, 400, { error: 'Recovery key details must be sent as a JSON object.' });
        }
        const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
        const recoveryKey = typeof payload.recoveryKey === 'string' ? payload.recoveryKey : '';
        const recoveryKeyConfirmation = typeof payload.recoveryKeyConfirmation === 'string'
          ? payload.recoveryKeyConfirmation
          : '';
        const suppliedPasswordHash = await derivePasswordHash(
          currentPassword.slice(0, 128),
          session.account.passwordSalt,
          64,
        );
        const storedPasswordHash = Buffer.from(session.account.passwordHash, 'base64url');
        if (currentPassword.length > 128 || storedPasswordHash.length !== suppliedPasswordHash.length
          || !crypto.timingSafeEqual(storedPasswordHash, suppliedPasswordHash)) {
          return sendJson(response, 401, { error: 'The current password was not accepted.' });
        }
        if (recoveryKey.length < 12 || recoveryKey.length > 128
          || Buffer.byteLength(recoveryKey, 'utf8') > 256) {
          return sendJson(response, 400, { error: 'Choose a recovery key between 12 and 128 characters.' });
        }
        if (recoveryKey !== recoveryKeyConfirmation) {
          return sendJson(response, 400, { error: 'The recovery key and confirmation do not match.' });
        }
        const recoveryKeySalt = crypto.randomBytes(16).toString('base64url');
        const recoveryKeyHash = (await derivePasswordHash(recoveryKey, recoveryKeySalt, 64)).toString('base64url');
        await database.setVisitorRecoveryCredential(session.account.id, recoveryKeySalt, recoveryKeyHash);
        return sendJson(response, 200, { saved: true });
      }

      if (request.method === 'DELETE' && pathname === '/api/visitor/account') {
        const session = await visitorSessionFromRequest(request);
        if (!session) return sendJson(response, 401, { error: 'Sign in to continue.' });

        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(response, 400, { error: 'Account details must be sent as a JSON object.' });
        }
        const password = typeof payload.password === 'string' ? payload.password : '';
        if (password.length > 128) {
          return sendJson(response, 401, { error: 'The current password was not accepted.' });
        }
        const suppliedHash = await derivePasswordHash(password, session.account.passwordSalt, 64);
        const storedHash = Buffer.from(session.account.passwordHash, 'base64url');
        if (storedHash.length !== suppliedHash.length || !crypto.timingSafeEqual(storedHash, suppliedHash)) {
          return sendJson(response, 401, { error: 'The current password was not accepted.' });
        }

        const accounts = (await readVisitorAccountsFromStore()).filter((account) => account.id !== session.account.id);
        await writeVisitorAccountsToStore(accounts);
        await database.deleteVisitorSessionsForUser(session.account.id);
        return sendJson(response, 200, { deleted: true }, { 'Set-Cookie': await clearVisitorSession(request) });
      }
    } catch (error) {
      if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
        return sendJson(response, 400, { error: error.message });
      }
      console.error('Visitor account request failed:', error);
      return sendJson(response, 500, { error: 'The account request could not be completed.' });
    }

    return sendJson(response, 404, { error: 'Not found.' });
  }

  if (pathname.startsWith('/api/admin/')) {
    const blobUploadRequest = request.method === 'POST'
      && pathname === '/api/admin/uploads'
      && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
    if (request.method !== 'GET' && !blobUploadRequest && !hasSameOrigin(request)) {
      return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    }
    if (blobUploadRequest) return handlePrivateBlobUpload(request, response);

    if (request.method === 'POST' && pathname === '/api/admin/forgot-password') {
      const address = clientAddress(request);
      if (await isRateLimited('admin_password_recovery', address)) {
        return sendJson(response, 429, { error: 'Too many recovery attempts. Try again in 15 minutes.' });
      }
      if (!ADMIN_RECOVERY_KEY) {
        return sendJson(response, 503, { error: 'Administrator password recovery is not configured.' });
      }
      try {
        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(response, 400, { error: 'Recovery details must be sent as a JSON object.' });
        }
        const recoveryKey = typeof payload.recoveryKey === 'string' ? payload.recoveryKey : '';
        if (!matchesAdminRecoveryKey(recoveryKey)) {
          return sendJson(response, 200, {
            resetToken: null,
            message: 'A reset token could not be issued. Verify the recovery key and try again.',
          });
        }

        const resetToken = crypto.randomBytes(32).toString('base64url');
        await database.setAdminPasswordResetToken(
          adminResetTokenHash(resetToken),
          Date.now() + ADMIN_RESET_TOKEN_DURATION_MS,
        );
        await database.recordAdminAudit('admin_password_recovery_requested');
        return sendJson(response, 200, {
          resetToken,
          message: 'Recovery verified. Set a new password within 15 minutes.',
        });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Administrator password recovery could not be completed:', error);
        return sendJson(response, 500, { error: 'Administrator password recovery could not be completed.' });
      }
    }

    if (request.method === 'POST' && pathname === '/api/admin/reset-password') {
      const address = clientAddress(request);
      if (await isRateLimited('admin_password_reset', address)) {
        return sendJson(response, 429, { error: 'Too many password reset attempts. Try again in 15 minutes.' });
      }
      try {
        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(response, 400, { error: 'Password reset details must be sent as a JSON object.' });
        }
        const resetToken = typeof payload.resetToken === 'string' ? payload.resetToken : '';
        const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
        const confirmPassword = typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(resetToken)) {
          return sendJson(response, 400, { error: 'The reset token is invalid or expired.' });
        }
        if (newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > MAX_ADMIN_PASSWORD_BYTES) {
          return sendJson(response, 400, { error: 'Choose a new password with at least 12 characters and no more than 72 UTF-8 bytes.' });
        }
        if (newPassword !== confirmPassword) {
          return sendJson(response, 400, { error: 'The new password and confirmation do not match.' });
        }
        if (await bcrypt.compare(newPassword, ADMIN_PASSWORD_HASH)) {
          return sendJson(response, 400, { error: 'Choose a password different from your current password.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        const tokenAccepted = await database.consumeAdminPasswordResetToken(adminResetTokenHash(resetToken));
        if (!tokenAccepted) {
          return sendJson(response, 400, { error: 'The reset token is invalid or expired.' });
        }
        await database.clearAdminSessions();
        await database.setAdminPasswordHash(passwordHash);
        ADMIN_PASSWORD_HASH = passwordHash;
        await database.recordAdminAudit('admin_password_reset');
        return sendJson(response, 200, { reset: true });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Administrator password reset could not be completed:', error);
        return sendJson(response, 500, { error: 'Administrator password reset could not be completed.' });
      }
    }

    if (request.method === 'POST' && pathname === '/api/admin/login') {
      const address = clientAddress(request);
      if (await isRateLimited('admin_login', address)) {
        try {
          await database.recordAdminAudit('admin_login_rate_limited');
        } catch (error) {
          console.error('Rate-limited administrator attempt could not be recorded:', error);
        }
        return sendJson(response, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      }
      try {
        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(response, 400, { error: 'Sign-in details must be sent as a JSON object.' });
        }
        const supplied = typeof payload.password === 'string' ? payload.password : '';
        if (!supplied || Buffer.byteLength(supplied, 'utf8') > MAX_ADMIN_PASSWORD_BYTES) {
          await database.recordAdminAudit('admin_login_failed');
          return sendJson(response, 401, { error: 'The password was not accepted.' });
        }
        const accepted = await bcrypt.compare(supplied, ADMIN_PASSWORD_HASH);
        if (!accepted) {
          await database.recordAdminAudit('admin_login_failed');
          return sendJson(response, 401, { error: 'The password was not accepted.' });
        }
        await database.resetRateLimit(rateLimitKey('admin_login', address));
        await database.recordAdminAudit('admin_login_succeeded');
        return sendJson(response, 200, { authenticated: true }, { 'Set-Cookie': await makeSessionCookie() });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Admin sign-in failed:', error);
        return sendJson(response, 500, { error: 'Admin sign-in could not be completed.' });
      }
    }

    if (request.method === 'GET' && pathname === '/api/admin/session') {
      return sendJson(response, 200, { authenticated: await hasValidSession(request) });
    }

    if (!await hasValidSession(request)) {
      return sendJson(response, 401, { error: 'Sign in to continue.' });
    }

    if (request.method === 'POST' && pathname === '/api/admin/logout') {
      try {
        await database.recordAdminAudit('admin_signed_out');
        return sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': await clearAdminSession(request) });
      } catch (error) {
        console.error('Admin sign-out could not be recorded:', error);
        return sendJson(response, 500, { error: 'Admin sign-out could not be completed.' });
      }
    }

    if (request.method === 'GET' && pathname === '/api/admin/extensions') {
      try {
        const [extensions, comments, messages, uploads, follows] = await Promise.all([
          database.getPortfolioExtensions(),
          database.listComments(),
          database.listContactMessages(),
          database.listPortfolioUploads(),
          database.getPortfolioFollowSummary(),
        ]);
        return sendJson(response, 200, { extensions, comments, messages, uploads, follows });
      } catch (error) {
        console.error('Portfolio tools could not be loaded:', error);
        return sendJson(response, 500, { error: 'Portfolio tools are unavailable.' });
      }
    }

    if (request.method === 'PUT' && pathname === '/api/admin/extensions') {
      try {
        const extensions = await readJson(request);
        if (!validateExtensions(extensions)) {
          return sendJson(response, 400, { error: 'Certificate, SEO, or appearance settings are invalid.' });
        }
        await database.savePortfolioExtensions(extensions);
        await database.recordAdminAudit('portfolio_extensions_saved');
        return sendJson(response, 200, { saved: true });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Portfolio tools could not be saved:', error);
        return sendJson(response, 500, { error: 'Portfolio tools could not be saved.' });
      }
    }

    const commentRoute = pathname.match(/^\/api\/admin\/comments\/([0-9a-f-]{36})$/i);
    if (commentRoute && request.method === 'PATCH') {
      try {
        const payload = await readJson(request);
        if (!['approved', 'pending'].includes(payload?.status)) {
          return sendJson(response, 400, { error: 'Choose approved or pending status.' });
        }
        const result = await database.moderateComment(commentRoute[1], payload.status);
        return result.changes ? sendJson(response, 200, { updated: true }) : sendJson(response, 404, { error: 'Comment not found.' });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Comment moderation failed:', error);
        return sendJson(response, 500, { error: 'Comment moderation failed.' });
      }
    }
    if (commentRoute && request.method === 'DELETE') {
      try {
        const result = await database.deleteComment(commentRoute[1]);
        return result.changes ? sendJson(response, 200, { deleted: true }) : sendJson(response, 404, { error: 'Comment not found.' });
      } catch (error) {
        console.error('Comment could not be deleted:', error);
        return sendJson(response, 500, { error: 'Comment could not be deleted.' });
      }
    }

    const messageRoute = pathname.match(/^\/api\/admin\/messages\/([0-9a-f-]{36})$/i);
    if (messageRoute && request.method === 'DELETE') {
      try {
        const result = await database.deleteContactMessage(messageRoute[1]);
        return result.changes ? sendJson(response, 200, { deleted: true }) : sendJson(response, 404, { error: 'Message not found.' });
      } catch (error) {
        console.error('Contact message could not be deleted:', error);
        return sendJson(response, 500, { error: 'Contact message could not be deleted.' });
      }
    }

    if (request.method === 'POST' && pathname === '/api/admin/uploads') {
      if (isProduction && !process.env.BLOB_READ_WRITE_TOKEN) {
        return sendJson(response, 503, { error: 'Persistent upload storage is not configured.' });
      }
      let uploadPath;
      let blobPath;
      try {
        const payload = await readJson(request, MAX_UPLOAD_BODY_BYTES);
        if (typeof payload?.content !== 'string' || payload.content.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.content)) {
          return sendJson(response, 400, { error: 'Choose a valid JPEG, PNG, WebP image, or PDF file up to 5 MB.' });
        }
        const buffer = Buffer.from(payload.content, 'base64');
        if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES || buffer.toString('base64') !== payload.content) {
          return sendJson(response, 400, { error: 'Choose a valid file up to 5 MB.' });
        }
        const detected = detectUploadType(buffer);
        if (!detected) {
          return sendJson(response, 400, { error: 'Only valid JPEG, PNG, WebP, or PDF files can be uploaded.' });
        }
        const id = crypto.randomUUID();
        const fileName = `${id}.${detected.extension}`;
        const originalName = safeOriginalName(payload.fileName);
        if (!originalName) return sendJson(response, 400, { error: 'A file name is required.' });
        if (process.env.BLOB_READ_WRITE_TOKEN) {
          const blob = await putBlob(fileName, buffer, {
            access: 'private',
            addRandomSuffix: false,
            contentType: detected.type,
          });
          blobPath = blob.pathname;
        } else {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          uploadPath = path.join(UPLOADS_DIR, fileName);
          fs.writeFileSync(uploadPath, buffer, { flag: 'wx', mode: 0o644 });
        }
        await database.addPortfolioUpload({
          id,
          originalName,
          contentType: detected.type,
          fileSize: buffer.length,
          uploadedAt: new Date().toISOString(),
          ...(blobPath ? { blobPath } : {}),
        });
        return sendJson(response, 201, {
          id,
          originalName,
          contentType: detected.type,
          fileSize: buffer.length,
          url: `/uploads/${fileName}`,
        });
      } catch (error) {
        if (uploadPath) fs.rmSync(uploadPath, { force: true });
        if (blobPath) {
          try {
            await deleteBlob(blobPath);
          } catch (cleanupError) {
            console.error('Uploaded portfolio file could not be removed after a database error:', cleanupError);
          }
        }
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Portfolio file could not be uploaded:', error);
        return sendJson(response, 500, { error: 'Portfolio file could not be uploaded.' });
      }
    }

    const uploadRoute = pathname.match(/^\/api\/admin\/uploads\/([0-9a-f-]{36})$/i);
    if (uploadRoute && request.method === 'DELETE') {
      try {
        const uploads = await database.listPortfolioUploads();
        const upload = uploads.find((item) => item.id === uploadRoute[1]);
        if (!upload) return sendJson(response, 404, { error: 'Upload not found.' });
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[upload.contentType];
        if (!extension) return sendJson(response, 500, { error: 'Upload type is invalid.' });
        if (upload.blobPath) await deleteBlob(upload.blobPath);
        else await fs.promises.rm(path.join(UPLOADS_DIR, `${upload.id}.${extension}`), { force: true });
        const result = await database.deletePortfolioUpload(upload.id);
        if (!result.changes) return sendJson(response, 404, { error: 'Upload not found.' });
        return sendJson(response, 200, { deleted: true });
      } catch (error) {
        console.error('Portfolio upload could not be deleted:', error);
        return sendJson(response, 500, { error: 'Portfolio upload could not be deleted.' });
      }
    }

    if (request.method === 'GET' && pathname === '/api/admin/dashboard') {
      try {
        return sendJson(response, 200, await adminDashboardSnapshot());
      } catch (error) {
        console.error('Admin dashboard could not be loaded:', error);
        return sendJson(response, 500, { error: 'Dashboard data is unavailable.' });
      }
    }

    if (request.method === 'GET' && pathname === '/api/admin/portfolio') {
      try {
        return sendJson(response, 200, await readPortfolio());
      } catch {
        return sendJson(response, 500, { error: 'Portfolio content is unavailable.' });
      }
    }

    if (request.method === 'GET' && pathname === '/api/admin/portfolio/draft') {
      try {
        const draft = await readPortfolioDraft();
        return sendJson(response, 200, { content: draft || await readPortfolio(), isDraft: Boolean(draft) });
      } catch (error) {
        console.error('Portfolio draft could not be loaded:', error);
        return sendJson(response, 500, { error: 'Portfolio draft is unavailable.' });
      }
    }

    if (request.method === 'PUT' && pathname === '/api/admin/portfolio/draft') {
      try {
        const data = await readJson(request);
        if (!validatePortfolio(data)) return sendJson(response, 400, { error: 'Some portfolio fields are missing or invalid.' });
        await savePortfolioDraft(data);
        await database.recordAdminAudit('portfolio_draft_saved');
        return sendJson(response, 200, { saved: true });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Portfolio draft could not be saved:', error);
        return sendJson(response, 500, { error: 'Portfolio draft could not be saved.' });
      }
    }

    if (request.method === 'GET' && pathname === '/api/admin/portfolio/revisions') {
      try {
        return sendJson(response, 200, { revisions: await listPortfolioRevisions() });
      } catch (error) {
        console.error('Portfolio revision history could not be loaded:', error);
        return sendJson(response, 500, { error: 'Portfolio revision history is unavailable.' });
      }
    }

    if (request.method === 'POST' && pathname === '/api/admin/portfolio/publish') {
      try {
        const draft = await readPortfolioDraft();
        if (!draft) return sendJson(response, 409, { error: 'Save a draft before publishing.' });
        if (!validatePortfolio(draft)) return sendJson(response, 500, { error: 'The saved draft is invalid and cannot be published.' });
        await archivePortfolioRevision(await readPortfolio());
        await writePortfolio(draft);
        await savePortfolioDraft(null);
        await database.recordAdminAudit('portfolio_published');
        return sendJson(response, 200, { published: true });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Portfolio changes could not be published:', error);
        return sendJson(response, 500, { error: 'Portfolio changes could not be published.' });
      }
    }

    if (request.method === 'POST' && pathname === '/api/admin/portfolio/revisions/restore') {
      try {
        const payload = await readJson(request);
        const revision = await readPortfolioRevision(payload?.id);
        if (!revision || !validatePortfolio(revision.content)) {
          return sendJson(response, 404, { error: 'That portfolio revision is unavailable.' });
        }
        await savePortfolioDraft(revision.content);
        await database.recordAdminAudit('portfolio_revision_restored_to_draft');
        return sendJson(response, 200, { restored: true });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Portfolio revision could not be restored:', error);
        return sendJson(response, 500, { error: 'Portfolio revision could not be restored.' });
      }
    }

    if (request.method === 'GET'
      && ['/api/admin/analytics', '/api/admin/analytics/export', '/api/admin/analytics/export.csv', '/api/admin/analytics/export.pdf'].includes(pathname)) {
      try {
        const period = analyticsPeriod(requestUrl);
        const report = await analyticsSnapshot(period);
        const date = new Date().toISOString().slice(0, 10);
        if (pathname.endsWith('.csv')) {
          const csv = analyticsExportRows(report).map((row) => row.map(csvCell).join(',')).join('\r\n');
          response.writeHead(200, {
            ...securityHeaders(),
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="portfolio-analytics-${date}.csv"`,
            'Cache-Control': 'no-store',
          });
          return response.end(`\uFEFF${csv}`);
        }
        if (pathname.endsWith('.pdf')) {
          response.writeHead(200, {
            ...securityHeaders(),
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="portfolio-analytics-${date}.pdf"`,
            'Cache-Control': 'no-store',
          });
          return response.end(createAnalyticsPdf(report));
        }
        if (pathname.endsWith('/export')) {
          return sendJson(response, 200, {
            exportedAt: new Date().toISOString(),
            scope: 'Opt-in, pseudonymous analytics only; no account IDs, IP addresses, exact locations, or full referrer URLs.',
            analytics: report,
          }, { 'Content-Disposition': `attachment; filename="portfolio-analytics-${date}.json"` });
        }
        return sendJson(response, 200, report);
      } catch (error) {
        if (error.message.includes('date range') || error.message.includes('supported analytics')) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Admin analytics could not be loaded:', error);
        return sendJson(response, 500, { error: 'Analytics data is unavailable.' });
      }
    }

    if (request.method === 'POST' && pathname === '/api/admin/security/password') {
      try {
        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return sendJson(response, 400, { error: 'Password details must be sent as a JSON object.' });
        }
        const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
        const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
        const confirmPassword = typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';
        if (!(await bcrypt.compare(currentPassword, ADMIN_PASSWORD_HASH))) {
          return sendJson(response, 401, { error: 'The current password was not accepted.' });
        }
        if (newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > MAX_ADMIN_PASSWORD_BYTES) {
          return sendJson(response, 400, { error: 'Choose a new password with at least 12 characters and no more than 72 UTF-8 bytes.' });
        }
        if (newPassword !== confirmPassword) {
          return sendJson(response, 400, { error: 'The new password and confirmation do not match.' });
        }
        if (await bcrypt.compare(newPassword, ADMIN_PASSWORD_HASH)) {
          return sendJson(response, 400, { error: 'Choose a password different from your current password.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await database.setAdminPasswordHash(passwordHash);
        ADMIN_PASSWORD_HASH = passwordHash;
        await database.recordAdminAudit('admin_password_changed');
        await database.clearAdminSessions();
        return sendJson(response, 200, { changed: true }, { 'Set-Cookie': await makeSessionCookie() });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Admin password could not be changed:', error);
        return sendJson(response, 500, { error: 'Admin password could not be changed.' });
      }
    }

    if (request.method === 'POST' && pathname === '/api/admin/security/logout-all') {
      try {
        await database.recordAdminAudit('admin_sessions_revoked');
        await database.clearAdminSessions();
        return sendJson(response, 200, { signedOut: true }, {
          'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isProduction ? '; Secure' : ''}`,
        });
      } catch (error) {
        console.error('Admin sessions could not be revoked:', error);
        return sendJson(response, 500, { error: 'Admin sessions could not be revoked.' });
      }
    }

    if (request.method === 'PUT' && pathname === '/api/admin/portfolio') {
      try {
        const data = await readJson(request);
        if (!validatePortfolio(data)) return sendJson(response, 400, { error: 'Some portfolio fields are missing or invalid.' });
        await archivePortfolioRevision(await readPortfolio());
        await writePortfolio(data);
        await database.recordAdminAudit('portfolio_published');
        return sendJson(response, 200, { saved: true });
      } catch (error) {
        if (['Request body is too large.', 'Request body must be valid JSON.'].includes(error.message)) {
          return sendJson(response, 400, { error: error.message });
        }
        console.error('Portfolio content could not be saved:', error);
        return sendJson(response, 500, { error: 'Portfolio content could not be saved.' });
      }
    }

    return sendJson(response, 404, { error: 'Not found.' });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
  }

  if (pathname === '/admin') {
    response.writeHead(302, { ...securityHeaders(), Location: '/admin.html', 'Cache-Control': 'no-store' });
    return response.end();
  }

  return serveStatic(request, response, pathname, requestUrl.search);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error('Request could not be completed:', error);
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    sendJson(response, 500, { error: 'The request could not be completed.' });
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`The portfolio server could not start because ${HOST}:${PORT} is already in use. Stop the other server or choose another PORT in .env.`);
  } else {
    console.error('The portfolio server could not start listening:', error.message);
  }
  process.exit(1);
});

let applicationInitialization;

async function initializeApplication() {
  if (!applicationInitialization) {
    applicationInitialization = (async () => {
    await database.initializeDatabase();
    await database.pruneExpiredSessions();
    const storedAdminPasswordHash = await database.getAdminPasswordHash();
    if (storedAdminPasswordHash) {
      if (!bcryptHashPattern.test(storedAdminPasswordHash)) {
        throw new Error('The saved administrator credential is invalid.');
      }
      ADMIN_PASSWORD_HASH = storedAdminPasswordHash;
    } else {
      await database.setAdminPasswordHash(ADMIN_PASSWORD_HASH);
    }
    if (!await database.getPortfolioDocument('published')) {
      const initialPortfolio = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!validatePortfolio(initialPortfolio)) throw new Error('The initial portfolio content is invalid.');
      await database.savePortfolioDocument('published', initialPortfolio);
    }
    if (!await database.getPortfolioDocument('draft') && !database.isRemoteDatabase) {
      try {
        await database.savePortfolioDocument('draft', JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf8')));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if ((await database.listPortfolioRevisions()).length === 0 && !database.isRemoteDatabase) {
      try {
        for (const name of fs.readdirSync(REVISIONS_DIR).filter((entry) => /^\d{13}-[0-9a-f-]{36}\.json$/i.test(entry)).sort()) {
          const revision = JSON.parse(fs.readFileSync(path.join(REVISIONS_DIR, name), 'utf8'));
          if (revision.id && revision.createdAt && validatePortfolio(revision.content)) {
            await database.savePortfolioRevision(revision);
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await readAnalytics();
    await database.pruneAnalytics(
      new Date(Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
    analyticsPrunedAt = Date.now();
    await readVisitorAccountsFromStore();
    })().catch((error) => {
      applicationInitialization = null;
      throw error;
    });
  }
  return applicationInitialization;
}

async function startServer() {
  try {
    await initializeApplication();
    server.listen(PORT, HOST, () => {
      console.log(`Portfolio is running at http://localhost:${PORT}`);
      console.log(`Admin sign-in: http://localhost:${PORT}/admin`);
    });
  } catch (error) {
    console.error('Failed to initialize the portfolio database.', error);
    process.exit(1);
  }
}

if (require.main === module) startServer();

module.exports = { handleRequest, initializeApplication };
