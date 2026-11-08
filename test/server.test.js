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

process.env.ADMIN_PASSWORD = 'test-only-admin-password';
process.env.ADMIN_PASSWORD_HASH = '';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-only-session-secret-that-is-long-enough';
process.env.ADMIN_RECOVERY_KEY = 'test-only-admin-recovery-key-that-is-long-enough';
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

test('admin and visitor sign-in protect and load their required pages', async () => {
  const adminOrigin = { Origin: baseUrl };
  const failedAdminLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { ...adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  assert.equal(failedAdminLogin.status, 401);

  const adminLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { ...adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(adminLogin.status, 200);
  const adminSetCookie = adminLogin.headers.get('set-cookie');
  assert.match(adminSetCookie, /HttpOnly/i);
  assert.match(adminSetCookie, /SameSite=Strict/i);
  assert.match(adminSetCookie, /Path=\//i);
  assert.match(adminSetCookie, /Max-Age=1800/i);
  const adminCookie = adminSetCookie.split(';', 1)[0];
  const adminPage = await fetch(`${baseUrl}/api/admin/portfolio/draft`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(adminPage.status, 200);
  const dashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(dashboard.status, 200);
  const signOut = await fetch(`${baseUrl}/api/admin/logout`, {
    method: 'POST',
    headers: { ...adminOrigin, Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(signOut.status, 200);
  const signedOutSession = await fetch(`${baseUrl}/api/admin/session`);
  assert.deepEqual(await signedOutSession.json(), { authenticated: false });

  const blockedPage = await fetch(`${baseUrl}/projects.html`, { redirect: 'manual' });
  assert.equal(blockedPage.status, 302);
  assert.match(blockedPage.headers.get('location'), /^\/account\.html\?next=/);

  const visitorEmail = `test-${crypto.randomUUID()}@example.invalid`;
  const registration = await fetch(`${baseUrl}/api/visitor/register`, {
    method: 'POST',
    headers: { ...adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Visitor',
      email: visitorEmail,
      password: 'test-only-visitor-password',
      recoveryKey: 'test-only-visitor-recovery-key',
      recoveryKeyConfirmation: 'test-only-visitor-recovery-key',
      privacyAccepted: true,
    }),
  });
  assert.equal(registration.status, 201);
  const visitorCookie = registration.headers.get('set-cookie').split(';', 1)[0];
  const visitorPage = await fetch(`${baseUrl}/projects.html`, { headers: { Cookie: visitorCookie } });
  assert.equal(visitorPage.status, 200);
  assert.match(visitorPage.headers.get('content-type'), /text\/html/);
  const homepage = await fetch(`${baseUrl}/`, { headers: { Cookie: visitorCookie } });
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /liveVisitorBadge/);
  const stylesheet = await fetch(`${baseUrl}/style.css`, { headers: { Cookie: visitorCookie } });
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  const featureScript = await fetch(`${baseUrl}/features.js`, { headers: { Cookie: visitorCookie } });
  assert.equal(featureScript.status, 200);
  assert.match(featureScript.headers.get('content-type'), /javascript/);

  const contactWithoutOrigin = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { Cookie: visitorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Visitor', email: visitorEmail, message: 'Hello there.' }),
  });
  assert.equal(contactWithoutOrigin.status, 403);
  const invalidContact = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { ...adminOrigin, Cookie: visitorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'A', email: 'not-an-email', message: 'x' }),
  });
  assert.equal(invalidContact.status, 400);
  const contact = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { ...adminOrigin, Cookie: visitorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Visitor Contact',
      email: visitorEmail,
      message: 'A valid contact request.',
    }),
  });
  assert.equal(contact.status, 201);
  const storedMessages = await database.listContactMessages();
  assert.equal(storedMessages[0].displayName, 'Test Visitor Contact');
  assert.equal(storedMessages[0].email, visitorEmail);

  const consent = await fetch(`${baseUrl}/api/analytics/consent`, {
    method: 'POST',
    headers: { ...adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId: crypto.randomUUID() }),
  });
  assert.equal(consent.status, 200);
  const consentCookie = consent.headers.get('set-cookie').split(';', 1)[0];
  const analyticsSessionId = crypto.randomUUID();
  const analyticsEvent = (eventType) => fetch(`${baseUrl}/api/analytics/event`, {
    method: 'POST',
    headers: {
      ...adminOrigin,
      Cookie: consentCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ eventType, sessionId: analyticsSessionId, pagePath: 'index.html' }),
  });
  assert.equal((await analyticsEvent('page_view')).status, 200);
  assert.equal((await analyticsEvent('session_heartbeat')).status, 200);
  const liveVisitors = await fetch(`${baseUrl}/api/analytics/live-visitors`);
  assert.equal(liveVisitors.status, 200);
  assert.deepEqual(await liveVisitors.json(), { activeVisitors: 1 });

  const failedVisitorLogin = await fetch(`${baseUrl}/api/visitor/login`, {
    method: 'POST',
    headers: { ...adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: visitorEmail, password: 'wrong-password' }),
  });
  assert.equal(failedVisitorLogin.status, 401);
  const visitorLogin = await fetch(`${baseUrl}/api/visitor/login`, {
    method: 'POST',
    headers: { ...adminOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: visitorEmail, password: 'test-only-visitor-password' }),
  });
  assert.equal(visitorLogin.status, 200);
});

