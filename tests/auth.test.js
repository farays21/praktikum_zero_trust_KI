/**
 * Phase 2 tests: Authentication + API Gateway
 * Tests login, refresh, logout, service auth, and audit logging.
 */

require('dotenv').config();
const http = require('http');
const { loadConfig } = require('../shared/config');
const { openDatabase } = require('../shared/db/connection');

const config = loadConfig();
const BASE_URL = 'http://localhost:3000';

let passed = 0;
let failed = 0;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch {
          parsed = data;
        }
        const cookies = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, body: parsed, cookies });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function extractCookie(cookies, name) {
  for (const c of cookies) {
    const match = c.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  console.log('=== Phase 2: Authentication Tests ===\n');

  // Wait for server to be ready
  await new Promise((r) => setTimeout(r, 500));

  let refreshCookie = null;
  let accessToken = null;

  await test('Login success with valid credentials and device', async () => {
    const res = await request('POST', '/auth/login', {
      username: 'mahasiswa1',
      password: 'Mhs@123',
    }, { 'X-Device-ID': 'dev-mhs-001' });

    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.accessToken, 'Missing accessToken');
    assert(res.body.user.username === 'mahasiswa1', 'Wrong user');
    assert(res.body.user.role === 'mahasiswa', 'Wrong role');
    refreshCookie = extractCookie(res.cookies, 'refreshToken');
    accessToken = res.body.accessToken;
    assert(refreshCookie, 'Missing refresh cookie');
  });

  await test('Login fails with wrong password', async () => {
    const res = await request('POST', '/auth/login', {
      username: 'mahasiswa1',
      password: 'wrong',
    }, { 'X-Device-ID': 'dev-mhs-001' });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('Login fails with unregistered device', async () => {
    const res = await request('POST', '/auth/login', {
      username: 'mahasiswa1',
      password: 'Mhs@123',
    }, { 'X-Device-ID': 'unknown-device' });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await test('Login fails without device header', async () => {
    const res = await request('POST', '/auth/login', {
      username: 'mahasiswa1',
      password: 'Mhs@123',
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await test('Refresh token rotates and returns new access token', async () => {
    const res = await request('POST', '/auth/refresh', null, {
      'X-Device-ID': 'dev-mhs-001',
      Cookie: `refreshToken=${refreshCookie}`,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.accessToken, 'Missing new accessToken');
    const newCookie = extractCookie(res.cookies, 'refreshToken');
    assert(newCookie && newCookie !== refreshCookie, 'Refresh token not rotated');
    refreshCookie = newCookie;
  });

  await test('Old refresh token is revoked after rotation', async () => {
    // The previous refreshCookie was already replaced; we need the old one.
    // Re-login to get a fresh pair, refresh once, then try old token.
    const login = await request('POST', '/auth/login', {
      username: 'dosen1',
      password: 'Dosen@123',
    }, { 'X-Device-ID': 'dev-dosen-001' });
    const oldCookie = extractCookie(login.cookies, 'refreshToken');

    const refreshed = await request('POST', '/auth/refresh', null, {
      'X-Device-ID': 'dev-dosen-001',
      Cookie: `refreshToken=${oldCookie}`,
    });
    assert(refreshed.status === 200, 'Refresh should succeed');

    const reuse = await request('POST', '/auth/refresh', null, {
      'X-Device-ID': 'dev-dosen-001',
      Cookie: `refreshToken=${oldCookie}`,
    });
    assert(reuse.status === 401, `Expected 401 for revoked token, got ${reuse.status}`);
  });

  await test('Logout revokes refresh token and clears cookie', async () => {
    const login = await request('POST', '/auth/login', {
      username: 'admin1',
      password: 'Admin@123',
    }, { 'X-Device-ID': 'dev-admin-001' });
    const cookie = extractCookie(login.cookies, 'refreshToken');

    const logout = await request('POST', '/auth/logout', null, {
      'X-Device-ID': 'dev-admin-001',
      Cookie: `refreshToken=${cookie}`,
    });
    assert(logout.status === 200, `Expected 200, got ${logout.status}`);

    const reuse = await request('POST', '/auth/refresh', null, {
      'X-Device-ID': 'dev-admin-001',
      Cookie: `refreshToken=${cookie}`,
    });
    assert(reuse.status === 401, `Expected 401 after logout, got ${reuse.status}`);
  });

  await test('Service authentication succeeds with valid client secret', async () => {
    const res = await request('POST', '/auth/service', {
      clientId: 'nilai-service',
      clientSecret: config.serviceClients.nilai.clientSecret,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.serviceToken, 'Missing serviceToken');
  });

  await test('Service authentication fails with wrong secret', async () => {
    const res = await request('POST', '/auth/service', {
      clientId: 'nilai-service',
      clientSecret: 'wrong-secret',
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('Audit logs record ALLOW and DENY decisions', async () => {
    const db = openDatabase(config.dbPath);
    const rows = db.prepare(`
      SELECT decision, endpoint, reason FROM audit_logs
      WHERE endpoint LIKE '/auth/%'
      ORDER BY id DESC
      LIMIT 20
    `).all();
    db.close();

    const decisions = new Set(rows.map((r) => r.decision));
    assert(decisions.has('ALLOW'), 'No ALLOW audit entries');
    assert(decisions.has('DENY'), 'No DENY audit entries');

    const leaked = rows.some((r) =>
      /password|secret|token/i.test(r.reason || '') && /Admin@|Mhs@|dev-nilai/i.test(r.reason || '')
    );
    assert(!leaked, 'Audit log may contain sensitive credentials');
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
