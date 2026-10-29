/**
 * Gateway proxy routes for Nilai service.
 * Policy checks: authentication, device, role, ownership, time constraints.
 */

const express = require('express');
const http = require('http');
const { requireAccessToken, requireAllowedHours } = require('../middleware/policyEngine');

const router = express.Router();

function logAudit(db, subject, role, endpoint, method, deviceId, decision, reason) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (subject, subject_role, endpoint, method, device_id, decision, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subject, role, endpoint, method, deviceId || null, decision, reason);
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
}

function proxyToService(host, port, path, headers, body, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port,
      path,
      method,
      headers,
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

router.get('/nilai', requireAccessToken, async (req, res) => {
  const db = req.db;
  const config = req.config;
  const user = db.prepare('SELECT id, role FROM users WHERE username = ?').get(req.user.sub);

  if (!user || (user.role !== 'mahasiswa' && user.role !== 'dosen')) {
    logAudit(db, req.user.sub, req.user.role, '/nilai', 'GET', req.headers['x-device-id'], 'DENY', 'Role not allowed');
    return res.status(403).json({ error: 'Role not allowed for this endpoint' });
  }

  logAudit(db, req.user.sub, user.role, '/nilai', 'GET', req.headers['x-device-id'], 'ALLOW', 'Policy passed');

  try {
    const result = await proxyToService('localhost', 3001, '/nilai', {
      'Content-Type': 'application/json',
      'X-Gateway-Secret': config.gatewaySecret,
      Authorization: req.headers.authorization,
    }, null, 'GET');
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Gateway proxy failed' });
  }
});

router.put('/nilai/:id', requireAccessToken, requireAllowedHours, async (req, res) => {
  const db = req.db;
  const config = req.config;
  const user = db.prepare('SELECT id FROM users WHERE username = ? AND role = ?').get(req.user.sub, 'dosen');

  if (!user) {
    logAudit(db, req.user.sub, req.user.role, `/nilai/${req.params.id}`, 'PUT', req.headers['x-device-id'], 'DENY', 'Not a dosen');
    return res.status(403).json({ error: 'Only dosen can update grades' });
  }

  const row = db.prepare(`
    SELECT n.id, n.status, k.dosen_id
    FROM nilai n JOIN kelas k ON k.id = n.kelas_id
    WHERE n.id = ?
  `).get(req.params.id);

  if (!row) {
    logAudit(db, req.user.sub, 'dosen', `/nilai/${req.params.id}`, 'PUT', req.headers['x-device-id'], 'DENY', 'Nilai not found');
    return res.status(404).json({ error: 'Nilai not found' });
  }

  if (row.dosen_id !== user.id) {
    logAudit(db, req.user.sub, 'dosen', `/nilai/${req.params.id}`, 'PUT', req.headers['x-device-id'], 'DENY', 'Not class owner');
    return res.status(403).json({ error: 'Not authorized for this class' });
  }

  if (row.status !== 'draft') {
    logAudit(db, req.user.sub, 'dosen', `/nilai/${req.params.id}`, 'PUT', req.headers['x-device-id'], 'DENY', 'Final grade cannot be changed');
    return res.status(409).json({ error: 'Final grade cannot be changed' });
  }

  logAudit(db, req.user.sub, 'dosen', `/nilai/${req.params.id}`, 'PUT', req.headers['x-device-id'], 'ALLOW', 'Ownership and policy passed');

  try {
    const result = await proxyToService('localhost', 3001, `/nilai/${req.params.id}`, {
      'Content-Type': 'application/json',
      'X-Gateway-Secret': config.gatewaySecret,
      Authorization: req.headers.authorization,
    }, req.body, 'PUT');
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Gateway proxy failed' });
  }
});

router.post('/kelas/:id/finalisasi', requireAccessToken, requireAllowedHours, async (req, res) => {
  const db = req.db;
  const config = req.config;
  const user = db.prepare('SELECT id FROM users WHERE username = ? AND role = ?').get(req.user.sub, 'dosen');

  if (!user) {
    logAudit(db, req.user.sub, req.user.role, `/kelas/${req.params.id}/finalisasi`, 'POST', req.headers['x-device-id'], 'DENY', 'Not a dosen');
    return res.status(403).json({ error: 'Only dosen can finalize grades' });
  }

  const kelas = db.prepare('SELECT id, dosen_id FROM kelas WHERE id = ?').get(req.params.id);
  if (!kelas) {
    logAudit(db, req.user.sub, 'dosen', `/kelas/${req.params.id}/finalisasi`, 'POST', req.headers['x-device-id'], 'DENY', 'Class not found');
    return res.status(404).json({ error: 'Class not found' });
  }

  if (kelas.dosen_id !== user.id) {
    logAudit(db, req.user.sub, 'dosen', `/kelas/${req.params.id}/finalisasi`, 'POST', req.headers['x-device-id'], 'DENY', 'Not class owner');
    return res.status(403).json({ error: 'Not authorized for this class' });
  }

  logAudit(db, req.user.sub, 'dosen', `/kelas/${req.params.id}/finalisasi`, 'POST', req.headers['x-device-id'], 'ALLOW', 'Finalization authorized');

  try {
    const result = await proxyToService('localhost', 3001, `/kelas/${req.params.id}/finalisasi`, {
      'Content-Type': 'application/json',
      'X-Gateway-Secret': config.gatewaySecret,
      Authorization: req.headers.authorization,
    }, {}, 'POST');

    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Finalization proxy error:', error.message);
    logAudit(db, req.user.sub, 'dosen', `/kelas/${req.params.id}/finalisasi`, 'POST', req.headers['x-device-id'], 'DENY', 'Internal error');
    res.status(500).json({ error: 'Finalization failed' });
  }
});

router.get('/admin/nilai', requireAccessToken, async (req, res) => {
  const db = req.db;
  const config = req.config;
  const user = db.prepare('SELECT id, role FROM users WHERE username = ?').get(req.user.sub);

  if (!user || user.role !== 'admin') {
    logAudit(db, req.user.sub, req.user.role, '/admin/nilai', 'GET', req.headers['x-device-id'], 'DENY', 'Not an admin');
    return res.status(403).json({ error: 'Only admin can access this endpoint' });
  }

  logAudit(db, req.user.sub, 'admin', '/admin/nilai', 'GET', req.headers['x-device-id'], 'ALLOW', 'Policy passed');

  try {
    const result = await proxyToService('localhost', 3001, '/admin/nilai', {
      'Content-Type': 'application/json',
      'X-Gateway-Secret': config.gatewaySecret,
      Authorization: req.headers.authorization,
    }, null, 'GET');
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Gateway proxy failed' });
  }
});

router.post('/nilai/:id/revert', requireAccessToken, async (req, res) => {
  const db = req.db;
  const config = req.config;
  const user = db.prepare('SELECT id FROM users WHERE username = ? AND role = ?').get(req.user.sub, 'admin');

  if (!user) {
    logAudit(db, req.user.sub, req.user.role, `/nilai/${req.params.id}/revert`, 'POST', req.headers['x-device-id'], 'DENY', 'Not an admin');
    return res.status(403).json({ error: 'Only admin can revert final grades to draft' });
  }

  const nilai = db.prepare('SELECT id, status FROM nilai WHERE id = ?').get(req.params.id);
  if (!nilai) {
    logAudit(db, req.user.sub, 'admin', `/nilai/${req.params.id}/revert`, 'POST', req.headers['x-device-id'], 'DENY', 'Nilai not found');
    return res.status(404).json({ error: 'Nilai not found' });
  }

  if (nilai.status !== 'final') {
    logAudit(db, req.user.sub, 'admin', `/nilai/${req.params.id}/revert`, 'POST', req.headers['x-device-id'], 'DENY', 'Nilai is not final');
    return res.status(409).json({ error: 'Nilai is not final, cannot revert' });
  }

  logAudit(db, req.user.sub, 'admin', `/nilai/${req.params.id}/revert`, 'POST', req.headers['x-device-id'], 'ALLOW', 'Revert authorized');

  try {
    const result = await proxyToService('localhost', 3001, `/nilai/${req.params.id}/revert`, {
      'Content-Type': 'application/json',
      'X-Gateway-Secret': config.gatewaySecret,
      Authorization: req.headers.authorization,
    }, {}, 'POST');
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Revert proxy error:', error.message);
    res.status(500).json({ error: 'Gateway proxy failed' });
  }
});

module.exports = router;
