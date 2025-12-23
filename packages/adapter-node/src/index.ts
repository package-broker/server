
import { serve } from '@hono/node-server';
import { createApp, type AppInstance } from '@package-broker/core';
import { config } from 'dotenv';
import { createSqliteDatabase, migrateSqliteDatabase } from './drivers/sqlite-driver.js';
import { FileSystemDriver } from './drivers/fs-driver.js';
import { RedisDriver } from './drivers/redis-driver.js';
import { MemoryCacheDriver, MemoryQueueDriver } from '@package-broker/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import type { Context, Next } from 'hono';

// Load environment variables
config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const PORT = Number(process.env.PORT) || 3000;
const DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
const DB_URL = process.env.DB_URL || 'db.sqlite';
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'fs';
const STORAGE_PATH = process.env.STORAGE_PATH || './storage';
const CACHE_DRIVER = process.env.CACHE_DRIVER || 'memory';
const CACHE_URL = process.env.CACHE_URL || 'redis://localhost:6379';
const QUEUE_DRIVER = process.env.QUEUE_DRIVER || 'memory';

console.log('Starting PACKAGE.broker Node Adapter...');
console.log(`Configuration: DB=${DB_DRIVER}, STORAGE=${STORAGE_DRIVER}, CACHE=${CACHE_DRIVER}, QUEUE=${QUEUE_DRIVER}`);

async function start() {
    // Initialize Drivers
    let database;
    if (DB_DRIVER === 'sqlite') {
        console.log(`Initializing SQLite at ${DB_URL}`);
        database = createSqliteDatabase(DB_URL);
        // Auto-migrate on start (simplified for MVP)
        // In real deployment, migrations should be separate step
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
    if (QUEUE_DRIVER === 'redis') {
        if (CACHE_DRIVER === 'redis') {
            queue = cache as any; // RedisDriver implements both
        } else {
            console.log(`Initializing Redis Queue at ${CACHE_URL}`);
            queue = new RedisDriver(CACHE_URL);
        }
    } else {
        console.log('Initializing Memory Queue');
        queue = new MemoryQueueDriver();
    }

    // Create App
    const app = createApp({
        database,
        storage,
        onInit: (appInstance: AppInstance) => {
            // Inject non-standard drivers if needed or custom middleware
            appInstance.use('*', async (c: Context, next: Next) => {
                // We already passed database/storage to createApp, but we can set extra vars here
                // Note: createApp factory handles database/storage injection if passed in options
                await next();
            });

            // Serve config.js dynamically
            app.get('/config.js', (c: Context) => {
                return c.text(`window.env = { API_URL: "${process.env.API_URL || '/'}" };`, 200, {
                    'Content-Type': 'application/javascript',
                });
            });

            if (process.env.PUBLIC_DIR) {
                console.log(`Serving static files from ${process.env.PUBLIC_DIR}`);
                app.use('/*', serveStatic({ root: process.env.PUBLIC_DIR }));

                // SPA Fallback
                app.get('*', async (c: Context) => {
                    try {
                        return c.html(await readFile(path.join(process.env.PUBLIC_DIR!, 'index.html'), 'utf-8'));
                    } catch (e) {
                        return c.text('Not Found', 404);
                    }
                });
            }
        }
    });

    console.log(`Server listening on port ${PORT}`);
    serve({
        fetch: app.fetch,
        port: PORT
    });
}

start().catch(console.error);
