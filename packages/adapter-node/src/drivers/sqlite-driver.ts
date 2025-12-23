
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { schema, type DatabasePort } from '@package-broker/core';

export function createSqliteDatabase(dbPath: string): DatabasePort {
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });

    // Create method to satisfy the DatabasePort interface if strictly typed, 
    // but usually generic ORM usages work fine. 
    // Note: DatabasePort in core is currently aliased to DrizzleD1Database<typeof schema>.
    // We need to make sure core/db/index.ts types are flexible enough.
    // Ideally, core should export a generic Drizzle type.

    return db as any;
}

export async function migrateSqliteDatabase(db: ReturnType<typeof drizzle>, migrationsFolder: string) {
    // This helper runs migrations on startup
    await migrate(db, { migrationsFolder });
}
