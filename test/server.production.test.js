const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, test } = require('node:test');

const originalEnvironment = {
  adminPassword: process.env.ADMIN_PASSWORD,
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
  databaseUrl: process.env.TURSO_DATABASE_URL,
  databaseToken: process.env.TURSO_AUTH_TOKEN,
  nodeEnv: process.env.NODE_ENV,
  adminRecoveryKey: process.env.ADMIN_RECOVERY_KEY,
  sessionSecret: process.env.SESSION_SECRET,
  vercel: process.env.VERCEL,
};

process.env.ADMIN_PASSWORD = 'prod-test-admin-password-12345';
process.env.ADMIN_PASSWORD_HASH = '';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = 'prod-test-session-secret-that-is-long-enough';
process.env.ADMIN_RECOVERY_KEY = 'prod-test-admin-recovery-key-that-is-long-enough';
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;

const { handleRequest, initializeApplication } = require('../server.js');
const database = require('../database.js');
let server;
let baseUrl;

before(async () => {
  await initializeApplication();
  server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error('Test request failed:', error);
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await database.db.close();
  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('ADMIN_PASSWORD', originalEnvironment.adminPassword);
  restore('ADMIN_PASSWORD_HASH', originalEnvironment.adminPasswordHash);
  restore('TURSO_DATABASE_URL', originalEnvironment.databaseUrl);
  restore('TURSO_AUTH_TOKEN', originalEnvironment.databaseToken);
  restore('NODE_ENV', originalEnvironment.nodeEnv);
  restore('ADMIN_RECOVERY_KEY', originalEnvironment.adminRecoveryKey);
  restore('SESSION_SECRET', originalEnvironment.sessionSecret);
  restore('VERCEL', originalEnvironment.vercel);
});

test('production admin login sets SameSite=None Secure cookie', async () => {
  const adminOrigin = { Origin: baseUrl };
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { ...adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);

  const setCookie = login.headers.get('set-cookie');
  assert.ok(setCookie, 'Expected Set-Cookie header on login response');

  // Production mode: SameSite=None + Secure required
  assert.match(setCookie, /SameSite=None/i, 'Expected SameSite=None in production');
  assert.match(setCookie, /Secure/i, 'Expected Secure flag in production');
  assert.match(setCookie, /HttpOnly/i, 'Expected HttpOnly flag');
  assert.match(setCookie, /Path=\//i, 'Expected Path=/');
  assert.match(setCookie, /Max-Age=1800/i, 'Expected Max-Age=1800');

  const adminCookie = setCookie.split(';', 1)[0];

  // Authenticated request succeeds with the cookie
  const session = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: adminCookie },
  });
  assert.deepEqual(await session.json(), { authenticated: true });

  const draft = await fetch(`${baseUrl}/api/admin/portfolio/draft`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(draft.status, 200);

  // Logout clears cookie with SameSite=None Secure in production
  const logout = await fetch(`${baseUrl}/api/admin/logout`, {
    method: 'POST',
    headers: { ...adminOrigin, Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(logout.status, 200);
  const logoutCookie = logout.headers.get('set-cookie');
  assert.ok(logoutCookie, 'Expected Set-Cookie header on logout response');
  assert.match(logoutCookie, /SameSite=None/i, 'Expected SameSite=None on logout cookie in production');
  assert.match(logoutCookie, /Secure/i, 'Expected Secure flag on logout cookie in production');
  assert.match(logoutCookie, /Max-Age=0/i, 'Expected Max-Age=0 on logout cookie');

  // Session is cleared
  const signedOutSession = await fetch(`${baseUrl}/api/admin/session`);
  assert.deepEqual(await signedOutSession.json(), { authenticated: false });
});

test('production admin login origin validation blocks cross-origin state-changing requests', async () => {
  const adminOrigin = { Origin: baseUrl };

  // Login first to get a valid cookie
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { ...adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get('set-cookie').split(';', 1)[0];

  // Cross-origin POST to admin endpoint should be blocked
  const crossOriginRequest = await fetch(`${baseUrl}/api/admin/session`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example.com',
      Cookie: adminCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  assert.equal(crossOriginRequest.status, 403, 'Expected 403 for cross-origin state-changing request');
});
