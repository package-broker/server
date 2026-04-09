import { serve } from '@hono/node-server';
import { createApp, generateEncryptionKey } from '@package-broker/core';
import { config } from 'dotenv';
import { SqliteDriver } from './drivers/sqlite-driver.js';
import { FileSystemDriver } from './drivers/fs-driver.js';
import { RedisDriver } from './drivers/redis-driver.js';
import { MemoryCacheDriver, MemoryQueueDriver } from '@package-broker/core';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import type { Context } from 'hono';

// Load environment variables
config();

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
    // Initialize Database Driver
    let databaseDriver;
    
    if (DB_DRIVER === 'sqlite') {
        console.log(`Initializing SQLite at ${DB_URL}`);
        databaseDriver = new SqliteDriver(DB_URL);
    } else {
        throw new Error(`Unsupported DB_DRIVER: ${DB_DRIVER}`);
    }
    
    // Check database health (logging only)
    const isHealthy = await databaseDriver.isHealthy();
    if (!isHealthy) {
        console.warn('');
        console.warn('⚠️  DATABASE NOT INITIALIZED');
        console.warn('   Run migration scripts to initialize the database:');
        console.warn('');
        console.warn('   docker exec <container> node packages/adapter-node/scripts/migrate.cjs /data/database.sqlite');
        console.warn('');
        console.warn('   📖 See: https://package.broker/docs/getting-started/quickstart-docker');
        console.warn('');
    }
    
    const database = await databaseDriver.connect();

    // Initialize Storage
    let storage;
    if (STORAGE_DRIVER === 'fs') {
        console.log(`Initializing FS Storage at ${STORAGE_PATH}`);
        storage = new FileSystemDriver(STORAGE_PATH);
    } else {
        throw new Error(`Unsupported STORAGE_DRIVER: ${STORAGE_DRIVER}`);
    }

    // Initialize Cache
    let cache;
    if (CACHE_DRIVER === 'redis') {
        console.log(`Initializing Redis Cache at ${CACHE_URL}`);
        cache = new RedisDriver(CACHE_URL);
    } else {
        console.log('Initializing Memory Cache');
        cache = new MemoryCacheDriver();
    }

    // Initialize Queue
    let queue;
    if (QUEUE_DRIVER === 'redis') {
        if (CACHE_DRIVER === 'redis') {
            queue = cache as any;
        } else {
            console.log(`Initializing Redis Queue at ${CACHE_URL}`);
            queue = new RedisDriver(CACHE_URL);
        }
    } else {
        console.log('Initializing Memory Queue');
        queue = new MemoryQueueDriver();
    }

    // Get or generate ENCRYPTION_KEY
    let encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
        console.warn('');
        console.warn('⚠️  ENCRYPTION_KEY not set - generating a temporary key for this session');
        console.warn('   ⚠️  WARNING: This key will change on restart. Set ENCRYPTION_KEY for production!');
        console.warn('   📖 See: https://package.broker/docs/reference/configuration');
        console.warn('');
        encryptionKey = await generateEncryptionKey();
    }

    // Create App
    const app = createApp({
        database,
        storage,
        cache,
        onInit: (app) => {
            // Inject environment variables into c.env for Node.js adapter
            app.use('*', async (c, next) => {
                // Make c.env available and populate from process.env
                (c.env as any) = {
                    ...(c.env || {}),
                    ENCRYPTION_KEY: encryptionKey,
                    // Pass SMTP configuration from process.env
                    SMTP_HOST: process.env.SMTP_HOST,
                    SMTP_PORT: process.env.SMTP_PORT,
                    SMTP_USER: process.env.SMTP_USER,
                    SMTP_PASS: process.env.SMTP_PASS,
                    SMTP_FROM: process.env.SMTP_FROM,
                };
                await next();
            });
        },
    });

    // Serve config.js dynamically
    app.get('/config.js', (c: Context) => {
        return c.text(`window.env = { API_URL: "${process.env.API_URL || '/'}" };`, 200, {
            'Content-Type': 'application/javascript',
        });
    });

    // Static file serving and SPA fallback
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

    console.log(`Server listening on port ${PORT}`);
    serve({
        fetch: app.fetch,
        port: PORT
    });
}

start().catch(console.error);
