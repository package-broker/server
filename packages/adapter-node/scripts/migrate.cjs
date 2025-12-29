#!/usr/bin/env node

/**
 * Database Migration Script (Self-contained)
 * Runs SQL migrations for SQLite database
 * 
 * Usage:
 *   node scripts/migrate.cjs <db_path> [migrations_path]
 * 
 * Example:
 *   node scripts/migrate.cjs /data/database.sqlite
 *   node scripts/migrate.cjs /data/database.sqlite /app/packages/main/migrations
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.argv[2];
const migrationsPath = process.argv[3] || 'packages/main/migrations';

if (!dbPath) {
    console.error('❌ Error: Database path is required');
    console.error('Usage: node scripts/migrate.cjs <db_path> [migrations_path]');
    process.exit(1);
}

function runMigrations() {
    try {
        console.log(`Initializing database at: ${dbPath}`);
        
        // Create SQLite connection
        const sqlite = new Database(dbPath);
        
        const absoluteMigrationsPath = path.isAbsolute(migrationsPath)
            ? migrationsPath
            : path.join(process.cwd(), migrationsPath);
        
        console.log(`Running migrations from: ${absoluteMigrationsPath}`);
        
        // Create migrations tracking table if it doesn't exist
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS __applied_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Get list of already applied migrations
        const appliedMigrations = new Set(
            sqlite.prepare('SELECT name FROM __applied_migrations').all().map(row => row.name)
        );
        
        // Get all SQL migration files sorted by name
        const migrationFiles = fs.readdirSync(absoluteMigrationsPath)
            .filter(file => file.endsWith('.sql'))
            .sort();
        
        if (migrationFiles.length === 0) {
            console.log('No migration files found.');
            sqlite.close();
            process.exit(0);
        }
        
        let appliedCount = 0;
        
        for (const file of migrationFiles) {
            if (appliedMigrations.has(file)) {
                console.log(`  ⏭️  ${file} (already applied)`);
                continue;
            }
            
            const filePath = path.join(absoluteMigrationsPath, file);
            const sql = fs.readFileSync(filePath, 'utf-8');
            
            console.log(`  📄 Applying: ${file}`);
            
            try {
                // Run migration in a transaction
                sqlite.exec('BEGIN TRANSACTION');
                sqlite.exec(sql);
                sqlite.prepare('INSERT INTO __applied_migrations (name) VALUES (?)').run(file);
                sqlite.exec('COMMIT');
                appliedCount++;
            } catch (err) {
                sqlite.exec('ROLLBACK');
                // Check if error is due to already existing table/column (safe to ignore)
                if (err.message.includes('already exists') || err.message.includes('duplicate column')) {
                    console.log(`  ⚠️  ${file}: ${err.message} (continuing)`);
                    sqlite.prepare('INSERT OR IGNORE INTO __applied_migrations (name) VALUES (?)').run(file);
                } else {
                    throw err;
                }
            }
        }
        
        // Close connection
        sqlite.close();
        
        console.log(`\n✅ Database migrations completed (${appliedCount} applied)`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runMigrations();