test('admin password recovery uses a one-time token and revokes existing sessions', async () => {
  const adminOrigin = { Origin: baseUrl, 'Content-Type': 'application/json' };
  const currentLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(currentLogin.status, 200);
  const existingAdminCookie = currentLogin.headers.get('set-cookie').split(';', 1)[0];

  const wrongOrigin = await fetch(`${baseUrl}/api/admin/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recoveryKey: process.env.ADMIN_RECOVERY_KEY }),
  });
  assert.equal(wrongOrigin.status, 403);

  const rejectedRecovery = await fetch(`${baseUrl}/api/admin/forgot-password`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({ recoveryKey: 'incorrect-recovery-key' }),
  });
  assert.equal(rejectedRecovery.status, 200);
  assert.equal((await rejectedRecovery.json()).resetToken, null);

  const requestResetToken = async () => fetch(`${baseUrl}/api/admin/forgot-password`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({ recoveryKey: process.env.ADMIN_RECOVERY_KEY }),
  });
  const firstRecovery = await requestResetToken();
  const firstToken = (await firstRecovery.json()).resetToken;
  assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/);
  const secondRecovery = await requestResetToken();
  const secondToken = (await secondRecovery.json()).resetToken;
  assert.notEqual(secondToken, firstToken);

  const mismatchedPasswords = await fetch(`${baseUrl}/api/admin/reset-password`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({
      resetToken: secondToken,
      newPassword: 'new-test-only-admin-password',
      confirmPassword: 'different-test-only-password',
    }),
  });
  assert.equal(mismatchedPasswords.status, 400);

  const staleTokenReset = await fetch(`${baseUrl}/api/admin/reset-password`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({
      resetToken: firstToken,
      newPassword: 'new-test-only-admin-password',
      confirmPassword: 'new-test-only-admin-password',
    }),
  });
  assert.equal(staleTokenReset.status, 400);

  const reset = await fetch(`${baseUrl}/api/admin/reset-password`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({
      resetToken: secondToken,
      newPassword: 'new-test-only-admin-password',
      confirmPassword: 'new-test-only-admin-password',
    }),
  });
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { reset: true });

  const reusedToken = await fetch(`${baseUrl}/api/admin/reset-password`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({
      resetToken: secondToken,
      newPassword: 'another-test-only-admin-password',
      confirmPassword: 'another-test-only-admin-password',
    }),
  });
  assert.equal(reusedToken.status, 400);

  const oldSession = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: existingAdminCookie },
  });
  assert.deepEqual(await oldSession.json(), { authenticated: false });

  const oldPasswordLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: adminOrigin,
    body: JSON.stringify({ password: 'new-test-only-admin-password' }),
  });
  assert.equal(newPasswordLogin.status, 200);
});

test('visitor password recovery verifies the account recovery key and revokes all sessions', async () => {
  const origin = { Origin: baseUrl, 'Content-Type': 'application/json' };
  const email = `recovery-${crypto.randomUUID()}@example.invalid`;
  const originalPassword = 'visitor-original-test-password';
  const recoveryKey = 'visitor-private-test-recovery-key';
  const registration = await fetch(`${baseUrl}/api/visitor/register`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({
      name: 'Recovery Visitor',
      email,
      password: originalPassword,
      recoveryKey,
      recoveryKeyConfirmation: recoveryKey,
      privacyAccepted: true,
    }),
  });
  assert.equal(registration.status, 201);
  const registrationCookie = registration.headers.get('set-cookie').split(';', 1)[0];

  const otherSessionLogin = await fetch(`${baseUrl}/api/visitor/login`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({ email, password: originalPassword }),
  });
  assert.equal(otherSessionLogin.status, 200);
  const otherSessionCookie = otherSessionLogin.headers.get('set-cookie').split(';', 1)[0];

  const wrongOrigin = await fetch(`${baseUrl}/api/user/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, recoveryKey }),
  });
  assert.equal(wrongOrigin.status, 403);

  const wrongRecoveryKey = await fetch(`${baseUrl}/api/user/forgot-password`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({ email, recoveryKey: 'incorrect-visitor-recovery-key' }),
  });
  assert.equal(wrongRecoveryKey.status, 200);
  assert.equal((await wrongRecoveryKey.json()).resetToken, null);

  const requestRecovery = (requestEmail, requestKey) => fetch(`${baseUrl}/api/user/forgot-password`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({ email: requestEmail, recoveryKey: requestKey }),
  });
  const recoveryResponse = await requestRecovery(email, recoveryKey);
  assert.equal(recoveryResponse.status, 200);
  let { resetToken } = await recoveryResponse.json();
  assert.match(resetToken, /^[A-Za-z0-9_-]{43}$/);

  const visitorAccount = await database.getVisitorAccountByEmail(email);
  const resetTokenHash = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(`visitor:${resetToken}`)
    .digest('hex');
  await database.setVisitorPasswordResetToken(resetTokenHash, visitorAccount.id, Date.now() - 1);
  const expiredReset = await fetch(`${baseUrl}/api/user/reset-password`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({
      resetToken,
      newPassword: 'visitor-new-test-password',
      confirmPassword: 'visitor-new-test-password',
    }),
  });
  assert.equal(expiredReset.status, 400);

  const refreshedRecovery = await requestRecovery(email, recoveryKey);
  resetToken = (await refreshedRecovery.json()).resetToken;

  const mismatchedPassword = await fetch(`${baseUrl}/api/user/reset-password`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({
      resetToken,
      newPassword: 'visitor-new-test-password',
      confirmPassword: 'different-visitor-password',
    }),
  });
  assert.equal(mismatchedPassword.status, 400);

  const reset = await fetch(`${baseUrl}/api/user/reset-password`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({
      resetToken,
      newPassword: 'visitor-new-test-password',
      confirmPassword: 'visitor-new-test-password',
    }),
  });
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { reset: true });
  assert.match(reset.headers.get('set-cookie'), /HttpOnly/i);

  for (const cookie of [registrationCookie, otherSessionCookie]) {
    const session = await fetch(`${baseUrl}/api/visitor/session`, {
      headers: { Cookie: cookie },
    });
    assert.deepEqual(await session.json(), { authenticated: false, account: null });
  }

  const reusedToken = await fetch(`${baseUrl}/api/user/reset-password`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({
      resetToken,
      newPassword: 'visitor-another-test-password',
      confirmPassword: 'visitor-another-test-password',
    }),
  });
  assert.equal(reusedToken.status, 400);

  const oldPasswordLogin = await fetch(`${baseUrl}/api/visitor/login`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({ email, password: originalPassword }),
  });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await fetch(`${baseUrl}/api/visitor/login`, {
    method: 'POST',
    headers: origin,
    body: JSON.stringify({ email, password: 'visitor-new-test-password' }),
  });
  assert.equal(newPasswordLogin.status, 200);
  const signedInCookie = newPasswordLogin.headers.get('set-cookie').split(';', 1)[0];

  const changedRecoveryKey = 'visitor-updated-test-recovery-key';
  const updateRecoveryKey = await fetch(`${baseUrl}/api/visitor/recovery-key`, {
    method: 'POST',
    headers: { ...origin, Cookie: signedInCookie },
    body: JSON.stringify({
      currentPassword: 'visitor-new-test-password',
      recoveryKey: changedRecoveryKey,
      recoveryKeyConfirmation: changedRecoveryKey,
    }),
  });
  assert.equal(updateRecoveryKey.status, 200);

  const obsoleteRecoveryKey = await requestRecovery(email, recoveryKey);
  assert.equal((await obsoleteRecoveryKey.json()).resetToken, null);
  const currentRecoveryKey = await requestRecovery(email, changedRecoveryKey);
  assert.match((await currentRecoveryKey.json()).resetToken, /^[A-Za-z0-9_-]{43}$/);
});
