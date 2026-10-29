/**
 * Phase 3 integration tests: Service Nilai + Service Transkrip
 * Tests all business endpoints, authorization, ownership, time constraints, and full finalization flow.
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
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login(username, password, deviceId) {
  const res = await request('POST', '/auth/login', { username, password }, { 'X-Device-ID': deviceId });
  return res.body.accessToken;
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
  console.log('=== Phase 3: Service Integration Tests ===\n');

  await new Promise((r) => setTimeout(r, 1000)); // wait for services

  let dosenToken, mhsToken, adminToken;

  await test('Setup: Login dosen1', async () => {
    dosenToken = await login('dosen1', 'Dosen@123', 'dev-dosen-001');
    assert(dosenToken, 'Dosen token missing');
  });

  await test('Setup: Login mahasiswa1', async () => {
    mhsToken = await login('mahasiswa1', 'Mhs@123', 'dev-mhs-001');
    assert(mhsToken, 'Mahasiswa token missing');
  });

  await test('Setup: Login admin1', async () => {
    adminToken = await login('admin1', 'Admin@123', 'dev-admin-001');
    assert(adminToken, 'Admin token missing');
  });

  await test('GET /nilai: Mahasiswa can view own grades', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.nilai, 'Missing nilai array');
    assert(res.body.nilai.length === 2, `Expected 2 grades for mahasiswa1, got ${res.body.nilai.length}`);
  });

  await test('GET /nilai: Dosen can view grades from their classes', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.nilai, 'Missing nilai array');
    assert(res.body.nilai.length >= 2, 'Expected at least 2 grades in PROG101');
  });

  await test('GET /nilai: Admin cannot access (not specified in requirements)', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${adminToken}`,
      'X-Device-ID': 'dev-admin-001',
    });
    assert(res.status === 403, `Expected 403 for admin, got ${res.status}`);
  });

  await test('PUT /nilai/:id: Dosen can update draft grade in their class', async () => {
    const db = openDatabase(config.dbPath);
    const row = db.prepare(`
      SELECT n.id FROM nilai n
      JOIN kelas k ON k.id = n.kelas_id
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen1' AND n.status = 'draft' LIMIT 1
    `).get();
    db.close();
    assert(row, 'No draft grade found for dosen1');

    const res = await request('PUT', `/nilai/${row.id}`, { nilai: 88 }, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.nilai === 88, 'Grade not updated');
  });

  await test('PUT /nilai/:id: Mahasiswa cannot update grades', async () => {
    const db = openDatabase(config.dbPath);
    const row = db.prepare('SELECT id FROM nilai WHERE status = ? LIMIT 1').get('draft');
    db.close();

    const res = await request('PUT', `/nilai/${row.id}`, { nilai: 95 }, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await test('PUT /nilai/:id: Dosen cannot update grades in other classes', async () => {
    const db = openDatabase(config.dbPath);
    const row = db.prepare(`
      SELECT n.id FROM nilai n
      JOIN kelas k ON k.id = n.kelas_id
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen2' AND n.status = 'draft' LIMIT 1
    `).get();
    db.close();

    if (row) {
      const res = await request('PUT', `/nilai/${row.id}`, { nilai: 92 }, {
        Authorization: `Bearer ${dosenToken}`,
        'X-Device-ID': 'dev-dosen-001',
      });
      assert(res.status === 403, `Expected 403 for cross-class update, got ${res.status}`);
    }
  });

  await test('POST /kelas/:id/finalisasi: Dosen can finalize their class', async () => {
    const db = openDatabase(config.dbPath);
    const kelas = db.prepare(`
      SELECT k.id FROM kelas k
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen1'
    `).get();
    db.close();
    assert(kelas, 'No class found for dosen1');

    const res = await request('POST', `/kelas/${kelas.id}/finalisasi`, {}, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.finalized > 0, 'No grades finalized');
    assert(res.body.transcriptSync, 'Missing transcript sync result');
    assert(res.body.syncStatus === 'success', 'Sync should succeed');
  });

  await test('PUT /nilai/:id: Cannot update final grade', async () => {
    const db = openDatabase(config.dbPath);
    const row = db.prepare(`
      SELECT n.id FROM nilai n
      JOIN kelas k ON k.id = n.kelas_id
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen1' AND n.status = 'final' LIMIT 1
    `).get();
    db.close();

    if (row) {
      const res = await request('PUT', `/nilai/${row.id}`, { nilai: 99 }, {
        Authorization: `Bearer ${dosenToken}`,
        'X-Device-ID': 'dev-dosen-001',
      });
      assert(res.status === 409, `Expected 409 for final grade, got ${res.status}`);
    }
  });

  await test('GET /transkrip/:nim: Mahasiswa can view own transcript', async () => {
    const res = await request('GET', '/transkrip/2024001', null, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.nim === '2024001', 'Wrong NIM');
    assert(res.body.total_sks >= 0, 'Missing total_sks');
    assert(res.body.courses, 'Missing courses');
  });

  await test('GET /transkrip/:nim: Mahasiswa cannot view other transcript', async () => {
    const res = await request('GET', '/transkrip/2024002', null, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await test('GET /transkrip/:nim: Admin can view any transcript', async () => {
    const res = await request('GET', '/transkrip/2024001', null, {
      Authorization: `Bearer ${adminToken}`,
      'X-Device-ID': 'dev-admin-001',
    });
    assert(res.status === 200, `Expected 200 for admin, got ${res.status}`);
  });

  await test('GET /transkrip/:nim: Dosen cannot access transcript', async () => {
    const res = await request('GET', '/transkrip/2024001', null, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(res.status === 403, `Expected 403 for dosen, got ${res.status}`);
  });

  await test('Direct access to Service Nilai without gateway secret is blocked', async () => {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'localhost', port: 3001, path: '/nilai', method: 'GET' }, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', reject);
        req.end();
      });
      assert(result.status === 403, `Expected 403 for direct access, got ${result.status}`);
    } catch (error) {
      throw new Error(`Direct access test failed: ${error.message}`);
    }
  });

  await test('Direct access to Service Transkrip without gateway secret is blocked', async () => {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'localhost', port: 3002, path: '/transkrip/2024001', method: 'GET' }, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', reject);
        req.end();
      });
      assert(result.status === 403, `Expected 403 for direct access, got ${result.status}`);
    } catch (error) {
      throw new Error(`Direct access test failed: ${error.message}`);
    }
  });

  await test('Audit logs record service-to-service calls', async () => {
    const db = openDatabase(config.dbPath);
    const serviceLog = db.prepare(`
      SELECT * FROM audit_logs
      WHERE subject = 'nilai-service' AND endpoint = '/transkrip/sinkron'
      ORDER BY id DESC LIMIT 1
    `).get();
    db.close();
    assert(serviceLog, 'No service audit log found');
    assert(serviceLog.decision === 'ALLOW', 'Service call was not allowed');
  });

  await test('Missing X-Device-ID header is rejected', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${mhsToken}`,
      // No X-Device-ID header
    });
    assert(res.status === 400, `Expected 400 for missing device header, got ${res.status}`);
    assert(res.body.error.includes('X-Device-ID'), 'Error should mention device header');
  });

  await test('Unregistered device is rejected', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'unregistered-device-999',
    });
    assert(res.status === 403, `Expected 403 for unregistered device, got ${res.status}`);
  });

  await test('Access outside allowed hours is rejected', async () => {
    // Only works if gateway started with ALLOW_POLICY_TIME_OVERRIDE=1
    if (process.env.ALLOW_POLICY_TIME_OVERRIDE === '1') {
      const db = openDatabase(config.dbPath);
      const row = db.prepare(`
        SELECT n.id FROM nilai n
        JOIN kelas k ON k.id = n.kelas_id
        JOIN users u ON u.id = k.dosen_id
        WHERE u.username = 'dosen1' AND n.status = 'draft' LIMIT 1
      `).get();
      db.close();

      if (row) {
        const res = await request('PUT', `/nilai/${row.id}`, { nilai: 75 }, {
          Authorization: `Bearer ${dosenToken}`,
          'X-Device-ID': 'dev-dosen-001',
          'X-Policy-Now': '03:00', // Outside 07:00-21:00
        });
        assert(res.status === 403, `Expected 403 for outside hours, got ${res.status}`);
        assert(res.body.error.includes('allowed hours'), 'Error should mention hours');
      }
    }
  });

  await test('Expired access token is rejected', async () => {
    const jwt = require('jsonwebtoken');
    const expiredToken = jwt.sign(
      { sub: 'mahasiswa1', role: 'mahasiswa', type: 'access' },
      config.jwtSecret,
      { expiresIn: '-1m' } // Already expired
    );

    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${expiredToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    assert(res.status === 401, `Expected 401 for expired token, got ${res.status}`);
  });

  await test('Service token on user endpoint is rejected', async () => {
    const jwt = require('jsonwebtoken');
    const serviceToken = jwt.sign(
      { sub: 'nilai-service', role: 'service', type: 'service' },
      config.jwtServiceSecret,
      { expiresIn: '5m' }
    );

    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${serviceToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    // 401 is valid: service token signed with jwtServiceSecret can't be verified with jwtSecret
    assert(res.status === 401 || res.status === 403, `Expected 401 or 403 for service token on user endpoint, got ${res.status}`);
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
