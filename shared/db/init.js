/**
 * Database initialization script.
 * Creates all tables from schema.sql.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { loadConfig } = require('../config');
const { openDatabase } = require('./connection');

function initializeDatabase() {
  console.log('Starting database initialization...');

  const config = loadConfig();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const db = openDatabase(config.dbPath);

  try {
    // Test database connection first
    console.log(`Database path: ${config.dbPath}`);
    
    // Execute schema (supports multiple statements)
    db.exec(schema);
    console.log('✓ Database schema created successfully');
    console.log(`✓ Database location: ${config.dbPath}`);

    // Verify tables created
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    console.log(`✓ Created ${tables.length} tables:`);
    tables.forEach(table => {
      console.log(`  - ${table.name}`);
    });

    return true;
  } catch (error) {
    console.error('✗ Database initialization failed:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  } finally {
    db.close();
  }
}

// Run if called directly
if (require.main === module) {
  try {
    initializeDatabase();
    console.log('\n✓ Initialization complete');
  } catch (error) {
    console.error('\n✗ Initialization failed');
    process.exit(1);
  }
}

module.exports = { initializeDatabase };
