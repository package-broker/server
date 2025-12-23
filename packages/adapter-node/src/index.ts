
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from '@package-broker/core';
import { Hono } from 'hono';
import { config } from 'dotenv';
import { createSqliteDatabase, migrateSqliteDatabase } from './drivers/sqlite-driver';
import { FileSystemDriver } from './drivers/fs-driver';
import { RedisDriver } from './drivers/redis-driver';
import { MemoryCacheDriver, MemoryQueueDriver } from '@package-broker/core';
import path from 'node:path';

// Load environment variables
config();

const app = new Hono();

// Configuration
const PORT = Number(process.env.PORT) || 3000;
const DB_DRIVER = process.env.DB_DRIVER || 'sqlite'; // sqlite
const DB_URL = process.env.DB_URL || 'db.sqlite';
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'fs'; // fs
const STORAGE_PATH = process.env.STORAGE_PATH || './storage';
const CACHE_DRIVER = process.env.CACHE_DRIVER || 'memory'; // memory, redis
const CACHE_URL = process.env.CACHE_URL || 'redis://localhost:6379';
const QUEUE_DRIVER = process.env.QUEUE_DRIVER || 'memory'; // memory, redis
const DISABLE_UI = process.env.DISABLE_UI === 'true';

console.log('Starting PACKAGE.broker Node Adapter...');
console.log(`Configuration: DB=${DB_DRIVER}, STORAGE=${STORAGE_DRIVER}, CACHE=${CACHE_DRIVER}, QUEUE=${QUEUE_DRIVER}`);

// Initialize Drivers
let database;
if (DB_DRIVER === 'sqlite') {
    console.log(`Initializing SQLite at ${DB_URL}`);
    database = createSqliteDatabase(DB_URL);
    // Auto-migrate on start
    // Note: In production we might want to separate this
    // await migrateSqliteDatabase(database, path.join(__dirname, '../migrations')); // TODO: Fix migrations path
} else {
    throw new Error(`Unsupported DB_DRIVER: ${DB_DRIVER}`);
}

let storage;
if (STORAGE_DRIVER === 'fs') {
    console.log(`Initializing FS Storage at ${STORAGE_PATH}`);
    storage = new FileSystemDriver(STORAGE_PATH);
} else {
    // TODO: Add S3 support
    throw new Error(`Unsupported STORAGE_DRIVER: ${STORAGE_DRIVER}`);
}

let cache;
if (CACHE_DRIVER === 'redis') {
    console.log(`Initializing Redis Cache at ${CACHE_URL}`);
    cache = new RedisDriver(CACHE_URL);
} else {
    console.log('Initializing Memory Cache');
    cache = new MemoryCacheDriver();
}

let queue;
if (QUEUE_DRIVER === 'redis' && CACHE_DRIVER === 'redis') {
    // Reuse Redis connection if possible or create new implementation
    // For now assuming RedisDriver implements both interfaces
    queue = cache as any;
} else if (QUEUE_DRIVER === 'redis') {
    const redisQueue = new RedisDriver(CACHE_URL); // Use CACHE_URL for now or add QUEUE_URL
    queue = redisQueue;
} else {
    console.log('Initializing Memory Queue');
    queue = new MemoryQueueDriver();
}

// Inject Config
const workerConfig = {
    storage: 's3' as const, // Placeholder, logic handled below
    s3Config: undefined
};

// Create Core App
// We need to modify/wrapp createApp to accept injected drivers directly?
// Currently core/src/index.ts exports createWorker which creates Hono app and adds middleware.
// The middleware in `createWorker` (packages/main/src/index.ts) is HARDCODED to use Cloudflare bindings.
// WE NEED TO REFACTOR createApp IN CORE TO ACCEPT INTERFACES.

// For now, I'll copy the logic of `createWorker` but adapted for Node.
// This means I cannot reuse `createWorker` from `@package-broker/main` because it depends on Cloudflare types.
// I should rely on `@package-broker/core` exports.

// Wait, packages/main/src/index.ts IS the worker entry point, but it contains all the app assembly logic.
// I need to EXTRACT the app logic from packages/main into packages/core so it can be reused here.
// But `implementation_plan.md` said: 
// "Use `createApp` from core instead of internal logic."
// "Refactor `packages/main/src/index.ts` to use `createApp`"

// So I must FIRST refactor `packages/main` logic into `packages/core/src/app.ts` (or similar).
// Then use it here.

// I will mark this file as TODO-REFACTOR and create it with basic structure for now.
`;

console.log('Error: Refactoring of Core required to support App Factory pattern.');
process.exit(1);
