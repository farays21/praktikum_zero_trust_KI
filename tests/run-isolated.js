/**
 * Comprehensive Test Runner with Isolated Database
 * Starts all services with test database, runs service integration tests,
 * then stops services and removes test database.
 *
 * Usage: npm run test:services:isolated
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const testDbPath = path.resolve(__dirname, '..', 'database', 'zero-trust-test.db');
let services = [];
let exitCode = 0;

function log(message) {
  console.log(`[Test Runner] ${message}`);
}

/**
 * Clean up test database files
 */
function cleanupTestDb() {
  const files = [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`, `${testDbPath}-journal`];
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {
      // Ignore errors during cleanup
    }
  }
}

/**
 * Create test database using init.js and seed.js
 */
async function createTestDatabase() {
  log('Creating test database...');
  
  // Run init.js with DB_PATH set
  await new Promise((resolve, reject) => {
    const initProc = spawn('node', ['shared/db/init.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_PATH: testDbPath },
      stdio: 'inherit',
    });
    
    initProc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`init.js failed with code ${code}`));
    });
  });
  
  // Run seed.js with DB_PATH set
  await new Promise((resolve, reject) => {
    const seedProc = spawn('node', ['shared/db/seed.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_PATH: testDbPath },
      stdio: 'inherit',
    });
    
    seedProc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`seed.js failed with code ${code}`));
    });
  });
  
  log(`Test database created: ${testDbPath}`);
}

/**
 * Start a service
 */
function startService(name, script) {
  return new Promise((resolve, reject) => {
    log(`Starting ${name}...`);
    
    const proc = spawn('node', [script], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        DB_PATH: testDbPath,
        ALLOW_POLICY_TIME_OVERRIDE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        reject(new Error(`${name} failed to start within 10 seconds`));
      }
    }, 10000);
    
    proc.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[${name}] ${output.trim()}`);
      
      if (/running on|listening/i.test(output) && !started) {
        started = true;
        clearTimeout(timeout);
        log(`${name} started successfully`);
        services.push({ name, proc });
        resolve();
      }
    });
    
    proc.stderr.on('data', (data) => {
      console.error(`[${name} ERROR] ${data.toString().trim()}`);
    });
    
    proc.on('exit', (code) => {
      if (!started && code !== 0) {
        reject(new Error(`${name} exited with code ${code}`));
      }
    });
  });
}

/**
 * Stop all services
 */
function stopServices() {
  log('Stopping services...');
  for (const { name, proc } of services) {
    try {
      proc.kill('SIGTERM');
      log(`${name} stopped`);
    } catch (err) {
      // Ignore
    }
  }
  services = [];
}

/**
 * Run tests
 */
async function runTests() {
  log('Running service integration tests...');
  
  return new Promise((resolve) => {
    const testProc = spawn('node', ['tests/services-isolated.test.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        TEST_DB_PATH: testDbPath,
        ALLOW_POLICY_TIME_OVERRIDE: '1',
      },
      stdio: 'inherit',
    });
    
    testProc.on('exit', (code) => {
      resolve(code || 0);
    });
  });
}

/**
 * Main
 */
async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Zero Trust Security - Isolated Integration Test Suite  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  try {
    // Clean up any existing test database
    cleanupTestDb();
    
    // Create fresh test database
    await createTestDatabase();
    
    // Wait a bit for file system
    await new Promise(r => setTimeout(r, 1000));
    
    // Start services
    await startService('Gateway', 'gateway/server.js');
    await startService('Service Nilai', 'services/nilai/server.js');
    await startService('Service Transkrip', 'services/transkrip/server.js');
    
    // Wait for services to be fully ready
    await new Promise(r => setTimeout(r, 2000));
    
    // Run tests
    exitCode = await runTests();
    
    log('Test execution completed');
    
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    exitCode = 1;
  } finally {
    stopServices();
    
    // Wait for services to fully stop
    await new Promise(r => setTimeout(r, 1000));
    
    // Clean up test database
    log('Cleaning up test database...');
    cleanupTestDb();
    
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    if (exitCode === 0) {
      console.log('║  ✓ ALL TESTS PASSED                                       ║');
    } else {
      console.log('║  ✗ SOME TESTS FAILED                                      ║');
    }
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    process.exit(exitCode);
  }
}

// Handle interrupts
process.on('SIGINT', () => {
  log('Received SIGINT, cleaning up...');
  stopServices();
  cleanupTestDb();
  process.exit(130);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, cleaning up...');
  stopServices();
  cleanupTestDb();
  process.exit(143);
});

main().catch((err) => {
  console.error('Fatal error:', err);
  stopServices();
  cleanupTestDb();
  process.exit(1);
});
