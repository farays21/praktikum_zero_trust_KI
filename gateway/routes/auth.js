/**
 * Authentication routes for API Gateway.
 * - POST /auth/login
 * - POST /auth/refresh
 * - POST /auth/logout
 * - POST /auth/service
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();

/**
 * POST /auth/login
 * Body: { username, password }
 * Header: X-Device-ID (required)
 * Returns: { accessToken } + Set-Cookie: refreshToken
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const deviceId = req.headers['x-device-id'];
  const db = req.db;
  const config = req.config;

  // Validate input
  if (!username || !password) {
    await logAudit(db, username || 'unknown', 'user', '/auth/login', 'POST', deviceId, 'DENY', 'Missing credentials');
    return res.status(400).json({ error: 'Username and password required' });
  }

  if (!deviceId) {
    await logAudit(db, username, 'user', '/auth/login', 'POST', null, 'DENY', 'Missing device ID');
    return res.status(400).json({ error: 'X-Device-ID header required' });
  }

  try {
    // Find user
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      await logAudit(db, username, 'user', '/auth/login', 'POST', deviceId, 'DENY', 'User not found');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      await logAudit(db, username, user.role, '/auth/login', 'POST', deviceId, 'DENY', 'Invalid password');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify device is registered for this user
    const device = db.prepare('SELECT * FROM devices WHERE user_id = ? AND device_id = ?').get(user.id, deviceId);
    if (!device) {
      await logAudit(db, username, user.role, '/auth/login', 'POST', deviceId, 'DENY', 'Device not registered');
      return res.status(403).json({ error: 'Device not registered for this user' });
    }

    // Generate tokens
    const accessToken = jwt.sign(
      { sub: user.username, role: user.role, type: 'access' },
      config.jwtSecret,
      { expiresIn: `${config.accessTokenMinutes}m` }
    );

    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshExpires = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);

    // Store refresh token in database
    db.prepare(`
      INSERT INTO refresh_tokens (user_id, token, device_id, expires_at, revoked)
      VALUES (?, ?, ?, ?, 0)
    `).run(user.id, refreshToken, deviceId, refreshExpires.toISOString());

    // Update device last_used
    db.prepare('UPDATE devices SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(device.id);

    // Set refresh token cookie (httpOnly, secure in production)
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
    });

    await logAudit(db, username, user.role, '/auth/login', 'POST', deviceId, 'ALLOW', 'Login successful');

    res.json({
      accessToken,
      user: { username: user.username, role: user.role, nim: user.nim },
    });

  } catch (error) {
    console.error('Login error:', error.message);
    await logAudit(db, username, 'user', '/auth/login', 'POST', deviceId, 'DENY', 'Internal error');
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /auth/refresh
 * Cookie: refreshToken
 * Header: X-Device-ID (required)
 * Returns: { accessToken } + new refreshToken cookie
 */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  const deviceId = req.headers['x-device-id'];
  const db = req.db;
  const config = req.config;

  if (!refreshToken) {
    await logAudit(db, 'unknown', 'user', '/auth/refresh', 'POST', deviceId, 'DENY', 'Missing refresh token');
    return res.status(401).json({ error: 'Refresh token required' });
  }

  if (!deviceId) {
    await logAudit(db, 'unknown', 'user', '/auth/refresh', 'POST', null, 'DENY', 'Missing device ID');
    return res.status(400).json({ error: 'X-Device-ID header required' });
  }

  try {
    // Find refresh token in database
    const tokenRecord = db.prepare(`
      SELECT rt.*, u.username, u.role, u.nim
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token = ? AND rt.device_id = ? AND rt.revoked = 0
    `).get(refreshToken, deviceId);

    if (!tokenRecord) {
      await logAudit(db, 'unknown', 'user', '/auth/refresh', 'POST', deviceId, 'DENY', 'Invalid or revoked refresh token');
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Check expiry
    if (new Date(tokenRecord.expires_at) < new Date()) {
      await logAudit(db, tokenRecord.username, tokenRecord.role, '/auth/refresh', 'POST', deviceId, 'DENY', 'Refresh token expired');
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // Revoke old refresh token
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(tokenRecord.id);

    // Generate new tokens
    const newAccessToken = jwt.sign(
      { sub: tokenRecord.username, role: tokenRecord.role, type: 'access' },
      config.jwtSecret,
      { expiresIn: `${config.accessTokenMinutes}m` }
    );

    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const refreshExpires = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);

    // Store new refresh token
    db.prepare(`
      INSERT INTO refresh_tokens (user_id, token, device_id, expires_at, revoked)
      VALUES (?, ?, ?, ?, 0)
    `).run(tokenRecord.user_id, newRefreshToken, deviceId, refreshExpires.toISOString());

    // Set new refresh token cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
    });

    await logAudit(db, tokenRecord.username, tokenRecord.role, '/auth/refresh', 'POST', deviceId, 'ALLOW', 'Token refreshed');

    res.json({
      accessToken: newAccessToken,
      user: { username: tokenRecord.username, role: tokenRecord.role, nim: tokenRecord.nim },
    });

  } catch (error) {
    console.error('Refresh error:', error.message);
    await logAudit(db, 'unknown', 'user', '/auth/refresh', 'POST', deviceId, 'DENY', 'Internal error');
    res.status(500).json({ error: 'Refresh failed' });
  }
});

