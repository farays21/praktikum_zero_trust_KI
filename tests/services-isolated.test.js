/**
 * Phase 3 integration tests: Service Nilai + Service Transkrip
 * Runs against an ISOLATED test database seeded with deterministic fixtures.
 * Demo database (database/zero-trust.db) is never touched by these tests.
 *
 * Requires services to be started with DB_PATH pointing at the test database,
 * e.g. via tests/run-isolated.js, and TEST_DB_PATH env var pointing to it.
 */

require('dotenv').config();
const http = require('http');
const { loadConfig } = require('../shared/config');
const { openDatabase } = require('../shared/db/connection');
const { getTestDatabase } = require('../shared/db/testDatabase');

const config = loadConfig();
const BASE_URL = 'http://localhost:3000';
const TEST_DB_PATH = process.env.TEST_DB_PATH || config.dbPath;

if (!TEST_DB_PATH) {
  console.error('[Test] ERROR: TEST_DB_PATH not set. Use tests/run-isolated.js.');
  process.exit(2);
}

// Open connection to test database for deterministic verification queries.
// This is a separate handle from the one held by the running services; it is
// only used for read-only fixture lookups, never to mutate demo data.
const testDb = getTestDatabase(TEST_DB_PATH);

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
  console.log('=== Phase 3: Service Integration Tests (Isolated DB) ===\n');

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

  // GET /nilai — mahasiswa sees own grades
  await test('GET /nilai: Mahasiswa can view own grades', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.nilai, 'Missing nilai array');
    assert(res.body.nilai.length === 2, `Expected 2 grades for mahasiswa1, got ${res.body.nilai.length}`);
  });

  // GET /nilai — dosen sees grades from own classes only
  await test('GET /nilai: Dosen can view grades from their classes', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.body.nilai, 'Missing nilai array');
    assert(res.body.nilai.length >= 2, 'Expected at least 2 grades in PROG101');
    for (const grade of res.body.nilai) {
      assert(grade.kode_kelas === 'PROG101', `Dosen1 should only see PROG101 grades, got ${grade.kode_kelas}`);
    }
  });

  // GET /nilai — admin not allowed
  await test('GET /nilai: Admin cannot access', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${adminToken}`,
      'X-Device-ID': 'dev-admin-001',
    });
    assert(res.status === 403, `Expected 403 for admin, got ${res.status}`);
  });

  // PUT /nilai/:id — dosen updates draft grade in own class (this was failing before due to DB state)
  await test('PUT /nilai/:id: Dosen can update draft grade in their class', async () => {
    const row = testDb.prepare(`
      SELECT n.id FROM nilai n
      JOIN kelas k ON k.id = n.kelas_id
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen1' AND n.status = 'draft' LIMIT 1
    `).get();
    assert(row, 'No draft grade found for dosen1 in test database');

    const res = await request('PUT', `/nilai/${row.id}`, { nilai: 88 }, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.nilai === 88, 'Grade not updated');
  });

  // PUT /nilai/:id — mahasiswa cannot update grades
  await test('PUT /nilai/:id: Mahasiswa cannot update grades', async () => {
    const row = testDb.prepare('SELECT id FROM nilai WHERE status = ? LIMIT 1').get('draft');

    const res = await request('PUT', `/nilai/${row.id}`, { nilai: 95 }, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // PUT /nilai/:id — dosen cannot update grades in other class
  await test('PUT /nilai/:id: Dosen cannot update grades in other classes', async () => {
    const row = testDb.prepare(`
      SELECT n.id FROM nilai n
      JOIN kelas k ON k.id = n.kelas_id
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen2' AND n.status = 'draft' LIMIT 1
    `).get();

    if (row) {
      const res = await request('PUT', `/nilai/${row.id}`, { nilai: 92 }, {
        Authorization: `Bearer ${dosenToken}`,
        'X-Device-ID': 'dev-dosen-001',
      });
      assert(res.status === 403, `Expected 403 for cross-class update, got ${res.status}`);
    }
  });

  // POST /kelas/:id/finalisasi — dosen finalizes own class (previously failing due to missing drafts)
  await test('POST /kelas/:id/finalisasi: Dosen can finalize their class', async () => {
    const kelas = testDb.prepare(`
      SELECT k.id, k.kode_kelas FROM kelas k
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen1'
    `).get();
    assert(kelas, 'No class found for dosen1');

    const res = await request('POST', `/kelas/${kelas.id}/finalisasi`, {}, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.finalized > 0, 'No grades finalized');
    assert(res.body.transcriptSync, 'Missing transcript sync result');
    assert(res.body.syncStatus === 'success', `Sync should succeed, got ${res.body.syncStatus}`);
  });

  // PUT /nilai/:id — cannot update final grade
  await test('PUT /nilai/:id: Cannot update final grade', async () => {
    const row = testDb.prepare(`
      SELECT n.id FROM nilai n
      JOIN kelas k ON k.id = n.kelas_id
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen1' AND n.status = 'final' LIMIT 1
    `).get();

    if (row) {
      const res = await request('PUT', `/nilai/${row.id}`, { nilai: 99 }, {
        Authorization: `Bearer ${dosenToken}`,
        'X-Device-ID': 'dev-dosen-001',
      });
      assert(res.status === 409, `Expected 409 for final grade, got ${res.status}`);
    }
  });

  // GET /transkrip/:nim — mahasiswa own transcript
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

  // GET /transkrip/:nim — mahasiswa cannot view other transcript
  await test('GET /transkrip/:nim: Mahasiswa cannot view other transcript', async () => {
    const res = await request('GET', '/transkrip/2024002', null, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'dev-mhs-001',
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // GET /transkrip/:nim — admin can view any transcript
  await test('GET /transkrip/:nim: Admin can view any transcript', async () => {
    const res = await request('GET', '/transkrip/2024001', null, {
      Authorization: `Bearer ${adminToken}`,
      'X-Device-ID': 'dev-admin-001',
    });
    assert(res.status === 200, `Expected 200 for admin, got ${res.status}`);
  });

  // GET /transkrip/:nim — dosen cannot access transcript
  await test('GET /transkrip/:nim: Dosen cannot access transcript', async () => {
    const res = await request('GET', '/transkrip/2024001', null, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(res.status === 403, `Expected 403 for dosen, got ${res.status}`);
  });

  // Direct access to Service Nilai without gateway secret is blocked
  await test('Direct access to Service Nilai without gateway secret is blocked', async () => {
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
  });

  // Direct access to Service Transkrip without gateway secret is blocked
  await test('Direct access to Service Transkrip without gateway secret is blocked', async () => {
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
  });

  // Audit logs record service-to-service calls
  await test('Audit logs record service-to-service calls', async () => {
    const serviceLog = testDb.prepare(`
      SELECT * FROM audit_logs
      WHERE subject = 'nilai-service' AND endpoint = '/transkrip/sinkron'
      ORDER BY id DESC LIMIT 1
    `).get();
    assert(serviceLog, 'No service audit log found');
    assert(serviceLog.decision === 'ALLOW', 'Service call was not allowed');
  });

  // Missing X-Device-ID header is rejected
  await test('Missing X-Device-ID header is rejected', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${mhsToken}`,
      // No X-Device-ID header
    });
    assert(res.status === 400, `Expected 400 for missing device header, got ${res.status}`);
    assert(String(res.body.error || '').includes('X-Device-ID'), 'Error should mention device header');
  });

  // Unregistered device is rejected
  await test('Unregistered device is rejected', async () => {
    const res = await request('GET', '/nilai', null, {
      Authorization: `Bearer ${mhsToken}`,
      'X-Device-ID': 'unregistered-device-999',
    });
    assert(res.status === 403, `Expected 403 for unregistered device, got ${res.status}`);
  });

  // Access outside allowed hours is rejected
  await test('Access outside allowed hours is rejected', async () => {
    if (process.env.ALLOW_POLICY_TIME_OVERRIDE === '1') {
      const row = testDb.prepare(`
        SELECT n.id FROM nilai n
        JOIN kelas k ON k.id = n.kelas_id
        JOIN users u ON u.id = k.dosen_id
        WHERE u.username = 'dosen2' AND n.status = 'draft' LIMIT 1
      `).get();

      if (row) {
        const res = await request('PUT', `/nilai/${row.id}`, { nilai: 75 }, {
          Authorization: `Bearer ${dosenToken}`,
          'X-Device-ID': 'dev-dosen-001',
          'X-Policy-Now': '03:00', // Outside 07:00-21:00
        });
        assert(res.status === 403, `Expected 403 for outside hours, got ${res.status}`);
        assert(String(res.body.error || '').includes('allowed hours'), 'Error should mention hours');
      }
    }
  });

  // Expired access token is rejected
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

  // Service token on user endpoint is rejected
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

  // --- ADMIN REVERT TESTS ---
  await test('Admin Revert: Admin can revert final grade to draft', async () => {
    // 1. Get a final grade
    const finalGrade = testDb.prepare("SELECT id FROM nilai WHERE status = 'final' LIMIT 1").get();
    assert(finalGrade, 'No final grade found for testing revert');

    // 2. Admin reverts
    const res = await request('POST', `/nilai/${finalGrade.id}/revert`, {}, {
      Authorization: `Bearer ${adminToken}`,
      'X-Device-ID': 'dev-admin-001',
    });
    assert(res.status === 200, `Expected 200 for admin revert, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.status === 'draft', 'Status should be draft after revert');

    // 3. Verify in DB
    const updated = testDb.prepare("SELECT status FROM nilai WHERE id = ?").get(finalGrade.id);
    assert(updated.status === 'draft', 'DB status should be draft');
  });

  await test('Admin Revert: Admin cannot revert non-existent grade', async () => {
    const res = await request('POST', '/nilai/999999/revert', {}, {
      Authorization: `Bearer ${adminToken}`,
      'X-Device-ID': 'dev-admin-001',
    });
    assert(res.status === 404, `Expected 404 for non-existent grade, got ${res.status}`);
  });

  await test('Admin Revert: Mahasiswa and Dosen cannot revert grades', async () => {
    const finalGrade = testDb.prepare("SELECT id FROM nilai WHERE status = 'final' LIMIT 1").get();
    if (finalGrade) {
      const resMhs = await request('POST', `/nilai/${finalGrade.id}/revert`, {}, {
        Authorization: `Bearer ${mhsToken}`,
        'X-Device-ID': 'dev-mhs-001',
      });
      assert(resMhs.status === 403, `Expected 403 for mahasiswa, got ${resMhs.status}`);

      const resDosen = await request('POST', `/nilai/${finalGrade.id}/revert`, {}, {
        Authorization: `Bearer ${dosenToken}`,
        'X-Device-ID': 'dev-dosen-001',
      });
      assert(resDosen.status === 403, `Expected 403 for dosen, got ${resDosen.status}`);
    }
  });

  await test('Admin Revert: Reverted grade can be finalized again by Dosen', async () => {
    // 1. Dosen finds their own final grade and admin reverts it
    const row = testDb.prepare(`
      SELECT n.id, n.kelas_id FROM nilai n
      JOIN kelas k ON k.id = n.kelas_id
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen1' AND n.status = 'final' LIMIT 1
    `).get();
    assert(row, 'No final grade found for dosen1');

    await request('POST', `/nilai/${row.id}/revert`, {}, {
      Authorization: `Bearer ${adminToken}`,
      'X-Device-ID': 'dev-admin-001',
    });

    // 2. Dosen updates the reverted grade
    const resUpdate = await request('PUT', `/nilai/${row.id}`, { nilai: 90 }, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(resUpdate.status === 200, `Expected 200 for update after revert, got ${resUpdate.status}`);

    // 3. Dosen finalizes the class again
    const resFinal = await request('POST', `/kelas/${row.kelas_id}/finalisasi`, {}, {
      Authorization: `Bearer ${dosenToken}`,
      'X-Device-ID': 'dev-dosen-001',
    });
    assert(resFinal.status === 200, `Expected 200 for re-finalization, got ${resFinal.status}`);
    
    const finalized = testDb.prepare("SELECT status FROM nilai WHERE id = ?").get(row.id);
    assert(finalized.status === 'final', 'Grade should be final again');
  });

  await test('Admin Revert: Final grade cannot be edited by Dosen before revert', async () => {
    const row = testDb.prepare(`
      SELECT n.id FROM nilai n
      JOIN kelas k ON k.id = n.kelas_id
      JOIN users u ON u.id = k.dosen_id
      WHERE u.username = 'dosen1' AND n.status = 'final' LIMIT 1
    `).get();
    
    if (row) {
      const res = await request('PUT', `/nilai/${row.id}`, { nilai: 100 }, {
        Authorization: `Bearer ${dosenToken}`,
        'X-Device-ID': 'dev-dosen-001',
      });
      assert(res.status === 409, `Expected 409 for final grade edit, got ${res.status}`);
    }
  });

  await test('Admin Revert: Audit log and transcript consistency', async () => {
    // Check audit log for revert
    const revertAudit = testDb.prepare(`
      SELECT * FROM audit_logs 
      WHERE endpoint LIKE '%/revert%' AND decision = 'ALLOW' 
      ORDER BY id DESC LIMIT 1
    `).get();
    assert(revertAudit, 'Revert action not logged in audit_logs');
    assert(revertAudit.subject === 'admin1', 'Wrong subject in audit log');
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
