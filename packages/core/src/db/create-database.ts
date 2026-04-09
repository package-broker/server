import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Database } from './index';

/**
 * Create a Drizzle database instance from a D1-compatible binding.
 * Accepts 'unknown' to avoid importing Cloudflare types in core.
 * The caller (main or adapter-node) is responsible for passing the correct binding.
 */
export function createDatabase(d1Binding: unknown): Database {
  // drizzle() from drizzle-orm/d1 accepts the D1Database binding at runtime
  // We type it as unknown here to keep core free of Cloudflare types
  return drizzle(d1Binding as Parameters<typeof drizzle>[0], { schema });
}
