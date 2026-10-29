/**
 * Policy Engine / Policy Administrator
 * Central access decision point for Zero Trust.
 * Verifies JWT signature, expiry, token type, and applies policies.
 */

const jwt = require('jsonwebtoken');

/**
 * Middleware to verify access token and attach user to request.
 * Rejects service tokens on user endpoints.
 * Requires valid X-Device-ID header for all user requests.
 */
function requireAccessToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const deviceId = req.headers['x-device-id'];
  const db = req.db;
  const config = req.config;

  if (!deviceId) {
    logAuditSync(db, 'unknown', 'user', req.path, req.method, null, 'DENY', 'Missing X-Device-ID header');
    return res.status(400).json({ error: 'X-Device-ID header is required' });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logAuditSync(db, 'unknown', 'user', req.path, req.method, deviceId, 'DENY', 'Missing access token');
    return res.status(401).json({ error: 'Access token required' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret);

    // Reject service tokens on user endpoints
    if (decoded.type !== 'access' || decoded.role === 'service') {
      logAuditSync(db, decoded.sub || 'unknown', decoded.role || 'user', req.path, req.method, deviceId, 'DENY', 'Invalid token type');
      return res.status(403).json({ error: 'Invalid token type for this endpoint' });
    }

    // Verify device belongs to user
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(decoded.sub);
    if (!user) {
      logAuditSync(db, decoded.sub, decoded.role, req.path, req.method, deviceId, 'DENY', 'User not found');
      return res.status(401).json({ error: 'User not found' });
    }

    const device = db.prepare('SELECT id FROM devices WHERE user_id = ? AND device_id = ?').get(user.id, deviceId);
    if (!device) {
      logAuditSync(db, decoded.sub, decoded.role, req.path, req.method, deviceId, 'DENY', 'Device not registered for this user');
      return res.status(403).json({ error: 'Device not registered for this user' });
    }

    req.user = decoded;
    next();

  } catch (error) {
    const reason = error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    logAuditSync(db, 'unknown', 'user', req.path, req.method, deviceId, 'DENY', reason);
    return res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

/**
 * Middleware to verify service token.
 * Only accepts tokens signed with JWT_SERVICE_SECRET and type=service.
 */
function requireServiceToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const db = req.db;
  const config = req.config;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logAuditSync(db, 'unknown', 'service', req.path, req.method, null, 'DENY', 'Missing service token');
    return res.status(401).json({ error: 'Service token required' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwtServiceSecret);

    if (decoded.type !== 'service' || decoded.role !== 'service') {
      logAuditSync(db, decoded.sub || 'unknown', 'service', req.path, req.method, null, 'DENY', 'Invalid service token type');
      return res.status(403).json({ error: 'Invalid service token' });
    }

    req.service = decoded;
    next();

  } catch (error) {
    const reason = error.name === 'TokenExpiredError' ? 'Service token expired' : 'Invalid service token';
    logAuditSync(db, 'unknown', 'service', req.path, req.method, null, 'DENY', reason);
    return res.status(401).json({ error: 'Invalid or expired service token' });
  }
}

/**
 * Time-based access control (07:00-21:00).
 * Apply to endpoints that modify grades.
 */
function requireAllowedHours(req, res, next) {
  const config = req.config;

  // Test-only clock override (gateway must be started with ALLOW_POLICY_TIME_OVERRIDE=1).
  // NEVER enable in production.
  let now;
  if (process.env.ALLOW_POLICY_TIME_OVERRIDE === '1' && req.headers['x-policy-now']) {
    const [h, m] = req.headers['x-policy-now'].split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) {
      now = new Date();
      now.setHours(h, m, 0, 0);
    } else {
      now = new Date();
    }
  } else {
    now = new Date();
  }

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours * 60 + minutes;

  const [startH, startM] = config.allowedHoursStart.split(':').map(Number);
  const [endH, endM] = config.allowedHoursEnd.split(':').map(Number);
  const startTime = startH * 60 + startM;
  const endTime = endH * 60 + endM;

  if (currentTime < startTime || currentTime > endTime) {
    const db = req.db;
    const subject = req.user?.sub || req.service?.sub || 'unknown';
    const role = req.user?.role || req.service?.role || 'unknown';
    logAuditSync(db, subject, role, req.path, req.method, req.headers['x-device-id'], 'DENY', 'Outside allowed hours');
    return res.status(403).json({ error: 'Access denied outside allowed hours (07:00-21:00)' });
  }

  next();
}

/**
 * Synchronous audit log helper for middleware.
 */
function logAuditSync(db, subject, subjectRole, endpoint, method, deviceId, decision, reason) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (subject, subject_role, endpoint, method, device_id, decision, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subject, subjectRole, endpoint, method, deviceId || null, decision, reason);
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
}

module.exports = {
  requireAccessToken,
  requireServiceToken,
  requireAllowedHours,
};
