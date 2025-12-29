#!/usr/bin/env node

/**
 * Database Migration Script
 * Runs Drizzle migrations for SQLite database
 * 
 * Usage:
 *   node scripts/migrate.js <db_path> [migrations_path]
 * 
 * Example:
 *   node scripts/migrate.js /data/database.sqlite
 *   node scripts/migrate.js /data/database.sqlite /app/packages/main/migrations
 */

const { SqliteDriver } = require('../dist/drivers/sqlite-driver.cjs');
const path = require('path');

const dbPath = process.argv[2];
const migrationsPath = process.argv[3] || 'packages/main/migrations';

if (!dbPath) {
    console.error('❌ Error: Database path is required');
    console.error('Usage: node scripts/migrate.js <db_path> [migrations_path]');
    process.exit(1);
}

async function runMigrations() {
    try {
        console.log(`Initializing database at: ${dbPath}`);
        const driver = new SqliteDriver(dbPath);
        
        const absoluteMigrationsPath = path.isAbsolute(migrationsPath)
            ? migrationsPath
            : path.join(process.cwd(), migrationsPath);
        
        console.log(`Running migrations from: ${absoluteMigrationsPath}`);
        await driver.runMigrations(absoluteMigrationsPath);
        
        console.log('✅ Database migrations completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runMigrations();
