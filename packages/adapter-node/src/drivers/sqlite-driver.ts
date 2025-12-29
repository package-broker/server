import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { schema, type DatabasePort, type DatabaseDriver } from '@package-broker/core';
import path from 'node:path';

export interface SqliteConnection {
    db: DatabasePort;
    sqlite: Database.Database;
}

/**
 * Create a SQLite database connection
 */
export function createSqliteDatabase(dbPath: string): SqliteConnection {
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });

    return { db: db as any, sqlite };
}

/**
 * SQLite Database Driver
 * Implements DatabaseDriver interface for SQLite using Drizzle ORM
 */
export class SqliteDriver implements DatabaseDriver {
    private connection: SqliteConnection;

    constructor(dbPath: string) {
        this.connection = createSqliteDatabase(dbPath);
    }

    /**
     * Check if database is initialized by checking for Drizzle's migrations table
     * This is database-agnostic as Drizzle uses __drizzle_migrations for all databases
     */
    async isInitialized(): Promise<boolean> {
        const { sqlite } = this.connection;
        try {
            // Check for Drizzle's migration tracking table (database-agnostic approach)
            const result = sqlite.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'"
            ).get();
            return !!result;
        } catch {
            return false;
        }
    }

    /**
     * Run migrations using Drizzle's migrator
     * Uses migration files from the specified path (e.g., packages/main/migrations)
     */
    async runMigrations(migrationsPath: string): Promise<void> {
        const { db } = this.connection;
        const absolutePath = path.isAbsolute(migrationsPath) 
            ? migrationsPath 
            : path.join(process.cwd(), migrationsPath);
        
        await migrate(db as any, { migrationsFolder: absolutePath });
    }

    /**
     * Get the database connection/ORM instance
     */
    getConnection(): DatabasePort {
        return this.connection.db;
    }

    /**
     * Get the raw SQLite connection (for driver-specific operations if needed)
     */
    getSqliteConnection(): Database.Database {
        return this.connection.sqlite;
    }
}
