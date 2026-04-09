import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Database } from './index';

export function createDatabase(d1: D1Database): Database {
  return drizzle(d1, { schema });
}
