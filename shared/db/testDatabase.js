/**
 * Test Database - isolated SQLite database for integration tests.
 *
 * Creates a dedicated SQLite database file in `database/zero-trust-test.db`
 * with deterministic fixtures. Demo database `database/zero-trust.db` is
 * never touched by any function in this module.
 *
 * Uses node:sqlite (built-in, same as shared/db/connection.js).
 */

const DatabaseSync = require('node:sqlite').DatabaseSync;
const fs = require('fs');
const path = require('path');

const { createTestDatabase } = require('./testFixtures');

let testDbInstance = null;
let testDbPath = null;

/**
 * Create test database at database/zero-trust-test.db and seed fixtures.
 * Removes any pre-existing test database first.
 *
 * @param {object} config - config object from loadConfig()
 * @returns {{ db: import('node:sqlite').DatabaseSync, path: string, fixtures: object }}
 */
function setupTestDatabase(config) {
  const rootDir = path.resolve(__dirname, '..', '..');
  testDbPath = path.join(rootDir, 'database', 'zero-trust-test.db');

  // Remove existing test database and sidecar files
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  for (const sidecar of ['-wal', '-shm', '-journal']) {
    const p = testDbPath + sidecar;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  testDbInstance = new DatabaseSync(testDbPath);
  testDbInstance.exec('PRAGMA foreign_keys = ON');
  testDbInstance.exec('PRAGMA journal_mode = WAL');

  const fixtures = createTestDatabase(testDbInstance, config);
  console.log(`[Test Setup] Test database created: ${testDbPath}`);

  return { db: testDbInstance, path: testDbPath, fixtures };
}

/**
 * Open a read-write connection to the test database for verification queries.
 * Safe to call multiple times; same instance is reused.
 *
 * @param {string} dbPath
 * @returns {import('node:sqlite').DatabaseSync}
 */
function getTestDatabase(dbPath) {
  if (testDbInstance) return testDbInstance;
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/**
 * Close the test database connection and delete all database files.
 * Only touches database/zero-trust-test.db (+ wal/shm/journal sidecars).
 */
function cleanupTestDatabase() {
  if (testDbInstance) {
    try {
      testDbInstance.close();
    } catch (_) {
      // ignore
    }
    testDbInstance = null;
  }

  if (testDbPath) {
    for (const sidecar of ['', '-wal', '-shm', '-journal']) {
      const p = testDbPath + sidecar;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch (_) {
          // ignore - may be locked on Windows until all handles close
        }
      }
    }
    testDbPath = null;
  }
}

module.exports = {
  setupTestDatabase,
  getTestDatabase,
  cleanupTestDatabase,
};
