/**
 * Add draft grades to existing database for testing
 */
require('dotenv').config();
const { loadConfig } = require('./shared/config');
const { openDatabase } = require('./shared/db/connection');

const config = loadConfig();
const db = openDatabase(config.dbPath);

// Reset all final grades to draft for testing
const result = db.prepare(`
  UPDATE nilai 
  SET status = 'draft', finalized_at = NULL, finalized_by = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE status = 'final'
`).run();

console.log(`✓ Reset ${result.changes} grades to draft status`);

const draftCount = db.prepare("SELECT COUNT(*) as count FROM nilai WHERE status = 'draft'").get();
console.log(`✓ Total draft grades: ${draftCount.count}`);
console.log('✓ Ready for testing');

db.close();
