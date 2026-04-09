import { drizzle } from 'drizzle-orm/d1';
import { schema, type Database } from '@package-broker/core';

export function createD1Database(d1: D1Database): Database {
  return drizzle(d1, { schema });
}
