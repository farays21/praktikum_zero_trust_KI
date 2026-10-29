/**
 * Service Nilai — internal service on port 3001.
 * Every request must carry X-Gateway-Secret. The Gateway remains the policy decision point.
 */

require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { loadConfig } = require('../../shared/config');
const { openDatabase } = require('../../shared/db/connection');

const http = require('http');

const app = express();
const config = loadConfig();
const db = openDatabase(config.dbPath);

function gatewayRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.gatewayUrl);
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
          parsed = { raw: data };
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

app.use(express.json());
app.use((req, res, next) => {
  req.db = db;
  req.config = config;
  next();
});

function requireGateway(req, res, next) {
  if (req.headers['x-gateway-secret'] !== config.gatewaySecret) {
    return res.status(403).json({ error: 'Direct access denied' });
  }
  next();
}

function requireUserAccessToken(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token required' });
  }
  try {
    const decoded = jwt.verify(header.slice(7), config.jwtSecret);
    if (decoded.type !== 'access' || decoded.role === 'service') {
      return res.status(403).json({ error: 'User access token required' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token';
    return res.status(401).json({ error: message });
  }
}

app.use(requireGateway);

app.get('/nilai', requireUserAccessToken, (req, res) => {
  const user = req.db.prepare('SELECT id, role FROM users WHERE username = ?').get(req.user.sub);
  if (!user || (user.role !== 'mahasiswa' && user.role !== 'dosen')) {
    return res.status(403).json({ error: 'Role not allowed' });
  }

  const rows = user.role === 'mahasiswa'
    ? req.db.prepare(`
        SELECT n.id, n.nilai, n.status, u.username AS mahasiswa, u.nim, k.kode_kelas, k.nama_matakuliah, k.sks, k.semester
        FROM nilai n
        JOIN users u ON u.id = n.mahasiswa_id
        JOIN kelas k ON k.id = n.kelas_id
        WHERE n.mahasiswa_id = ?
        ORDER BY k.kode_kelas
      `).all(user.id)
    : req.db.prepare(`
        SELECT n.id, n.nilai, n.status, u.username AS mahasiswa, u.nama AS nama_mahasiswa, u.nim,
               k.id AS kelas_id, k.kode_kelas, k.nama_matakuliah, k.sks, k.semester
        FROM nilai n
        JOIN users u ON u.id = n.mahasiswa_id
        JOIN kelas k ON k.id = n.kelas_id
        WHERE k.dosen_id = ?
        ORDER BY k.kode_kelas, u.username
      `).all(user.id);

  res.json({ nilai: rows });
});

app.put('/nilai/:id', requireUserAccessToken, (req, res) => {
  const grade = Number(req.body.nilai);
  if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
    return res.status(400).json({ error: 'Nilai harus berupa angka antara 0 sampai 100' });
  }

  const user = req.db.prepare('SELECT id FROM users WHERE username = ? AND role = ?').get(req.user.sub, 'dosen');
  const row = req.db.prepare(`
    SELECT n.id, n.status, k.dosen_id
    FROM nilai n JOIN kelas k ON k.id = n.kelas_id
    WHERE n.id = ?
  `).get(req.params.id);

  if (!user || !row || row.dosen_id !== user.id) return res.status(403).json({ error: 'Not class owner' });
  if (row.status !== 'draft') return res.status(409).json({ error: 'Final grade cannot be changed' });

  req.db.prepare(`
    UPDATE nilai SET nilai = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'
  `).run(grade, row.id);
  res.json({ id: row.id, nilai: grade, status: 'draft' });
});

app.post('/kelas/:id/finalisasi', requireUserAccessToken, async (req, res) => {
  const user = req.db.prepare('SELECT id FROM users WHERE username = ? AND role = ?').get(req.user.sub, 'dosen');
  const kelas = req.db.prepare('SELECT id, dosen_id, sks FROM kelas WHERE id = ?').get(req.params.id);
  if (!user || !kelas || kelas.dosen_id !== user.id) {
    return res.status(403).json({ error: 'Not class owner' });
  }

  const pending = req.db.prepare(`
    SELECT id FROM nilai WHERE kelas_id = ? AND status = 'draft'
  `).all(kelas.id);
  if (pending.length === 0) return res.status(409).json({ error: 'No draft grades to finalize' });

  const pendingIds = pending.map(p => p.id);

  // Step 1: Finalize grades
  req.db.exec('BEGIN IMMEDIATE');
  try {
    const result = req.db.prepare(`
      UPDATE nilai
      SET status = 'final', finalized_at = CURRENT_TIMESTAMP, finalized_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE kelas_id = ? AND status = 'draft'
    `).run(user.id, kelas.id);
    req.db.exec('COMMIT');

    // Step 2: Service authenticates with Gateway to get service token
    const authResult = await gatewayRequest('POST', '/auth/service', {
      clientId: config.serviceClients.nilai.clientId,
      clientSecret: config.serviceClients.nilai.clientSecret,
    });

    if (authResult.status !== 200 || !authResult.body.serviceToken) {
      console.error('Service authentication failed:', authResult.body);
      // Rollback finalization
      req.db.exec('BEGIN IMMEDIATE');
      req.db.prepare(`
        UPDATE nilai
        SET status = 'draft', finalized_at = NULL, finalized_by = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${pendingIds.map(() => '?').join(',')})
      `).run(...pendingIds);
      req.db.exec('COMMIT');
      return res.status(500).json({ error: 'Service authentication failed', syncStatus: 'failed' });
    }

    // Step 3: Request transcript sync with service token
    const syncResult = await gatewayRequest('POST', '/transkrip/sinkron', {
      kelasId: kelas.id,
    }, {
      Authorization: `Bearer ${authResult.body.serviceToken}`,
    });

    if (syncResult.status !== 200) {
      console.error('Transcript sync failed:', syncResult.body);
      // Rollback finalization to maintain consistency
      req.db.exec('BEGIN IMMEDIATE');
      req.db.prepare(`
        UPDATE nilai
        SET status = 'draft', finalized_at = NULL, finalized_by = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${pendingIds.map(() => '?').join(',')})
      `).run(...pendingIds);
      req.db.exec('COMMIT');
      return res.status(502).json({
        error: 'Transcript synchronization failed',
        syncStatus: 'failed',
        detail: syncResult.body,
      });
    }

    // Success
    res.json({
      kelasId: kelas.id,
      finalized: result.changes,
      sks: kelas.sks,
      transcriptSync: syncResult.body,
      syncStatus: 'success',
    });
  } catch (error) {
    req.db.exec('ROLLBACK');
    console.error('Finalization error:', error.message);
    res.status(500).json({ error: 'Finalization failed' });
  }
});

app.get('/admin/nilai', requireUserAccessToken, (req, res) => {
  const user = req.db.prepare('SELECT id, role FROM users WHERE username = ?').get(req.user.sub);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admin can access this endpoint' });
  }

  const rows = req.db.prepare(`
    SELECT n.id, n.nilai, n.status, u.username AS mahasiswa, u.nama AS nama_mahasiswa, u.nim,
           k.id AS kelas_id, k.kode_kelas, k.nama_matakuliah, k.sks, k.semester
    FROM nilai n
    JOIN users u ON u.id = n.mahasiswa_id
    JOIN kelas k ON k.id = n.kelas_id
    ORDER BY u.nim, k.kode_kelas
  `).all();

  res.json({ nilai: rows });
});

