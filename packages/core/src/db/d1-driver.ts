// Cloudflare D1 specific database driver
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Database } from './index';

export function createD1Database(d1: D1Database): Database {
    return drizzle(d1, { schema });
}
