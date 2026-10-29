/**
 * Gateway proxy routes for Transkrip service.
 * Policy checks: authentication, role, ownership.
 */

const express = require('express');
const http = require('http');
const { requireAccessToken, requireServiceToken } = require('../middleware/policyEngine');

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

router.get('/transkrip/:nim', requireAccessToken, async (req, res) => {
  const db = req.db;
  const config = req.config;
  const user = db.prepare('SELECT id, role, nim FROM users WHERE username = ?').get(req.user.sub);

  if (!user || !['mahasiswa', 'admin'].includes(user.role)) {
    logAudit(db, req.user.sub, req.user.role, `/transkrip/${req.params.nim}`, 'GET', req.headers['x-device-id'], 'DENY', 'Role not allowed');
    return res.status(403).json({ error: 'Role not allowed for this endpoint' });
  }

  if (user.role === 'mahasiswa' && user.nim !== req.params.nim) {
    logAudit(db, req.user.sub, user.role, `/transkrip/${req.params.nim}`, 'GET', req.headers['x-device-id'], 'DENY', 'Cross-student access denied');
    return res.status(403).json({ error: 'You can only view your own transcript' });
  }

  logAudit(db, req.user.sub, user.role, `/transkrip/${req.params.nim}`, 'GET', req.headers['x-device-id'], 'ALLOW', 'Policy passed');

  try {
    const result = await proxyToService('localhost', 3002, `/transkrip/${req.params.nim}`, {
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

router.post('/transkrip/sinkron', requireServiceToken, async (req, res) => {
  const db = req.db;
  const config = req.config;

  if (req.service.sub !== 'nilai-service') {
    logAudit(db, req.service.sub, 'service', '/transkrip/sinkron', 'POST', null, 'DENY', 'Service not authorized');
    return res.status(403).json({ error: 'Only nilai-service can sync transcripts' });
  }

  logAudit(db, req.service.sub, 'service', '/transkrip/sinkron', 'POST', null, 'ALLOW', 'Service token valid');

  try {
    const result = await proxyToService('localhost', 3002, '/transkrip/sinkron', {
      'Content-Type': 'application/json',
      'X-Gateway-Secret': config.gatewaySecret,
      Authorization: req.headers.authorization,
    }, req.body, 'POST');
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Gateway proxy failed' });
  }
});

module.exports = router;
