const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@libsql/client');

const DATA_DIR = path.join(__dirname, 'data');
const DATABASE_PATH = path.join(DATA_DIR, 'portfolio.db');
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;
const usesLibsqlClient = Boolean(TURSO_DATABASE_URL);
const isRemoteDatabase = usesLibsqlClient && !TURSO_DATABASE_URL.startsWith('file:');
let lastRateLimitCleanup = 0;

function ensureDirectory() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (isRemoteDatabase && !TURSO_AUTH_TOKEN) {
  throw new Error('TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is configured.');
}

const db = usesLibsqlClient
  ? createClient({ url: TURSO_DATABASE_URL, ...(TURSO_AUTH_TOKEN ? { authToken: TURSO_AUTH_TOKEN } : {}) })
  : new sqlite3.Database(DATABASE_PATH, (error) => {
    if (error) console.error('Failed to open SQLite database.', error);
  });

function run(sql, params = []) {
  if (usesLibsqlClient) {
    return db.execute({ sql, args: params }).then((result) => ({
      lastID: Number(result.lastInsertRowid || 0),
      changes: Number(result.rowsAffected || 0),
    }));
  }
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  if (usesLibsqlClient) {
    return db.execute({ sql, args: params }).then((result) => result.rows[0] || null);
  }
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  if (usesLibsqlClient) {
    return db.execute({ sql, args: params }).then((result) => result.rows);
  }
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows || []);
    });
  });
}

function normalizeVisitorAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.display_name,
    email: row.email,
    passwordSalt: row.password_salt || '',
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    privacyAcknowledgedAt: row.created_at,
  };
}

