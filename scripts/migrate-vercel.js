const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function loadEnvironmentFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}

loadEnvironmentFile(path.join(root, '.env'));
loadEnvironmentFile(path.join(root, '.env.local'));

const { createClient } = require('@libsql/client');
const sqlite3 = require('sqlite3').verbose();
const database = require('../database.js');
const { put } = require('@vercel/blob');

const sourcePath = path.join(root, 'data', 'portfolio.db');
const tableNames = [
  'users',
  'sessions',
  'analytics_consent',
  'visitor_analytics',
  'page_statistics',
  'admin_audit_log',
  'admin_credentials',
  'profile_like_clients',
  'portfolio_extensions',
  'portfolio_comments',
  'portfolio_follows',
  'contact_messages',
  'portfolio_uploads',
  'analytics_visitors',
  'analytics_sessions',
  'analytics_events',
  'analytics_daily_summaries',
  'admin_sessions',
  'rate_limit_buckets',
  'portfolio_documents',
  'portfolio_revisions',
  'legacy_analytics',
];

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function sqliteClose(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function copyTable(source, target, tableName) {
  const exists = await sqliteAll(
    source,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );
  if (!exists.length) return 0;
  const rows = await sqliteAll(source, `SELECT * FROM "${tableName}"`);
  if (!rows.length) return 0;

  const columns = Object.keys(rows[0]);
  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const conflictMode = ['admin_credentials', 'portfolio_extensions', 'analytics_daily_summaries', 'legacy_analytics']
    .includes(tableName) ? 'REPLACE' : 'IGNORE';
  const statement = `INSERT OR ${conflictMode} INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders})`;

  for (let offset = 0; offset < rows.length; offset += 100) {
    const transaction = await target.transaction('write');
    try {
      for (const row of rows.slice(offset, offset + 100)) {
        await transaction.execute({ sql: statement, args: columns.map((column) => row[column]) });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  return rows.length;
}

async function main() {
  if (!database.isRemoteDatabase) {
    throw new Error('Set TURSO_DATABASE_URL to your remote libSQL database before running this migration.');
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Set BLOB_READ_WRITE_TOKEN before migrating private uploaded documents.');
  }
  if (!fs.existsSync(sourcePath)) throw new Error(`Local database not found: ${sourcePath}`);

  await database.initializeDatabase();
  const target = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const source = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY);
  const migratedCounts = {};

  try {
    for (const tableName of tableNames.filter((name) => name !== 'analytics_daily_summaries')) {
      migratedCounts[tableName] = await copyTable(source, target, tableName);
    }
    migratedCounts.analytics_daily_summaries = await copyTable(source, target, 'analytics_daily_summaries');

    const published = readJson(path.join(root, 'data', 'portfolio.json'));
    if (published && !await database.getPortfolioDocument('published')) {
      await database.savePortfolioDocument('published', published);
    }
    const draft = readJson(path.join(root, 'data', 'portfolio.draft.json'));
    if (draft && !await database.getPortfolioDocument('draft')) {
      await database.savePortfolioDocument('draft', draft);
    }
    const oldRevisionsDirectory = path.join(root, 'data', 'portfolio-revisions');
    if ((await database.listPortfolioRevisions()).length === 0 && fs.existsSync(oldRevisionsDirectory)) {
      const revisions = fs.readdirSync(oldRevisionsDirectory)
        .filter((name) => /^\d{13}-[0-9a-f-]{36}\.json$/i.test(name))
        .sort();
      for (const name of revisions) {
        const revision = readJson(path.join(oldRevisionsDirectory, name));
        if (revision?.id && revision.createdAt && revision.content) {
          await database.savePortfolioRevision(revision);
        }
      }
    }
    const legacyAnalytics = readJson(path.join(root, 'data', 'analytics.json'));
    if (legacyAnalytics && !await database.getLegacyAnalytics()) {
      await database.saveLegacyAnalytics(legacyAnalytics);
    }
    const visitorAccounts = readJson(path.join(root, 'data', 'visitor-accounts.json'));
    if (visitorAccounts?.accounts?.length && !(await database.listVisitorAccounts()).length) {
      await database.replaceVisitorAccounts(visitorAccounts.accounts);
    }

    const uploads = await database.listPortfolioUploads();
    let uploadedFileCount = 0;
    for (const upload of uploads) {
      if (upload.blobPath) continue;
      const extension = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'application/pdf': 'pdf',
      }[upload.contentType];
      if (!extension) throw new Error(`Unsupported file type in upload metadata: ${upload.id}`);
      const localFile = path.join(root, 'uploads', `${upload.id}.${extension}`);
      if (!fs.existsSync(localFile)) {
        throw new Error(`Upload file is missing and cannot be migrated: ${localFile}`);
      }
      const blob = await put(`portfolio/${upload.id}.${extension}`, fs.readFileSync(localFile), {
        access: 'private',
        addRandomSuffix: false,
        contentType: upload.contentType,
      });
      await database.updatePortfolioUploadBlobPath(upload.id, blob.pathname);
      uploadedFileCount += 1;
    }

    console.log('Migration completed. Imported table row counts:', migratedCounts);
    console.log(`Migrated ${uploadedFileCount} upload file(s) to private Vercel Blob storage.`);
    console.log('Local source files were left unchanged.');
  } finally {
    await sqliteClose(source);
    target.close();
  }
}

main().catch((error) => {
  console.error('Vercel data migration failed:', error.message);
  process.exitCode = 1;
});
