/**
 * Database seeding script.
 * Seeds demo accounts, devices, kelas, enrollments, nilai, and service clients.
 * Safe to run multiple times - checks for existing data before inserting.
 */

const bcrypt = require('bcryptjs');
require('dotenv').config();

const { loadConfig } = require('../config');
const { openDatabase } = require('./connection');

function seedDatabase() {
  console.log('Starting database seeding...');

  const config = loadConfig();
  const db = openDatabase(config.dbPath);

  try {
    // Check if already seeded
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount > 0) {
      console.log('⚠ Database already contains data. Skipping seed to avoid duplicates.');
      console.log('  To re-seed, delete the database file and run db:setup again.');
      return false;
    }

    const bcryptRounds = config.bcryptRounds;

    // Hash passwords
    console.log('Hashing passwords...');
    const adminPass = bcrypt.hashSync('Admin@123', bcryptRounds);
    const dosenPass1 = bcrypt.hashSync('Dosen@123', bcryptRounds);
    const dosenPass2 = bcrypt.hashSync('Dosen@456', bcryptRounds);
    const mhsPass1 = bcrypt.hashSync('Mhs@123', bcryptRounds);
    const mhsPass2 = bcrypt.hashSync('Mhs@456', bcryptRounds);
    const mhsPass3 = bcrypt.hashSync('Mhs@789', bcryptRounds);

    // Hash service client secrets
    const nilaiSecret = bcrypt.hashSync(config.serviceClients.nilai.clientSecret, bcryptRounds);
    const transkripSecret = bcrypt.hashSync(config.serviceClients.transkrip.clientSecret, bcryptRounds);

    // Seed users
    console.log('Seeding users...');
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

    console.log(`✓ Created ${6} users`);

    // Seed devices (1 per user)
    console.log('Seeding devices...');
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

    console.log(`✓ Created ${6} devices`);

    // Seed service clients
    console.log('Seeding service clients...');
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

    console.log(`✓ Created ${2} service clients`);

    // Seed kelas (2 kelas dengan dosen berbeda)
    console.log('Seeding kelas...');
    const insertKelas = db.prepare(`
      INSERT INTO kelas (kode_kelas, nama_matakuliah, dosen_id, semester, tahun_ajaran, sks)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const kelas1 = insertKelas.run('PROG101', 'Pemrograman Dasar', dosen1.lastInsertRowid, '1', '2024/2025', 3);
    const kelas2 = insertKelas.run('DB101', 'Basis Data', dosen2.lastInsertRowid, '2', '2024/2025', 3);

    console.log(`✓ Created ${2} kelas`);

    // Seed enrollments
    console.log('Seeding enrollments...');
    const insertEnrollment = db.prepare(`
      INSERT INTO enrollments (mahasiswa_id, kelas_id)
      VALUES (?, ?)
    `);

    insertEnrollment.run(mhs1.lastInsertRowid, kelas1.lastInsertRowid); // mhs1 -> PROG101
    insertEnrollment.run(mhs1.lastInsertRowid, kelas2.lastInsertRowid); // mhs1 -> DB101
    insertEnrollment.run(mhs2.lastInsertRowid, kelas1.lastInsertRowid); // mhs2 -> PROG101
    insertEnrollment.run(mhs3.lastInsertRowid, kelas2.lastInsertRowid); // mhs3 -> DB101

    console.log(`✓ Created ${4} enrollments`);

    // Seed nilai (draft status)
    console.log('Seeding nilai...');
    const insertNilai = db.prepare(`
      INSERT INTO nilai (mahasiswa_id, kelas_id, nilai, status)
      VALUES (?, ?, ?, ?)
    `);

    insertNilai.run(mhs1.lastInsertRowid, kelas1.lastInsertRowid, 85, 'draft');
    insertNilai.run(mhs1.lastInsertRowid, kelas2.lastInsertRowid, 90, 'draft');
    insertNilai.run(mhs2.lastInsertRowid, kelas1.lastInsertRowid, 78, 'draft');
    insertNilai.run(mhs3.lastInsertRowid, kelas2.lastInsertRowid, 88, 'draft');

    console.log(`✓ Created ${4} nilai (draft status)`);

    // Seed transkrip (initial empty records)
    console.log('Seeding transkrip...');
    const insertTranskrip = db.prepare(`
      INSERT INTO transkrip (mahasiswa_id, nim, total_sks, ipk)
      VALUES (?, ?, ?, ?)
    `);

    insertTranskrip.run(mhs1.lastInsertRowid, '2024001', 0, null);
    insertTranskrip.run(mhs2.lastInsertRowid, '2024002', 0, null);
    insertTranskrip.run(mhs3.lastInsertRowid, '2024003', 0, null);

    console.log(`✓ Created ${3} transkrip records (IPK pending - no conversion rules defined)`);

    console.log('\n✓ Seeding complete');
    return true;

  } catch (error) {
    console.error('✗ Seeding failed:', error.message);
    throw error;
  } finally {
    db.close();
  }
}

// Run if called directly
if (require.main === module) {
  try {
    seedDatabase();
  } catch (error) {
    console.error('\n✗ Seeding failed');
    process.exit(1);
  }
}

module.exports = { seedDatabase };
