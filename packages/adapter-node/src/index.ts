import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createApp, type AppInstance, type DatabaseDriver } from '@package-broker/core';
import { config } from 'dotenv';
import { SqliteDriver } from './drivers/sqlite-driver.js';
import { FileSystemDriver } from './drivers/fs-driver.js';
import { RedisDriver } from './drivers/redis-driver.js';
import { MemoryCacheDriver, MemoryQueueDriver } from '@package-broker/core';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import type { Context, Next } from 'hono';

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
const MIGRATIONS_PATH = process.env.MIGRATIONS_PATH || 'packages/main/migrations';

const DOCS_URL = 'https://package-broker.github.io/docs/installation/docker';

console.log('Starting PACKAGE.broker Node Adapter...');
console.log(`Configuration: DB=${DB_DRIVER}, STORAGE=${STORAGE_DRIVER}, CACHE=${CACHE_DRIVER}, QUEUE=${QUEUE_DRIVER}`);

/**
 * Get the database not initialized error response
 * DRY: Single source of truth for error response structure
 */
function getDatabaseNotInitializedError() {
    return {
        error: 'DATABASE_NOT_INITIALIZED',
        message: 'Database not initialized. Please run migrations.',
        docsUrl: DOCS_URL
    };
}

async function start() {
    // Initialize Database Driver (Port-Adapter pattern)
    let databaseDriver: DatabaseDriver;
    
    if (DB_DRIVER === 'sqlite') {
        console.log(`Initializing SQLite at ${DB_URL}`);
        databaseDriver = new SqliteDriver(DB_URL);
    } else {
        throw new Error(`Unsupported DB_DRIVER: ${DB_DRIVER}`);
    }
    
    // Check if database needs initialization (database-agnostic check)
    const isDatabaseReady = await databaseDriver.isInitialized();
    
    if (!isDatabaseReady) {
        console.warn('');
        console.warn('⚠️  DATABASE NOT INITIALIZED');
        console.warn('   The database tables have not been created yet.');
        console.warn('   A warning page will be shown to users until migrations are run.');
        console.warn(`   📖 Documentation: ${DOCS_URL}`);
        console.warn('');
    } else {
        console.log('Database initialized and ready.');
    }
    
    const database = databaseDriver.getConnection();

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

    // If database is not ready, return error for API requests
    if (!isDatabaseReady) {
        const warningApp = new Hono();
        const errorResponse = getDatabaseNotInitializedError();
        
        // Health endpoint returns warning status (200 OK with error status in body for CI compatibility)
        warningApp.get('/health', (c) => {
            return c.json({ 
                status: 'error', 
                ...errorResponse
            }, 200); // Return 200 for CI health checks, but include error status
        });
        
        // All API requests return JSON error (BEFORE static files)
        warningApp.all('/api/*', (c) => {
            return c.json(errorResponse, 503);
        });
        
        // Serve static files if PUBLIC_DIR is set (UI will display the error)
        if (process.env.PUBLIC_DIR) {
            warningApp.use('/*', serveStatic({ root: process.env.PUBLIC_DIR }));
            warningApp.get('*', async (c) => {
                try {
                    return c.html(await readFile(path.join(process.env.PUBLIC_DIR!, 'index.html'), 'utf-8'));
                } catch (e) {
                    return c.text('Not Found', 404);
                }
            });
        }
        
        console.log(`Server listening on port ${PORT} (WARNING: Database not initialized)`);
        serve({
            fetch: warningApp.fetch,
            port: PORT
        });
        return;
    }

    // Create App (API routes are registered inside createApp)
    const app = createApp({
        database,
        storage,
        cache,
    });

    // Serve config.js dynamically (AFTER API routes)
    app.get('/config.js', (c: Context) => {
        return c.text(`window.env = { API_URL: "${process.env.API_URL || '/'}" };`, 200, {
            'Content-Type': 'application/javascript',
        });
    });

    // Static file serving and SPA fallback (MUST be AFTER API routes)
    if (process.env.PUBLIC_DIR) {
        console.log(`Serving static files from ${process.env.PUBLIC_DIR}`);
        app.use('/*', serveStatic({ root: process.env.PUBLIC_DIR }));

        // SPA Fallback for client-side routing
        // This catches any routes that weren't handled by API routes or static files
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
