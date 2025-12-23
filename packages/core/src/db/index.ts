import { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

// TODO: Define a proper generic interface for Drizzle ORM instance that covers both D1 and BetterSQLite3
export type Database = any;

export * from './schema';
export * from './d1-driver';

