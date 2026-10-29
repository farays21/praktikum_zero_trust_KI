/**
 * Database verification script.
 * Verifies seed data and displays demo accounts.
 */

require('dotenv').config();

const { loadConfig } = require('../config');
const { openDatabase } = require('./connection');

function verifyDatabase() {
  console.log('Verifying database...');

  const config = loadConfig();
  const db = openDatabase(config.dbPath);

  try {
    // Verify counts
    const users = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const devices = db.prepare('SELECT COUNT(*) as count FROM devices').get();
    const serviceClients = db.prepare('SELECT COUNT(*) as count FROM service_clients').get();
    const kelas = db.prepare('SELECT COUNT(*) as count FROM kelas').get();
    const enrollments = db.prepare('SELECT COUNT(*) as count FROM enrollments').get();
    const nilai = db.prepare('SELECT COUNT(*) as count FROM nilai').get();
    const transkrip = db.prepare('SELECT COUNT(*) as count FROM transkrip').get();

    console.log('\n=== Database Counts ===');
    console.log(`Users:           ${users.count} (expected: 6)`);
    console.log(`Devices:         ${devices.count} (expected: 6)`);
    console.log(`Service Clients: ${serviceClients.count} (expected: 2)`);
    console.log(`Kelas:           ${kelas.count} (expected: 2)`);
    console.log(`Enrollments:     ${enrollments.count} (expected: 4)`);
    console.log(`Nilai:           ${nilai.count} (expected: 4)`);
    console.log(`Transkrip:       ${transkrip.count} (expected: 3)`);

    // Verify role distribution
    const roleCount = db.prepare(`
      SELECT role, COUNT(*) as count 
      FROM users 
      GROUP BY role 
      ORDER BY role
    `).all();

    console.log('\n=== User Role Distribution ===');
    roleCount.forEach(r => {
      console.log(`${r.role}: ${r.count}`);
    });

    // Display demo accounts
    const userDevices = db.prepare(`
      SELECT u.username, u.role, u.nim, d.device_id, d.device_name
      FROM users u
      JOIN devices d ON u.id = d.user_id
      ORDER BY 
        CASE u.role 
          WHEN 'admin' THEN 1 
          WHEN 'dosen' THEN 2 
          WHEN 'mahasiswa' THEN 3 
        END,
        u.username
    `).all();

    console.log('\n=== Demo Accounts (for README/Testing) ===');
    console.log('Username       | Password    | Role       | NIM     | Device ID       | Device Name');
    console.log('---------------|-------------|------------|---------|-----------------|------------------');
    
    const passwords = {
      'admin1': 'Admin@123',
      'dosen1': 'Dosen@123',
      'dosen2': 'Dosen@456',
      'mahasiswa1': 'Mhs@123',
      'mahasiswa2': 'Mhs@456',
      'mahasiswa3': 'Mhs@789'
    };

    userDevices.forEach(u => {
      const nim = u.nim || '-';
      console.log(
        `${u.username.padEnd(14)} | ${passwords[u.username].padEnd(11)} | ${u.role.padEnd(10)} | ${nim.padEnd(7)} | ${u.device_id.padEnd(15)} | ${u.device_name}`
      );
    });

    // Display kelas info
    const kelasInfo = db.prepare(`
      SELECT k.kode_kelas, k.nama_matakuliah, u.username as dosen, k.sks
      FROM kelas k
      JOIN users u ON k.dosen_id = u.id
      ORDER BY k.kode_kelas
    `).all();

    console.log('\n=== Kelas ===');
    console.log('Kode     | Matakuliah          | Dosen   | SKS');
    console.log('---------|---------------------|---------|----');
    kelasInfo.forEach(k => {
      console.log(`${k.kode_kelas.padEnd(8)} | ${k.nama_matakuliah.padEnd(19)} | ${k.dosen.padEnd(7)} | ${k.sks}`);
    });

    // Display enrollments
    const enrollInfo = db.prepare(`
      SELECT u.username, k.kode_kelas
      FROM enrollments e
      JOIN users u ON e.mahasiswa_id = u.id
      JOIN kelas k ON e.kelas_id = k.id
      ORDER BY u.username, k.kode_kelas
    `).all();

    console.log('\n=== Enrollments ===');
    console.log('Mahasiswa   | Kelas');
    console.log('------------|--------');
    enrollInfo.forEach(e => {
      console.log(`${e.username.padEnd(11)} | ${e.kode_kelas}`);
    });

    // Display nilai
    const nilaiInfo = db.prepare(`
      SELECT u.username, k.kode_kelas, n.nilai, n.status
      FROM nilai n
      JOIN users u ON n.mahasiswa_id = u.id
      JOIN kelas k ON n.kelas_id = k.id
      ORDER BY u.username, k.kode_kelas
    `).all();

    console.log('\n=== Nilai (Initial) ===');
    console.log('Mahasiswa   | Kelas    | Nilai | Status');
    console.log('------------|----------|-------|-------');
    nilaiInfo.forEach(n => {
      console.log(`${n.username.padEnd(11)} | ${n.kode_kelas.padEnd(8)} | ${String(n.nilai).padEnd(5)} | ${n.status}`);
    });

    // Display service clients
    const services = db.prepare(`
      SELECT client_id, service_name
      FROM service_clients
      ORDER BY client_id
    `).all();

    console.log('\n=== Service Clients ===');
    console.log('Client ID         | Service Name');
    console.log('------------------|----------------');
    services.forEach(s => {
      console.log(`${s.client_id.padEnd(17)} | ${s.service_name}`);
    });

    console.log('\n=== Verification Summary ===');
    const allPassed = 
      users.count === 6 &&
      devices.count === 6 &&
      serviceClients.count === 2 &&
      kelas.count === 2 &&
      enrollments.count === 4 &&
      nilai.count === 4 &&
      transkrip.count === 3;

    if (allPassed) {
      console.log('✓ All counts match expected values');
      console.log('✓ Database verification PASSED');
    } else {
      console.log('✗ Some counts do not match expected values');
      console.log('✗ Database verification FAILED');
    }

    console.log('\n=== Important Notes ===');
    console.log('• IPK is NULL - grade conversion rules not defined in specification');
    console.log('• All nilai are in draft status initially');
    console.log('• Service client secrets are bcrypt hashed');
    console.log('• All passwords are bcrypt hashed');
    console.log('• Device IDs are static for demo purposes');

    return allPassed;

  } catch (error) {
    console.error('✗ Verification failed:', error.message);
    throw error;
  } finally {
    db.close();
  }
}

// Run if called directly
if (require.main === module) {
  try {
    const passed = verifyDatabase();
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error('\n✗ Verification failed');
    process.exit(1);
  }
}

module.exports = { verifyDatabase };
