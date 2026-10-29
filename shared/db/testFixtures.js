/**
 * Test Fixtures - Create isolated test database with deterministic data.
 * Used by integration tests to avoid polluting demo database.
 */

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

function createTestDatabase(db, config) {
  console.log('[Test Setup] Creating test database schema and fixtures...');

  const bcryptRounds = config.bcryptRounds;

  // Read and execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Hash passwords
  const adminPass = bcrypt.hashSync('Admin@123', bcryptRounds);
  const dosenPass1 = bcrypt.hashSync('Dosen@123', bcryptRounds);
  const dosenPass2 = bcrypt.hashSync('Dosen@456', bcryptRounds);
  const mhsPass1 = bcrypt.hashSync('Mhs@123', bcryptRounds);
  const mhsPass2 = bcrypt.hashSync('Mhs@456', bcryptRounds);
  const mhsPass3 = bcrypt.hashSync('Mhs@789', bcryptRounds);

  // Hash service client secrets
  const nilaiSecret = bcrypt.hashSync(config.serviceClients.nilai.clientSecret, bcryptRounds);
  const transkripSecret = bcrypt.hashSync(config.serviceClients.transkrip.clientSecret, bcryptRounds);

  // Insert users
  const insertUser = db.prepare(`
    INSERT INTO users (username, password, nama, nim, role)
    VALUES (?, ?, ?, ?, ?)
  `);

  const admin1 = insertUser.run('admin1', adminPass, 'Administrator Satu', null, 'admin');
  const dosen1 = insertUser.run('dosen1', dosenPass1, 'Dosen Satu', null, 'dosen');
  const dosen2 = insertUser.run('dosen2', dosenPass2, 'Dosen Dua', null, 'dosen');
  const mhs1 = insertUser.run('mahasiswa1', mhsPass1, 'Mahasiswa Satu', '2024001', 'mahasiswa');
  const mhs2 = insertUser.run('mahasiswa2', mhsPass2, 'Mahasiswa Dua', '2024002', 'mahasiswa');
  const mhs3 = insertUser.run('mahasiswa3', mhsPass3, 'Mahasiswa Tiga', '2024003', 'mahasiswa');

  // Insert devices
  const insertDevice = db.prepare(`
    INSERT INTO devices (user_id, device_id, device_name)
    VALUES (?, ?, ?)
  `);

  insertDevice.run(admin1.lastInsertRowid, 'dev-admin-001', 'Chrome Windows');
  insertDevice.run(dosen1.lastInsertRowid, 'dev-dosen-001', 'Safari macOS');
  insertDevice.run(dosen2.lastInsertRowid, 'dev-dosen-002', 'Firefox Linux');
  insertDevice.run(mhs1.lastInsertRowid, 'dev-mhs-001', 'Chrome Windows');
  insertDevice.run(mhs2.lastInsertRowid, 'dev-mhs-002', 'Safari iOS');
  insertDevice.run(mhs3.lastInsertRowid, 'dev-mhs-003', 'Firefox Android');

  // Insert service clients
  const insertServiceClient = db.prepare(`
    INSERT INTO service_clients (client_id, client_secret, service_name)
    VALUES (?, ?, ?)
  `);

  insertServiceClient.run(
    config.serviceClients.nilai.clientId,
    nilaiSecret,
    config.serviceClients.nilai.serviceName
  );
  insertServiceClient.run(
    config.serviceClients.transkrip.clientId,
    transkripSecret,
    config.serviceClients.transkrip.serviceName
  );

  // Insert kelas
  const insertKelas = db.prepare(`
    INSERT INTO kelas (kode_kelas, nama_matakuliah, dosen_id, semester, tahun_ajaran, sks)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const kelas1 = insertKelas.run('PROG101', 'Pemrograman Dasar', dosen1.lastInsertRowid, '1', '2024/2025', 3);
  const kelas2 = insertKelas.run('DB101', 'Basis Data', dosen2.lastInsertRowid, '2', '2024/2025', 3);

  // Insert enrollments
  const insertEnrollment = db.prepare(`
    INSERT INTO enrollments (mahasiswa_id, kelas_id)
    VALUES (?, ?)
  `);

  insertEnrollment.run(mhs1.lastInsertRowid, kelas1.lastInsertRowid); // mhs1 -> PROG101
  insertEnrollment.run(mhs1.lastInsertRowid, kelas2.lastInsertRowid); // mhs1 -> DB101
  insertEnrollment.run(mhs2.lastInsertRowid, kelas1.lastInsertRowid); // mhs2 -> PROG101
  insertEnrollment.run(mhs3.lastInsertRowid, kelas2.lastInsertRowid); // mhs3 -> DB101

  // Insert nilai (ALL DRAFT for testing)
  const insertNilai = db.prepare(`
    INSERT INTO nilai (mahasiswa_id, kelas_id, nilai, status)
    VALUES (?, ?, ?, ?)
  `);

  insertNilai.run(mhs1.lastInsertRowid, kelas1.lastInsertRowid, 85, 'draft');
  insertNilai.run(mhs1.lastInsertRowid, kelas2.lastInsertRowid, 90, 'draft');
  insertNilai.run(mhs2.lastInsertRowid, kelas1.lastInsertRowid, 78, 'draft');
  insertNilai.run(mhs3.lastInsertRowid, kelas2.lastInsertRowid, 88, 'draft');

  // Insert transkrip
  const insertTranskrip = db.prepare(`
    INSERT INTO transkrip (mahasiswa_id, nim, total_sks, ipk)
    VALUES (?, ?, ?, ?)
  `);

  insertTranskrip.run(mhs1.lastInsertRowid, '2024001', 0, null);
  insertTranskrip.run(mhs2.lastInsertRowid, '2024002', 0, null);
  insertTranskrip.run(mhs3.lastInsertRowid, '2024003', 0, null);

  console.log('[Test Setup] Test database ready with deterministic fixtures');
  
  return {
    users: {
      admin1: admin1.lastInsertRowid,
      dosen1: dosen1.lastInsertRowid,
      dosen2: dosen2.lastInsertRowid,
      mhs1: mhs1.lastInsertRowid,
      mhs2: mhs2.lastInsertRowid,
      mhs3: mhs3.lastInsertRowid,
    },
    kelas: {
      prog101: kelas1.lastInsertRowid,
      db101: kelas2.lastInsertRowid,
    },
  };
}

module.exports = { createTestDatabase };