async function initializeDatabase() {
  if (!isRemoteDatabase) ensureDirectory();
  await run('PRAGMA foreign_keys = ON');
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT,
      role TEXT NOT NULL DEFAULT 'visitor',
      created_at TEXT NOT NULL,
      last_login TEXT
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS analytics_consent (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL UNIQUE,
      consent_status TEXT NOT NULL CHECK(consent_status IN ('granted', 'declined', 'pending')),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (visitor_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS visitor_analytics (
      id TEXT PRIMARY KEY,
      anonymous_visitor_id TEXT,
      page_path TEXT NOT NULL,
      visited_at TEXT NOT NULL,
      consent_status TEXT NOT NULL DEFAULT 'granted'
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS page_statistics (
      id TEXT PRIMARY KEY,
      page_path TEXT NOT NULL UNIQUE,
      total_views INTEGER NOT NULL DEFAULT 0,
      last_visited TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY,
      administrator_id TEXT,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS visitor_password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS visitor_recovery_credentials (
      user_id TEXT PRIMARY KEY,
      recovery_key_salt TEXT NOT NULL,
      recovery_key_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS profile_like_clients (
      client_id_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS portfolio_extensions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content_json TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS portfolio_comments (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      page_key TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (visitor_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS portfolio_follows (
      visitor_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      FOREIGN KEY (visitor_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (visitor_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS portfolio_uploads (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS analytics_visitors (
      visitor_hash TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      total_visits INTEGER NOT NULL DEFAULT 0
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS analytics_sessions (
      id TEXT PRIMARY KEY,
      visitor_hash TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ended_at TEXT,
      landing_page TEXT NOT NULL,
      exit_page TEXT NOT NULL,
      page_views INTEGER NOT NULL DEFAULT 0,
      authenticated INTEGER NOT NULL DEFAULT 0,
      device_category TEXT NOT NULL,
      browser TEXT NOT NULL,
      operating_system TEXT NOT NULL,
      source_category TEXT NOT NULL,
      source_host TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      visitor_hash TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page_path TEXT NOT NULL,
      event_label TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS analytics_daily_summaries (
      day TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_key TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, event_type, event_key)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      key_hash TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS portfolio_documents (
      document_key TEXT PRIMARY KEY,
      content_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS portfolio_revisions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      content_json TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS legacy_analytics (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content_json TEXT NOT NULL
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (session_token_hash)');
  await run('CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_rate_limit_reset_at ON rate_limit_buckets (reset_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_portfolio_revisions_created ON portfolio_revisions (created_at DESC)');
  const uploadColumns = await all('PRAGMA table_info(portfolio_uploads)');
  if (!uploadColumns.some((column) => column.name === 'blob_path')) {
    await run('ALTER TABLE portfolio_uploads ADD COLUMN blob_path TEXT');
  }
  await run(`
    CREATE TRIGGER IF NOT EXISTS trg_analytics_event_insert
    AFTER INSERT ON analytics_events
    BEGIN
      INSERT INTO analytics_daily_summaries (day, event_type, event_key, event_count)
      VALUES (substr(NEW.created_at, 1, 10), NEW.event_type, COALESCE(NEW.event_label, NEW.page_path), 1)
      ON CONFLICT(day, event_type, event_key) DO UPDATE
      SET event_count = analytics_daily_summaries.event_count + 1;
    END
  `);
  await run(`
    CREATE TRIGGER IF NOT EXISTS trg_analytics_event_delete
    AFTER DELETE ON analytics_events
    BEGIN
      UPDATE analytics_daily_summaries
      SET event_count = event_count - 1
      WHERE day = substr(OLD.created_at, 1, 10)
        AND event_type = OLD.event_type
        AND event_key = COALESCE(OLD.event_label, OLD.page_path);
      DELETE FROM analytics_daily_summaries
      WHERE day = substr(OLD.created_at, 1, 10)
        AND event_type = OLD.event_type
        AND event_key = COALESCE(OLD.event_label, OLD.page_path)
        AND event_count <= 0;
    END
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)');
  await run('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_visitor_analytics_page_path ON visitor_analytics (page_path)');
  await run('CREATE INDEX IF NOT EXISTS idx_visitor_analytics_visited_at ON visitor_analytics (visited_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log (created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_portfolio_comments_status ON portfolio_comments (status, created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages (created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started_at ON analytics_sessions (started_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_analytics_sessions_last_seen ON analytics_sessions (last_seen_at, ended_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_analytics_sessions_visitor ON analytics_sessions (visitor_hash, started_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events (created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created ON analytics_events (event_type, created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor ON analytics_events (visitor_hash, created_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_analytics_daily_day_type ON analytics_daily_summaries (day, event_type)');
  await run(`INSERT OR IGNORE INTO portfolio_extensions (id, content_json) VALUES (1, ?)`, [
    JSON.stringify({
      certificates: [],
      seo: {},
      appearance: { accentColor: '#236653', defaultTheme: 'light' },
    }),
  ]);
}

async function createVisitorSession(tokenHash, accountId, expiresAt) {
  await run(
    `INSERT INTO sessions (id, user_id, session_token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [tokenHash, accountId, tokenHash, new Date(expiresAt).toISOString(), new Date().toISOString()],
  );
}

async function getVisitorSession(tokenHash) {
  return get(
    'SELECT user_id AS accountId, expires_at AS expiresAt FROM sessions WHERE session_token_hash = ?',
    [tokenHash],
  );
}

async function deleteVisitorSession(tokenHash) {
  return run('DELETE FROM sessions WHERE session_token_hash = ?', [tokenHash]);
}

async function deleteVisitorSessionsForUser(accountId) {
  return run('DELETE FROM sessions WHERE user_id = ?', [accountId]);
}

async function setVisitorPasswordResetToken(tokenHash, accountId, expiresAt) {
  await run(
    `INSERT INTO visitor_password_reset_tokens (token_hash, user_id, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
    [tokenHash, accountId, new Date(expiresAt).toISOString()],
  );
}

async function getVisitorRecoveryCredential(accountId) {
  return get(
    `SELECT recovery_key_salt AS recoveryKeySalt, recovery_key_hash AS recoveryKeyHash
     FROM visitor_recovery_credentials WHERE user_id = ?`,
    [accountId],
  );
}

async function setVisitorRecoveryCredential(accountId, recoveryKeySalt, recoveryKeyHash) {
  await run('DELETE FROM visitor_password_reset_tokens WHERE user_id = ?', [accountId]);
  await run(
    `INSERT INTO visitor_recovery_credentials (user_id, recovery_key_salt, recovery_key_hash, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       recovery_key_salt = excluded.recovery_key_salt,
       recovery_key_hash = excluded.recovery_key_hash,
       updated_at = excluded.updated_at`,
    [accountId, recoveryKeySalt, recoveryKeyHash, new Date().toISOString()],
  );
}

async function consumeVisitorPasswordResetToken(tokenHash, now = Date.now()) {
  const expiresAt = new Date(now).toISOString();
  const token = await get(
    'SELECT user_id AS accountId FROM visitor_password_reset_tokens WHERE token_hash = ? AND expires_at > ?',
    [tokenHash, expiresAt],
  );
  if (!token) return null;
  const result = await run(
    'DELETE FROM visitor_password_reset_tokens WHERE token_hash = ? AND user_id = ? AND expires_at > ?',
    [tokenHash, token.accountId, expiresAt],
  );
  return result.changes === 1 ? token.accountId : null;
}

async function updateVisitorPassword(accountId, passwordSalt, passwordHash) {
  await deleteVisitorSessionsForUser(accountId);
  const result = await run(
    'UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ? AND role = ?',
    [passwordSalt, passwordHash, accountId, 'visitor'],
  );
  return result.changes === 1;
}

async function createAdminSession(tokenHash, expiresAt) {
  await run(
    'INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)',
    [tokenHash, new Date(expiresAt).toISOString(), new Date().toISOString()],
  );
}

async function getAdminSession(tokenHash) {
  return get(
    'SELECT token_hash AS tokenHash, expires_at AS expiresAt FROM admin_sessions WHERE token_hash = ?',
    [tokenHash],
  );
}

async function deleteAdminSession(tokenHash) {
  return run('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
}

async function clearAdminSessions() {
  return run('DELETE FROM admin_sessions');
}

async function getAdminSessionCount() {
  const now = new Date().toISOString();
  await run('DELETE FROM admin_sessions WHERE expires_at <= ?', [now]);
  const row = await get('SELECT COUNT(*) AS count FROM admin_sessions');
  return Number(row.count);
}

async function consumeRateLimit(keyHash, windowMs) {
  const now = Date.now();
  if (now - lastRateLimitCleanup >= 60 * 1000) {
    await run('DELETE FROM rate_limit_buckets WHERE reset_at <= ?', [now]);
    lastRateLimitCleanup = now;
  }
  const resetAt = now + windowMs;
  await run(
    `INSERT INTO rate_limit_buckets (key_hash, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key_hash) DO UPDATE SET
       count = CASE WHEN rate_limit_buckets.reset_at <= ? THEN 1 ELSE rate_limit_buckets.count + 1 END,
       reset_at = CASE WHEN rate_limit_buckets.reset_at <= ? THEN ? ELSE rate_limit_buckets.reset_at END`,
    [keyHash, resetAt, now, now, resetAt],
  );
  const bucket = await get('SELECT count, reset_at AS resetAt FROM rate_limit_buckets WHERE key_hash = ?', [keyHash]);
  return { count: bucket.count, resetAt: bucket.resetAt };
}

async function pruneExpiredSessions() {
  const now = new Date().toISOString();
  await run('DELETE FROM sessions WHERE expires_at <= ?', [now]);
  await run('DELETE FROM admin_sessions WHERE expires_at <= ?', [now]);
}

async function resetRateLimit(keyHash) {
  return run('DELETE FROM rate_limit_buckets WHERE key_hash = ?', [keyHash]);
}

async function getPortfolioDocument(documentKey) {
  const row = await get('SELECT content_json AS contentJson FROM portfolio_documents WHERE document_key = ?', [documentKey]);
  return row ? JSON.parse(row.contentJson) : null;
}

async function savePortfolioDocument(documentKey, content) {
  if (content === null) return run('DELETE FROM portfolio_documents WHERE document_key = ?', [documentKey]);
  return run(
    `INSERT INTO portfolio_documents (document_key, content_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(document_key) DO UPDATE SET content_json = excluded.content_json, updated_at = excluded.updated_at`,
    [documentKey, JSON.stringify(content), new Date().toISOString()],
  );
}

async function savePortfolioRevision(revision) {
  await run(
    'INSERT INTO portfolio_revisions (id, created_at, content_json) VALUES (?, ?, ?)',
    [revision.id, revision.createdAt, JSON.stringify(revision.content)],
  );
  await run(
    'DELETE FROM portfolio_revisions WHERE id NOT IN (SELECT id FROM portfolio_revisions ORDER BY created_at DESC LIMIT 20)',
  );
}

async function listPortfolioRevisions() {
  return all(
    'SELECT id, created_at AS createdAt FROM portfolio_revisions ORDER BY created_at DESC LIMIT 20',
  );
}

async function getPortfolioRevision(id) {
  const row = await get('SELECT id, created_at AS createdAt, content_json AS contentJson FROM portfolio_revisions WHERE id = ?', [id]);
  return row ? { id: row.id, createdAt: row.createdAt, content: JSON.parse(row.contentJson) } : null;
}

async function getLegacyAnalytics() {
  const row = await get('SELECT content_json AS contentJson FROM legacy_analytics WHERE id = 1');
  return row ? JSON.parse(row.contentJson) : null;
}

async function saveLegacyAnalytics(data) {
  return run(
    `INSERT INTO legacy_analytics (id, content_json) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json`,
    [JSON.stringify(data)],
  );
}

async function getDatabaseStorageBytes() {
  if (isRemoteDatabase) return null;
  try {
    return fs.statSync(DATABASE_PATH).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function replaceVisitorAccounts(accounts) {
  const existing = await all('SELECT id FROM users WHERE role = ?', ['visitor']);
  const incomingIds = new Set(accounts.map((account) => account.id));
  for (const account of existing) {
    if (!incomingIds.has(account.id)) await run('DELETE FROM users WHERE id = ? AND role = ?', [account.id, 'visitor']);
  }
  for (const account of accounts) {
    await run(
      `INSERT INTO users (id, display_name, email, password_hash, password_salt, role, created_at, last_login)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         email = excluded.email,
         password_hash = excluded.password_hash,
         password_salt = excluded.password_salt,
         role = excluded.role,
         created_at = excluded.created_at`,
      [account.id, account.name, account.email, account.passwordHash, account.passwordSalt || '', 'visitor', account.createdAt],
    );
    if (account.recoveryKeySalt && account.recoveryKeyHash) {
      await setVisitorRecoveryCredential(account.id, account.recoveryKeySalt, account.recoveryKeyHash);
    }
  }
}

async function listVisitorAccounts() {
  const rows = await all('SELECT * FROM users WHERE role = ? ORDER BY created_at DESC', ['visitor']);
  return rows.map(normalizeVisitorAccount);
}

async function createVisitorAccount(account) {
  await run(
    'INSERT INTO users (id, display_name, email, password_hash, password_salt, role, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    [account.id, account.name, account.email, account.passwordHash, account.passwordSalt || '', 'visitor', account.createdAt],
  );
  return normalizeVisitorAccount({
    id: account.id,
    display_name: account.name,
    email: account.email,
    password_hash: account.passwordHash,
    password_salt: account.passwordSalt || '',
    created_at: account.createdAt,
  });
}

async function getVisitorAccountByEmail(email) {
  const row = await get('SELECT * FROM users WHERE email = ? AND role = ?', [email, 'visitor']);
  return normalizeVisitorAccount(row);
}

async function getVisitorAccountById(id) {
  const row = await get('SELECT * FROM users WHERE id = ? AND role = ?', [id, 'visitor']);
  return normalizeVisitorAccount(row);
}

async function deleteVisitorAccount(id) {
  await run('DELETE FROM users WHERE id = ? AND role = ?', [id, 'visitor']);
}

async function getAdminPasswordHash() {
  const row = await get('SELECT password_hash FROM admin_credentials WHERE id = 1');
  return row ? row.password_hash : null;
}

async function setAdminPasswordHash(passwordHash) {
  await run(
    `INSERT INTO admin_credentials (id, password_hash, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
    [passwordHash, new Date().toISOString()],
  );
  await run('DELETE FROM admin_password_reset_tokens');
}

async function setAdminPasswordResetToken(tokenHash, expiresAt) {
  await run(
    `INSERT INTO admin_password_reset_tokens (id, token_hash, expires_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
    [tokenHash, new Date(expiresAt).toISOString()],
  );
}

async function consumeAdminPasswordResetToken(tokenHash, now = Date.now()) {
  const result = await run(
    'DELETE FROM admin_password_reset_tokens WHERE id = 1 AND token_hash = ? AND expires_at > ?',
    [tokenHash, new Date(now).toISOString()],
  );
  return result.changes === 1;
}

async function getAdminDashboardSummary() {
  const counts = await get('SELECT COUNT(*) AS registeredAccounts FROM users WHERE role = ?', ['visitor']);
  const integrity = isRemoteDatabase
    ? await get('SELECT 1 AS quick_check')
    : await get('PRAGMA quick_check');
  const credentials = await get('SELECT updated_at AS passwordUpdatedAt FROM admin_credentials WHERE id = 1');
  const activity = await all(
    'SELECT action, created_at AS createdAt FROM admin_audit_log ORDER BY created_at DESC LIMIT 10',
  );
  return {
    registeredAccounts: counts.registeredAccounts,
    databaseIntegrity: integrity?.quick_check === 'ok' || Number(integrity?.quick_check) === 1 ? 'ok' : 'error',
    passwordUpdatedAt: credentials?.passwordUpdatedAt || null,
    activity,
  };
}

async function setProfileLike(clientIdHash, liked) {
  if (liked) {
    const result = await run(
      'INSERT OR IGNORE INTO profile_like_clients (client_id_hash, created_at) VALUES (?, ?)',
      [clientIdHash, new Date().toISOString()],
    );
    return result.changes === 1;
  }
  const result = await run('DELETE FROM profile_like_clients WHERE client_id_hash = ?', [clientIdHash]);
  return result.changes === 1;
}

async function recordAdminAudit(action) {
  await run(
    'INSERT INTO admin_audit_log (id, administrator_id, action, created_at) VALUES (?, ?, ?, ?)',
    [crypto.randomUUID(), 'owner', action, new Date().toISOString()],
  );
  await run(
    'DELETE FROM admin_audit_log WHERE id NOT IN (SELECT id FROM admin_audit_log ORDER BY created_at DESC LIMIT 1000)',
  );
}

async function getPortfolioExtensions() {
  const row = await get('SELECT content_json FROM portfolio_extensions WHERE id = 1');
  return row ? JSON.parse(row.content_json) : {
    certificates: [],
    seo: {},
    appearance: { accentColor: '#236653', defaultTheme: 'light' },
  };
}

async function savePortfolioExtensions(content) {
  await run(
    `INSERT INTO portfolio_extensions (id, content_json) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json`,
    [JSON.stringify(content)],
  );
}

async function listComments(status = null) {
  const query = `SELECT id, display_name AS displayName, page_key AS pageKey, message, status, created_at AS createdAt
    FROM portfolio_comments ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC LIMIT 200`;
  return all(query, status ? [status] : []);
}

async function listApprovedComments(pageKey) {
  return all(
    `SELECT id, display_name AS displayName, page_key AS pageKey, message, created_at AS createdAt
     FROM portfolio_comments WHERE status = 'approved' AND page_key = ? ORDER BY created_at DESC LIMIT 50`,
    [pageKey],
  );
}

async function addComment(comment) {
  await run(
    `INSERT INTO portfolio_comments (id, visitor_id, display_name, page_key, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [comment.id, comment.visitorId, comment.displayName, comment.pageKey, comment.message, comment.createdAt],
  );
}

async function moderateComment(id, status) {
  return run('UPDATE portfolio_comments SET status = ? WHERE id = ?', [status, id]);
}

async function deleteComment(id) {
  return run('DELETE FROM portfolio_comments WHERE id = ?', [id]);
}

async function togglePortfolioFollow(visitorId, following) {
  if (following) {
    const result = await run(
      'INSERT OR IGNORE INTO portfolio_follows (visitor_id, created_at) VALUES (?, ?)',
      [visitorId, new Date().toISOString()],
    );
    return result.changes === 1;
  }
  const result = await run('DELETE FROM portfolio_follows WHERE visitor_id = ?', [visitorId]);
  return result.changes === 1;
}

async function getPortfolioFollowSummary(visitorId = null) {
  const count = await get('SELECT COUNT(*) AS followers FROM portfolio_follows');
  const followed = visitorId
    ? Boolean(await get('SELECT visitor_id FROM portfolio_follows WHERE visitor_id = ?', [visitorId]))
    : false;
  return { followers: count.followers, following: followed };
}

async function addContactMessage(message) {
  await run(
    `INSERT INTO contact_messages (id, visitor_id, display_name, email, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [message.id, message.visitorId, message.displayName, message.email, message.message, message.createdAt],
  );
}

async function listContactMessages() {
  return all(
    `SELECT id, display_name AS displayName, email, message, created_at AS createdAt
     FROM contact_messages ORDER BY created_at DESC LIMIT 200`,
  );
}

async function deleteContactMessage(id) {
  return run('DELETE FROM contact_messages WHERE id = ?', [id]);
}

async function addPortfolioUpload(upload) {
  await run(
    `INSERT INTO portfolio_uploads (id, original_name, content_type, file_size, uploaded_at, blob_path)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       original_name = excluded.original_name,
       content_type = excluded.content_type,
       file_size = excluded.file_size,
       uploaded_at = excluded.uploaded_at,
       blob_path = excluded.blob_path`,
    [upload.id, upload.originalName, upload.contentType, upload.fileSize, upload.uploadedAt, upload.blobPath || null],
  );
}

async function listPortfolioUploads() {
  return all(
    `SELECT id, original_name AS originalName, content_type AS contentType,
            file_size AS fileSize, uploaded_at AS uploadedAt, blob_path AS blobPath
     FROM portfolio_uploads ORDER BY uploaded_at DESC LIMIT 200`,
  );
}

async function getPortfolioUpload(id) {
  return get(
    `SELECT id, original_name AS originalName, content_type AS contentType,
            file_size AS fileSize, uploaded_at AS uploadedAt, blob_path AS blobPath
     FROM portfolio_uploads WHERE id = ?`,
    [id],
  );
}

async function deletePortfolioUpload(id) {
  return run('DELETE FROM portfolio_uploads WHERE id = ?', [id]);
}

async function updatePortfolioUploadBlobPath(id, blobPath) {
  return run('UPDATE portfolio_uploads SET blob_path = ? WHERE id = ?', [blobPath, id]);
}

async function recordAnalyticsEvent(event) {
  const existingSession = await get(
    'SELECT visitor_hash, started_at FROM analytics_sessions WHERE id = ?',
    [event.sessionId],
  );
  if (existingSession && existingSession.visitor_hash !== event.visitorHash) {
    throw new Error('Analytics session does not match the visitor consent.');
  }

  if (!existingSession) {
    await run(
      `INSERT INTO analytics_visitors (visitor_hash, first_seen_at, last_seen_at, total_visits)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(visitor_hash) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         total_visits = analytics_visitors.total_visits + 1`,
      [event.visitorHash, event.createdAt, event.createdAt],
    );
    await run(
      `INSERT INTO analytics_sessions (
        id, visitor_hash, started_at, last_seen_at, landing_page, exit_page,
        authenticated, device_category, browser, operating_system, source_category, source_host
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.sessionId,
        event.visitorHash,
        event.createdAt,
        event.createdAt,
        event.pagePath,
        event.pagePath,
        event.authenticated ? 1 : 0,
        event.deviceCategory,
        event.browser,
        event.operatingSystem,
        event.sourceCategory,
        event.sourceHost,
      ],
    );
    await run(
      `INSERT INTO analytics_events (id, visitor_hash, session_id, event_type, page_path, event_label, created_at)
       VALUES (?, ?, ?, 'session_start', ?, NULL, ?)`,
      [crypto.randomUUID(), event.visitorHash, event.sessionId, event.pagePath, event.createdAt],
    );
  }

  if (event.eventType === 'session_heartbeat' || event.eventType === 'session_end') {
    const durationSeconds = Math.max(0, Math.floor(
      (Date.parse(event.createdAt) - Date.parse(existingSession?.started_at || event.createdAt)) / 1000,
    ));
    await run(
      `UPDATE analytics_sessions
       SET last_seen_at = ?, duration_seconds = MAX(duration_seconds, ?),
           ended_at = CASE WHEN ? = 'session_end' THEN ? ELSE ended_at END
       WHERE id = ? AND visitor_hash = ?`,
      [
        event.createdAt,
        durationSeconds,
        event.eventType,
        event.eventType === 'session_end' ? event.createdAt : null,
        event.sessionId,
        event.visitorHash,
      ],
    );
    return;
  }

  await run(
    `UPDATE analytics_sessions
     SET last_seen_at = ?, exit_page = ?, page_views = page_views + ?,
         authenticated = MAX(authenticated, ?)
     WHERE id = ? AND visitor_hash = ?`,
    [
      event.createdAt,
      event.pagePath,
      event.eventType === 'page_view' ? 1 : 0,
      event.authenticated ? 1 : 0,
      event.sessionId,
      event.visitorHash,
    ],
  );
  await run(
    `INSERT INTO analytics_events (id, visitor_hash, session_id, event_type, page_path, event_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      event.visitorHash,
      event.sessionId,
      event.eventType,
      event.pagePath,
      event.eventLabel,
      event.createdAt,
    ],
  );
  await run(
    `UPDATE analytics_visitors SET last_seen_at = ?
     WHERE visitor_hash = ?`,
    [event.createdAt, event.visitorHash],
  );
}

async function touchAnalyticsSession(event) {
  const session = await get(
    'SELECT started_at FROM analytics_sessions WHERE id = ? AND visitor_hash = ? AND ended_at IS NULL',
    [event.sessionId, event.visitorHash],
  );
  if (!session) return false;
  const durationSeconds = Math.max(0, Math.floor(
    (Date.parse(event.createdAt) - Date.parse(session.started_at)) / 1000,
  ));
  await run(
    `UPDATE analytics_sessions SET last_seen_at = ?, duration_seconds = MAX(duration_seconds, ?)
     WHERE id = ? AND visitor_hash = ? AND ended_at IS NULL`,
    [event.createdAt, durationSeconds, event.sessionId, event.visitorHash],
  );
  await run(
    'UPDATE analytics_visitors SET last_seen_at = ? WHERE visitor_hash = ?',
    [event.createdAt, event.visitorHash],
  );
  return true;
}

async function getActiveAnalyticsSessionCount(now = Date.now()) {
  const activeSince = new Date(now - 2 * 60 * 1000).toISOString();
  const row = await get(
    `SELECT COUNT(*) AS count FROM analytics_sessions
     WHERE ended_at IS NULL AND last_seen_at >= ?`,
    [activeSince],
  );
  return Number(row.count);
}

async function revokeAnalyticsVisitor(visitorHash) {
  await run('DELETE FROM analytics_events WHERE visitor_hash = ?', [visitorHash]);
  await run('DELETE FROM analytics_sessions WHERE visitor_hash = ?', [visitorHash]);
  await run('DELETE FROM analytics_visitors WHERE visitor_hash = ?', [visitorHash]);
}

async function pruneAnalytics(cutoff) {
  await run('DELETE FROM analytics_events WHERE created_at < ?', [cutoff]);
  await run('DELETE FROM analytics_sessions WHERE last_seen_at < ?', [cutoff]);
  await run('DELETE FROM analytics_visitors WHERE last_seen_at < ?', [cutoff]);
  await run('DELETE FROM analytics_daily_summaries WHERE day < ?', [cutoff.slice(0, 10)]);
}

async function getAnalyticsSnapshot(period, now = new Date().toISOString()) {
  const { from, until } = period;
  const periodParams = [from, until];
  const [
    traffic,
    engagement,
    dailyVisits,
    dailyViews,
    dailyEngagement,
    pages,
    devices,
    sources,
    landingPages,
    exitPages,
    popularProjects,
    popularSections,
    browsers,
    operatingSystems,
    sessions,
    returning,
    activeVisitors,
    security,
    activity,
    visitorStats,
    visitorEvents,
  ] = await Promise.all([
    get(
      `SELECT COUNT(*) AS totalVisitors, COUNT(DISTINCT visitor_hash) AS uniqueVisitors
       FROM analytics_sessions WHERE started_at >= ? AND started_at < ?`,
      periodParams,
    ),
    all(
      `SELECT event_type AS eventType, SUM(event_count) AS count FROM analytics_daily_summaries
       WHERE event_type NOT IN ('session_start', 'session_heartbeat', 'session_end')
         AND day >= substr(?, 1, 10) AND day < substr(?, 1, 10)
       GROUP BY event_type ORDER BY count DESC`,
      periodParams,
    ),
    all(
      `SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS count
       FROM analytics_sessions WHERE started_at >= ? AND started_at < ?
       GROUP BY substr(started_at, 1, 10) ORDER BY day`,
      periodParams,
    ),
    all(
      `SELECT day, SUM(event_count) AS count FROM analytics_daily_summaries
       WHERE event_type = 'page_view' AND day >= substr(?, 1, 10) AND day < substr(?, 1, 10)
       GROUP BY day ORDER BY day`,
      periodParams,
    ),
    all(
      `SELECT day, SUM(event_count) AS count FROM analytics_daily_summaries
       WHERE event_type NOT IN ('page_view', 'session_heartbeat', 'session_end', 'session_start')
         AND day >= substr(?, 1, 10) AND day < substr(?, 1, 10)
       GROUP BY day ORDER BY day`,
      periodParams,
    ),
    all(
      `SELECT event_key AS key, SUM(event_count) AS count FROM analytics_daily_summaries
       WHERE event_type = 'page_view' AND day >= substr(?, 1, 10) AND day < substr(?, 1, 10)
       GROUP BY event_key ORDER BY count DESC LIMIT 20`,
      periodParams,
    ),
    all(
      `SELECT device_category AS key, COUNT(*) AS count FROM analytics_sessions
       WHERE started_at >= ? AND started_at < ? GROUP BY device_category ORDER BY count DESC`,
      periodParams,
    ),
    all(
      `SELECT source_category AS category, COALESCE(source_host, 'Direct') AS key, COUNT(*) AS count
       FROM analytics_sessions WHERE started_at >= ? AND started_at < ?
       GROUP BY source_category, source_host ORDER BY count DESC LIMIT 20`,
      periodParams,
    ),
    all(
      `SELECT landing_page AS key, COUNT(*) AS count FROM analytics_sessions
       WHERE started_at >= ? AND started_at < ? GROUP BY landing_page ORDER BY count DESC LIMIT 10`,
      periodParams,
    ),
    all(
      `SELECT exit_page AS key, COUNT(*) AS count FROM analytics_sessions
       WHERE started_at >= ? AND started_at < ? GROUP BY exit_page ORDER BY count DESC LIMIT 10`,
      periodParams,
    ),
    all(
      `SELECT event_key AS label, SUM(event_count) AS count FROM analytics_daily_summaries
       WHERE event_type = 'project_click' AND day >= substr(?, 1, 10) AND day < substr(?, 1, 10)
       GROUP BY event_key ORDER BY count DESC LIMIT 10`,
      periodParams,
    ),
    all(
      `SELECT event_key AS label, SUM(event_count) AS count FROM analytics_daily_summaries
       WHERE event_type = 'section_view' AND day >= substr(?, 1, 10) AND day < substr(?, 1, 10)
       GROUP BY event_key ORDER BY count DESC LIMIT 10`,
      periodParams,
    ),
    all(
      `SELECT browser AS key, COUNT(*) AS count FROM analytics_sessions
       WHERE started_at >= ? AND started_at < ? GROUP BY browser ORDER BY count DESC LIMIT 10`,
      periodParams,
    ),
    all(
      `SELECT operating_system AS key, COUNT(*) AS count FROM analytics_sessions
       WHERE started_at >= ? AND started_at < ? GROUP BY operating_system ORDER BY count DESC LIMIT 10`,
      periodParams,
    ),
    get(
      `SELECT
         COUNT(*) AS visits,
         AVG(CASE WHEN ended_at IS NOT NULL THEN duration_seconds
             ELSE MAX(duration_seconds, CAST((julianday(last_seen_at) - julianday(started_at)) * 86400 AS INTEGER))
         END) AS averageDuration,
         SUM(CASE WHEN page_views <= 1 THEN 1 ELSE 0 END) AS bounces,
         SUM(page_views) AS pageViews,
         SUM(CASE WHEN authenticated = 1 THEN 1 ELSE 0 END) AS authenticatedSessions
       FROM analytics_sessions WHERE started_at >= ? AND started_at < ?`,
      periodParams,
    ),
    get(
      `SELECT COUNT(DISTINCT s.visitor_hash) AS count FROM analytics_sessions s
       JOIN analytics_visitors v ON v.visitor_hash = s.visitor_hash
       WHERE s.started_at >= ? AND s.started_at < ? AND v.first_seen_at < ?`,
      [from, until, from],
    ),
    get(
      `SELECT COUNT(DISTINCT visitor_hash) AS count FROM analytics_sessions
       WHERE ended_at IS NULL AND last_seen_at >= ?`,
      [new Date(Date.parse(now) - 2 * 60 * 1000).toISOString()],
    ),
    get(
      `SELECT
         SUM(CASE WHEN action = 'admin_login_failed' THEN 1 ELSE 0 END) AS failedLoginAttempts,
         SUM(CASE WHEN action = 'admin_login_rate_limited' THEN 1 ELSE 0 END) AS suspiciousRequests
       FROM admin_audit_log WHERE created_at >= ? AND created_at < ?`,
      periodParams,
    ),
    all(
      `SELECT event_type AS eventType, page_path AS pagePath, event_label AS eventLabel, created_at AS createdAt
       FROM analytics_events WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at DESC LIMIT 50`,
      periodParams,
    ),
    all(
      `SELECT s.visitor_hash AS visitorHash, MAX(s.authenticated) AS authenticated,
              COUNT(*) AS visits, SUM(s.page_views) AS pageViews,
              SUM(s.duration_seconds) AS durationSeconds
       FROM analytics_sessions s WHERE s.started_at >= ? AND s.started_at < ?
       GROUP BY s.visitor_hash`,
      periodParams,
    ),
    all(
      `SELECT visitor_hash AS visitorHash, SUM(CASE WHEN event_type = 'project_click' THEN 1 ELSE 0 END) AS projectClicks
       FROM analytics_events WHERE created_at >= ? AND created_at < ?
       GROUP BY visitor_hash`,
      periodParams,
    ),
  ]);
  const eventCounts = Object.fromEntries(engagement.map((entry) => [entry.eventType, entry.count]));
  const eventByVisitor = new Map(visitorEvents.map((entry) => [entry.visitorHash, entry.projectClicks]));
  const rankings = visitorStats.map((visitor) => {
    const projectClicks = eventByVisitor.get(visitor.visitorHash) || 0;
    const durationSeconds = Math.round(visitor.durationSeconds || 0);
    return {
      authenticated: Boolean(visitor.authenticated),
      visits: visitor.visits,
      pageViews: visitor.pageViews || 0,
      durationSeconds,
      projectClicks,
      score: visitor.visits * 2 + (visitor.pageViews || 0) + Math.floor(durationSeconds / 60) + projectClicks * 5,
    };
  }).sort((a, b) => b.score - a.score).slice(0, 10);

  const pagesByLabel = {
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
  const days = [];
  const firstDay = new Date(`${from.slice(0, 10)}T00:00:00.000Z`);
  const lastDay = new Date(Date.parse(until) - 1);
  for (const date = new Date(firstDay); date <= lastDay; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    days.push({
      day,
      visits: dailyVisits.find((row) => row.day === day)?.count || 0,
      pageViews: dailyViews.find((row) => row.day === day)?.count || 0,
      engagements: dailyEngagement.find((row) => row.day === day)?.count || 0,
    });
  }

  return {
    totals: {
      totalVisitors: traffic.totalVisitors || 0,
      uniqueVisitors: traffic.uniqueVisitors || 0,
      activeVisitors: activeVisitors.count || 0,
      pageViews: dailyViews.reduce((sum, row) => sum + row.count, 0),
      returningVisitors: returning.count || 0,
      averageSessionDuration: Math.round(sessions.averageDuration || 0),
      bounceRate: sessions.visits ? Math.round((sessions.bounces / sessions.visits) * 100) : 0,
      cvDownloads: eventCounts.cv_download || 0,
      contactSubmissions: eventCounts.contact_submission || 0,
      visits: sessions.visits || 0,
      authenticatedSessions: sessions.authenticatedSessions || 0,
      failedAdminLogins: security.failedLoginAttempts || 0,
      suspiciousRequests: security.suspiciousRequests || 0,
    },
    daily: days,
    pages: pages.map((row) => ({ ...row, label: pagesByLabel[row.key] || row.key })),
    devices,
    sources,
    landingPages,
    exitPages,
    popularProjects,
    popularSections,
    browsers,
    operatingSystems,
    engagement,
    projectClicks: eventCounts.project_click || 0,
    rankings,
    activity,
  };
}

module.exports = {
  DATABASE_PATH,
  isRemoteDatabase,
  initializeDatabase,
  createVisitorSession,
  getVisitorSession,
  deleteVisitorSession,
  deleteVisitorSessionsForUser,
  setVisitorPasswordResetToken,
  getVisitorRecoveryCredential,
  setVisitorRecoveryCredential,
  consumeVisitorPasswordResetToken,
  updateVisitorPassword,
  createAdminSession,
  getAdminSession,
  deleteAdminSession,
  clearAdminSessions,
  getAdminSessionCount,
  consumeRateLimit,
  pruneExpiredSessions,
  resetRateLimit,
  getPortfolioDocument,
  savePortfolioDocument,
  savePortfolioRevision,
  listPortfolioRevisions,
  getPortfolioRevision,
  getLegacyAnalytics,
  saveLegacyAnalytics,
  getDatabaseStorageBytes,
  replaceVisitorAccounts,
  listVisitorAccounts,
  createVisitorAccount,
  getVisitorAccountByEmail,
  getVisitorAccountById,
  deleteVisitorAccount,
  getAdminPasswordHash,
  setAdminPasswordHash,
  setAdminPasswordResetToken,
  consumeAdminPasswordResetToken,
  getAdminDashboardSummary,
  setProfileLike,
  recordAdminAudit,
  getPortfolioExtensions,
  savePortfolioExtensions,
  listComments,
  listApprovedComments,
  addComment,
  moderateComment,
  deleteComment,
  togglePortfolioFollow,
  getPortfolioFollowSummary,
  addContactMessage,
  listContactMessages,
  deleteContactMessage,
  addPortfolioUpload,
  listPortfolioUploads,
  getPortfolioUpload,
  deletePortfolioUpload,
  updatePortfolioUploadBlobPath,
  recordAnalyticsEvent,
  touchAnalyticsSession,
  getActiveAnalyticsSessionCount,
  revokeAnalyticsVisitor,
  pruneAnalytics,
  getAnalyticsSnapshot,
  db,
};
