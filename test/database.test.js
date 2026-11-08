const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

const previousUrl = process.env.TURSO_DATABASE_URL;
const previousToken = process.env.TURSO_AUTH_TOKEN;
process.env.TURSO_DATABASE_URL = 'file::memory:';
delete process.env.TURSO_AUTH_TOKEN;
const database = require('../database.js');
const account = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test Visitor',
  email: 'test@example.invalid',
  passwordHash: 'test-hash',
  passwordSalt: 'test-salt',
  createdAt: new Date().toISOString(),
};

before(async () => {
  await database.initializeDatabase();
});

after(async () => {
  await database.db.close();
  if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = previousUrl;
  if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
  else process.env.TURSO_AUTH_TOKEN = previousToken;
});

test('persists account sessions, rate limits, portfolio state, and uploaded-file metadata', async () => {
  await database.createVisitorAccount(account);
  assert.equal((await database.getVisitorAccountByEmail(account.email)).id, account.id);

  const tokenHash = 'a'.repeat(64);
  await database.createVisitorSession(tokenHash, account.id, Date.now() + 60_000);
  assert.equal((await database.getVisitorSession(tokenHash)).accountId, account.id);

  assert.equal((await database.consumeRateLimit('b'.repeat(64), 60_000)).count, 1);
  assert.equal((await database.consumeRateLimit('b'.repeat(64), 60_000)).count, 2);

  const content = { name: 'Test Portfolio' };
  await database.savePortfolioDocument('published', content);
  assert.deepEqual(await database.getPortfolioDocument('published'), content);

  const revision = {
    id: `${Date.now()}-11111111-1111-4111-8111-111111111111`,
    createdAt: new Date().toISOString(),
    content,
  };
  await database.savePortfolioRevision(revision);
  assert.deepEqual(await database.getPortfolioRevision(revision.id), revision);

  await database.addPortfolioUpload({
    id: '22222222-2222-4222-8222-222222222222',
    originalName: 'resume.pdf',
    contentType: 'application/pdf',
    fileSize: 128,
    uploadedAt: new Date().toISOString(),
    blobPath: 'portfolio/resume.pdf',
  });
  assert.equal((await database.getPortfolioUpload('22222222-2222-4222-8222-222222222222')).blobPath, 'portfolio/resume.pdf');

  await database.deleteVisitorAccount(account.id);
  assert.equal(await database.getVisitorSession(tokenHash), null);
});

test('counts multiple page views in one analytics session as one visit', async () => {
  const visitorHash = 'c'.repeat(64);
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const firstViewAt = new Date();
  const event = {
    visitorHash,
    sessionId,
    eventType: 'page_view',
    pagePath: 'index.html',
    eventLabel: null,
    authenticated: false,
    deviceCategory: 'desktop',
    browser: 'Test',
    operatingSystem: 'Test',
    sourceCategory: 'direct',
    sourceHost: null,
  };
  await database.recordAnalyticsEvent({ ...event, createdAt: firstViewAt.toISOString() });
  await database.recordAnalyticsEvent({
    ...event,
    pagePath: 'projects.html',
    createdAt: new Date(firstViewAt.getTime() + 1_000).toISOString(),
  });

  const from = new Date(firstViewAt);
  from.setUTCHours(0, 0, 0, 0);
  const until = new Date(from);
  until.setUTCDate(until.getUTCDate() + 1);
  const report = await database.getAnalyticsSnapshot({
    from: from.toISOString(),
    until: until.toISOString(),
  }, new Date(firstViewAt.getTime() + 2_000).toISOString());

  assert.equal(report.totals.visits, 1);
  assert.equal(report.totals.pageViews, 2);
});
