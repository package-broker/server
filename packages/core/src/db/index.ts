// TODO: Define a proper generic interface for Drizzle ORM instance that covers both D1 and BetterSQLite3
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;

export * as schema from './schema';
export * from './schema';
export * from './d1-driver';

