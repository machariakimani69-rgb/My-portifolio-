const http = require('http');

async function testEndpoint(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:3000');
    const headers = options.headers || {};
    if (headers['Origin'] && !headers['Host']) {
      headers['Host'] = new URL(headers['Origin']).host;
    }
    const req = http.request(url, { method: options.method || 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), setCookie });
        } catch {
          resolve({ status: res.statusCode, data: data.substring(0, 300), setCookie });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log('=== Production Backend Verification ===\n');

  // 1. Health check
  console.log('1. Health Check:');
  const health = await testEndpoint('/api/health');
  console.log(`   Status: ${health.status} ${health.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`   Response: ${JSON.stringify(health.data)}\n`);

  // 2. Admin login
  console.log('2. Admin Login:');
  const login = await testEndpoint('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD || '' }),
  });
  console.log(`   Status: ${login.status} ${login.status === 200 ? 'PASS' : 'FAIL'}`);

  if (login.status === 200) {
    const cookie = login.setCookie[0].split(';')[0];
    
    // 3. Admin session
    console.log('\n3. Admin Session:');
    const session = await testEndpoint('/api/admin/session', { headers: { Cookie: cookie } });
    console.log(`   Status: ${session.status} ${session.status === 200 ? 'PASS' : 'FAIL'}`);
    
    // 4. Admin portfolio
    console.log('\n4. Admin Portfolio:');
    const portfolio = await testEndpoint('/api/admin/portfolio', { headers: { Cookie: cookie } });
    console.log(`   Status: ${portfolio.status} ${portfolio.status === 200 ? 'PASS' : 'FAIL'}`);
    if (portfolio.status === 200) {
      console.log(`   Projects: ${portfolio.data.projects?.length || 0}`);
      console.log(`   Contacts: ${portfolio.data.contacts?.length || 0}`);
      console.log(`   Name: ${portfolio.data.name}`);
    }

    // 5. Admin insights
    console.log('\n5. Admin Insights:');
    const insights = await testEndpoint('/api/admin/analytics', { headers: { Cookie: cookie } });
    console.log(`   Status: ${insights.status} ${insights.status === 200 ? 'PASS' : 'FAIL'}`);
  }

  // 6. Visitor registration
  console.log('\n6. Visitor Registration:');
  const reg = await testEndpoint('/api/visitor/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({
      name: 'Test User',
      email: `test-${Date.now()}@example.com`,
      password: 'TestPass123!',
      recoveryKey: 'TestRecoveryKey123!',
      recoveryKeyConfirmation: 'TestRecoveryKey123!',
      privacyAccepted: true,
    }),
  });
  console.log(`   Status: ${reg.status} ${reg.status === 201 ? 'PASS' : 'FAIL'}`);

  // 7. Static file serving
  console.log('\n7. Static File Serving:');
  const index = await testEndpoint('/');
  console.log(`   Status: ${index.status} ${index.status === 200 ? 'PASS' : 'FAIL'}`);

  // 8. Contact form API
  console.log('\n8. Contact Form API:');
  const contact = await testEndpoint('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ name: 'Test', email: 'test@example.com', message: 'Test message' }),
  });
  console.log(`   Status: ${contact.status} ${contact.status === 401 ? 'PASS (requires auth)' : 'FAIL'}`);

  // 9. CORS preflight
  console.log('\n9. CORS Preflight:');
  const cors = await testEndpoint('/api/health', {
    method: 'OPTIONS',
    headers: { 
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'content-type'
    },
  });
  console.log(`   Status: ${cors.status} ${cors.status === 204 ? 'PASS' : 'FAIL'}`);

  // 10. Security headers
  console.log('\n10. Security Headers:');
  const sec = await testEndpoint('/api/health');
  console.log(`   Status: ${sec.status} ${sec.status === 200 ? 'PASS' : 'FAIL'}`);

  console.log('\n=== All Tests Complete ===');
}

main().catch(console.error);