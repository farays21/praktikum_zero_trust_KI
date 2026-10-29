/**
 * Service Transkrip — internal service on port 3002.
 * IPK remains null because official grade-conversion weights are unspecified.
 */

require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { loadConfig } = require('../../shared/config');
const { openDatabase } = require('../../shared/db/connection');

const app = express();
const config = loadConfig();
const db = openDatabase(config.dbPath);

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

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

app.use(requireGateway);

app.get('/transkrip/:nim', (req, res) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Access token required' });

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token';
    return res.status(401).json({ error: message });
  }
  if (decoded.type !== 'access' || !['mahasiswa', 'admin'].includes(decoded.role)) {
    return res.status(403).json({ error: 'User access token required' });
  }

  const owner = req.db.prepare('SELECT id, role, nim FROM users WHERE username = ?').get(decoded.sub);
  if (!owner || (owner.role === 'mahasiswa' && owner.nim !== req.params.nim)) {
    return res.status(403).json({ error: 'Transcript ownership denied' });
  }

  const transcript = req.db.prepare(`
    SELECT t.nim, u.username, u.nama, t.total_sks, t.ipk, t.last_updated
    FROM transkrip t JOIN users u ON u.id = t.mahasiswa_id
    WHERE t.nim = ?
  `).get(req.params.nim);
  if (!transcript) return res.status(404).json({ error: 'Transcript not found' });

  const courses = req.db.prepare(`
    SELECT k.kode_kelas, k.nama_matakuliah, k.sks, k.semester, n.nilai, n.status
    FROM nilai n
    JOIN kelas k ON k.id = n.kelas_id
    JOIN users u ON u.id = n.mahasiswa_id
    WHERE u.nim = ? AND n.status = 'final'
    ORDER BY k.kode_kelas
  `).all(req.params.nim);

  res.json({
    ...transcript,
    courses,
    ipkNote: 'IPK is not calculated because grade conversion rules are not defined.',
  });
});

app.post('/transkrip/sinkron', (req, res) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Service token required' });

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtServiceSecret);
  } catch (error) {
    try {
      jwt.verify(token, config.jwtSecret);
      return res.status(403).json({ error: 'Service token required' });
    } catch {
      const message = error.name === 'TokenExpiredError' ? 'Service token expired' : 'Invalid service token';
      return res.status(401).json({ error: message });
    }
  }
  if (decoded.type !== 'service' || decoded.sub !== 'nilai-service') {
    return res.status(403).json({ error: 'Nilai service token required' });
  }

  const kelasId = Number(req.body.kelasId);
  const kelas = req.db.prepare('SELECT id, sks FROM kelas WHERE id = ?').get(kelasId);
  if (!kelas) return res.status(404).json({ error: 'Class not found' });

  const students = req.db.prepare(`
    SELECT DISTINCT u.id, u.nim
    FROM nilai n JOIN users u ON u.id = n.mahasiswa_id
    WHERE n.kelas_id = ? AND n.status = 'final'
  `).all(kelas.id);

  req.db.exec('BEGIN IMMEDIATE');
  try {
    // Use UPSERT to handle missing transcript records
    const upsert = req.db.prepare(`
      INSERT INTO transkrip (mahasiswa_id, nim, total_sks, ipk, last_updated)
      VALUES (
        ?,
        ?,
        (SELECT COALESCE(SUM(k.sks), 0)
         FROM nilai n JOIN kelas k ON k.id = n.kelas_id
         WHERE n.mahasiswa_id = ? AND n.status = 'final'),
        NULL,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(mahasiswa_id) DO UPDATE SET
        total_sks = (SELECT COALESCE(SUM(k.sks), 0)
                     FROM nilai n JOIN kelas k ON k.id = n.kelas_id
                     WHERE n.mahasiswa_id = mahasiswa_id AND n.status = 'final'),
        ipk = NULL,
        last_updated = CURRENT_TIMESTAMP
    `);
    
    for (const student of students) {
      upsert.run(student.id, student.nim, student.id);
    }
    
    req.db.exec('COMMIT');
    res.json({
      kelasId: kelas.id,
      synchronizedStudents: students.map((student) => student.nim),
      ipkCalculated: false,
    });
  } catch (error) {
    req.db.exec('ROLLBACK');
    console.error('Sync error:', error.message);
    res.status(500).json({ error: 'Synchronization failed and was rolled back' });
  }
});

app.use((error, req, res, next) => {
  console.error('Transkrip service error:', error.message);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(3002, () => console.log('Service Transkrip running on http://localhost:3002'));
}

module.exports = app;