app.post('/nilai/:id/revert', requireUserAccessToken, async (req, res) => {
  const user = req.db.prepare('SELECT id FROM users WHERE username = ? AND role = ?').get(req.user.sub, 'admin');
  if (!user) {
    return res.status(403).json({ error: 'Only admin can revert grades' });
  }

  const nilai = req.db.prepare('SELECT id, status, mahasiswa_id, kelas_id FROM nilai WHERE id = ?').get(req.params.id);
  if (!nilai) {
    return res.status(404).json({ error: 'Nilai not found' });
  }

  if (nilai.status !== 'final') {
    return res.status(409).json({ error: 'Nilai is not final, cannot revert' });
  }

  req.db.exec('BEGIN IMMEDIATE');
  try {
    req.db.prepare(`
      UPDATE nilai
      SET status = 'draft', finalized_at = NULL, finalized_by = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nilai.id);
    req.db.exec('COMMIT');
  } catch (error) {
    req.db.exec('ROLLBACK');
    console.error('Revert DB error:', error.message);
    return res.status(500).json({ error: 'Revert failed' });
  }

  try {
    const mahasiswa = req.db.prepare('SELECT nim FROM users WHERE id = ?').get(nilai.mahasiswa_id);
    const kelas = req.db.prepare('SELECT sks FROM kelas WHERE id = ?').get(nilai.kelas_id);

    if (mahasiswa && kelas) {
      const authResult = await gatewayRequest('POST', '/auth/service', {
        clientId: config.serviceClients.nilai.clientId,
        clientSecret: config.serviceClients.nilai.clientSecret,
      });

      if (authResult.status === 200 && authResult.body.serviceToken) {
        const syncResult = await gatewayRequest('POST', '/transkrip/sinkron', {
          kelasId: nilai.kelas_id,
        }, {
          Authorization: `Bearer ${authResult.body.serviceToken}`,
        });

        if (syncResult.status !== 200) {
          console.warn('Transcript sync after revert failed:', syncResult.body);
        }
      }
    }

    res.json({
      id: nilai.id,
      status: 'draft',
      message: 'Grade reverted to draft successfully',
    });
  } catch (error) {
    console.error('Revert sync error:', error.message);
    res.json({
      id: nilai.id,
      status: 'draft',
      message: 'Grade reverted to draft, but transcript sync failed',
    });
  }
});

app.use((error, req, res, next) => {
  console.error('Nilai service error:', error.message);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(3001, () => console.log('Service Nilai running on http://localhost:3001'));
}

module.exports = app;