/**
 * POST /auth/logout
 * Cookie: refreshToken
 * Header: X-Device-ID (required)
 * Revokes refresh token and clears cookie
 */
router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  const deviceId = req.headers['x-device-id'];
  const db = req.db;

  if (!refreshToken || !deviceId) {
    return res.status(400).json({ error: 'Refresh token and device ID required' });
  }

  try {
    // Find and revoke refresh token
    const tokenRecord = db.prepare(`
      SELECT rt.*, u.username, u.role
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token = ? AND rt.device_id = ?
    `).get(refreshToken, deviceId);

    if (tokenRecord) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(tokenRecord.id);
      await logAudit(db, tokenRecord.username, tokenRecord.role, '/auth/logout', 'POST', deviceId, 'ALLOW', 'Logout successful');
    }

    // Clear cookie
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out' });

  } catch (error) {
    console.error('Logout error:', error.message);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * POST /auth/service
 * Body: { clientId, clientSecret }
 * Returns: { serviceToken }
 */
router.post('/service', async (req, res) => {
  const { clientId, clientSecret } = req.body;
  const db = req.db;
  const config = req.config;

  if (!clientId || !clientSecret) {
    await logAudit(db, clientId || 'unknown', 'service', '/auth/service', 'POST', null, 'DENY', 'Missing credentials');
    return res.status(400).json({ error: 'Client ID and secret required' });
  }

  try {
    // Find service client
    const client = db.prepare('SELECT * FROM service_clients WHERE client_id = ?').get(clientId);
    if (!client) {
      await logAudit(db, clientId, 'service', '/auth/service', 'POST', null, 'DENY', 'Client not found');
      return res.status(401).json({ error: 'Invalid client credentials' });
    }

    // Verify secret
    const secretMatch = await bcrypt.compare(clientSecret, client.client_secret);
    if (!secretMatch) {
      await logAudit(db, clientId, 'service', '/auth/service', 'POST', null, 'DENY', 'Invalid secret');
      return res.status(401).json({ error: 'Invalid client credentials' });
    }

    // Generate service token
    const serviceToken = jwt.sign(
      { sub: clientId, role: 'service', type: 'service', serviceName: client.service_name },
      config.jwtServiceSecret,
      { expiresIn: `${config.serviceTokenMinutes}m` }
    );

    await logAudit(db, clientId, 'service', '/auth/service', 'POST', null, 'ALLOW', 'Service authenticated');

    res.json({ serviceToken });

  } catch (error) {
    console.error('Service auth error:', error.message);
    await logAudit(db, clientId, 'service', '/auth/service', 'POST', null, 'DENY', 'Internal error');
    res.status(500).json({ error: 'Service authentication failed' });
  }
});

/**
 * Helper: Log audit decision
 */
async function logAudit(db, subject, subjectRole, endpoint, method, deviceId, decision, reason) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (subject, subject_role, endpoint, method, device_id, decision, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subject, subjectRole, endpoint, method, deviceId, decision, reason);
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
}

module.exports = router;
