/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Main package - Worker entry point

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  composerVersionMiddleware,
  authMiddleware,
  distAuthMiddleware,
  errorHandlerMiddleware,
  requestIdMiddleware,
  packagesJsonRoute,
  p2PackageRoute,
  distRoute,
  distMirrorRoute,
  distLockfileRoute,
  healthRoute,
  listRepositories,
  createRepository,
  getRepository,
  updateRepository,
  deleteRepository,
  verifyRepository,
  syncRepositoryNow,
  listTokens,
  createToken,
  updateToken,
  deleteToken,
  listPackages,
  getPackage,
  getPackageReadme,
  getPackageChangelog,
  getPackageStats,
  addPackagesFromMirror,
  getStats,
  getSettings,
  updatePackagistMirroring,
  deleteArtifact,
  cleanupArtifacts,
  cleanupNumericVersions,
  loginRoute,
  logoutRoute,
  meRoute,
  setupRoute,
  setup2FARoute,
  enable2FARoute,
  disable2FARoute,
  listUsers,
  createUser,
  deleteUser,
  sessionMiddleware,
  checkAuthRequired,
  acceptInviteRoute,
  R2Driver,
  S3Driver,
  type StorageDriver,
  getLogger,
  initAnalytics,
  PackageStorageWorkflow,
  createD1Database,
  type DatabasePort,
  createApp,
} from '@package-broker/core';

// Re-export the Workflow class for Cloudflare to find it
export { PackageStorageWorkflow };

export interface WorkerConfig {
  storage: 'r2' | 's3';
  s3Config?: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
}

export interface Env {
  DB: D1Database;
  KV?: KVNamespace; // Optional - only needed for caching and rate limiting
  QUEUE?: Queue; // Optional - only available on Workers Paid plan
  PACKAGE_STORAGE_WORKFLOW?: Workflow; // Optional - Cloudflare Workflow for background storage
  R2_BUCKET: R2Bucket;
  ASSETS?: Fetcher; // Static assets binding for UI
  ENCRYPTION_KEY: string;
  ADMIN_TOKEN?: string;
  // Initial admin credentials (for seeding first admin user)
  INITIAL_ADMIN_EMAIL?: string;
  INITIAL_ADMIN_PASSWORD?: string;
  // S3 config (optional)
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
  // Logging config (optional)
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  // Analytics Engine (optional - free tier: 100k events/day)
  ANALYTICS?: AnalyticsEngineDataset;
  // SMTP Config (optional)
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
}

/**
 * Create the PACKAGE.broker worker
 */
export function createWorker(config: WorkerConfig = { storage: 'r2' }, env?: Env) {
  // Initialize logger with log level from environment
  const logLevel = (env?.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';
  // Logger initialization is side-effect, handled by getLogger singleton, can be configured globally
  getLogger(logLevel);

  // Initialize analytics
  initAnalytics(env?.ANALYTICS);

  // Define drivers initialization logic
  // Since createApp supports injection, we'll wrap it

  return createApp({
    onInit: (app) => {
      // Check for API token
      // (Auth middleware handles this, but here we can add platform-specific middleware if needed)

      // Database middleware
      app.use('*', async (c, next) => {
        if (c.env.DB) {
          c.set('database', createD1Database(c.env.DB));
        }
        await next();
      });

      // Storage middleware
      app.use('*', async (c, next) => {
        if (config.storage === 's3' && config.s3Config) {
          c.set('storage', new S3Driver(config.s3Config));
        } else if (c.env.S3_ENDPOINT) {
          // Use environment variables for S3
          c.set(
            'storage',
            new S3Driver({
              endpoint: c.env.S3_ENDPOINT,
              region: c.env.S3_REGION || 'auto',
              accessKeyId: c.env.S3_ACCESS_KEY_ID || '',
              secretAccessKey: c.env.S3_SECRET_ACCESS_KEY || '',
              bucket: c.env.S3_BUCKET || '',
            })
          );
        } else {
          // Default to R2
          c.set('storage', new R2Driver({ bucket: c.env.R2_BUCKET }));
        }
        await next();
      });

      // Additional Cloudflare bindings (KV, Queue) can be added here if factory supports them being absent
      // The current factory implementation assumes they are passed in Bindings or handled by specific routes
      // Serve static assets (UI)
      app.get('*', async (c) => {
        if (c.env.ASSETS) {
          return await c.env.ASSETS.fetch(c.req.raw);
        }
        return c.text('UI Assets not available (ASSETS binding missing)', 404);
      });
    }
  });
}



// Export default worker for Cloudflare
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Initialize worker and logger
    const logLevel = (env?.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';
    const logger = getLogger(logLevel);

    // Log worker initialization (only once per worker instance, but helpful for debugging)
    logger.debug('Worker processing request', {
      method: request.method,
      url: request.url,
    });

    const app = createWorker({ storage: 'r2' }, env);
    return app.fetch(request, env, ctx);
  },
};
