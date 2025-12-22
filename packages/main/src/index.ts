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
  const logger = getLogger(logLevel);

  // Initialize analytics with Analytics Engine binding (if available)
  initAnalytics(env?.ANALYTICS);

  const app = new Hono<{
    Bindings: Env;
    Variables: {
      storage: StorageDriver;
      database: DatabasePort;
      requestId?: string;
    };
  }>();

  // Global middleware
  app.use('*', cors());

  // Request ID middleware - must be early in the chain
  app.use('*', requestIdMiddleware);

  app.onError(async (err, c) => {
    const requestId = c.get('requestId') as string | undefined;
    logger.error(
      'Unhandled error',
      {
        url: c.req.url,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
      },
      err instanceof Error ? err : new Error(String(err))
    );
    return c.json(
      {
        error: 'Internal Server Error',
        message: err.message,
        ...(requestId && { requestId }),
      },
      500
    );
  });

  // Database middleware
  app.use('*', async (c, next) => {
    c.set('database', createD1Database(c.env.DB));
    await next();
  });

  // Storage middleware - initialize storage driver
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
    return await next();
  });

  // Health check (no auth required)
  app.get('/health', healthRoute);

  // API routes - must be registered BEFORE composer routes
  const apiRoutes = new Hono<{
    Bindings: Env;
    Variables: {
      storage: StorageDriver;
      database: DatabasePort;
      session?: { userId: string; email: string };
    };
  }>();

  // Auth routes (no session required)
  apiRoutes.post('/auth/login', loginRoute);
  apiRoutes.get('/auth/check', checkAuthRequired);
  apiRoutes.post('/setup', setupRoute); // Fresh install flow
  apiRoutes.post('/auth/invite/accept', acceptInviteRoute);

  // Protected routes - require session
  const protectedRoutes = new Hono<{
    Bindings: Env;
    Variables: { storage: StorageDriver; database: DatabasePort; session: { userId: string; email: string } };
  }>();

  // Session middleware for protected routes
  protectedRoutes.use('*', async (c, next) => {
    return sessionMiddleware(c as any, next as any);
  });

  // Auth routes (session required)
  protectedRoutes.post('/auth/logout', logoutRoute);
  protectedRoutes.get('/auth/me', meRoute);
  protectedRoutes.post('/auth/2fa/setup', setup2FARoute);
  protectedRoutes.post('/auth/2fa/enable', enable2FARoute);
  protectedRoutes.post('/auth/2fa/disable', disable2FARoute);

  // User Management Routes
  protectedRoutes.get('/users', listUsers);
  protectedRoutes.post('/users', createUser);
  protectedRoutes.delete('/users/:id', deleteUser);

  // Repository routes
  protectedRoutes.get('/repositories', listRepositories);
  protectedRoutes.post('/repositories', createRepository);
  protectedRoutes.get('/repositories/:id', getRepository);
  protectedRoutes.put('/repositories/:id', updateRepository);
  protectedRoutes.delete('/repositories/:id', deleteRepository);
  protectedRoutes.get('/repositories/:id/verify', verifyRepository);
  protectedRoutes.post('/repositories/:id/sync', syncRepositoryNow);

  // Token routes
  protectedRoutes.get('/tokens', listTokens);
  protectedRoutes.post('/tokens', createToken);
  protectedRoutes.patch('/tokens/:id', updateToken);
  protectedRoutes.delete('/tokens/:id', deleteToken);

  // Package routes
  protectedRoutes.get('/packages', listPackages);
  protectedRoutes.get('/packages/:name', getPackage);
  protectedRoutes.get('/packages/:name/:version/readme', getPackageReadme);
  protectedRoutes.get('/packages/:name/:version/changelog', getPackageChangelog);
  protectedRoutes.get('/packages/:name/:version/stats', getPackageStats);
  protectedRoutes.post('/packages/add-from-mirror', addPackagesFromMirror);

  // Stats routes
  protectedRoutes.get('/stats', getStats);

  // Settings routes
  protectedRoutes.get('/settings', getSettings);
  protectedRoutes.put('/settings/packagist-mirroring', updatePackagistMirroring);

  // Artifact routes
  protectedRoutes.delete('/artifacts/:id', deleteArtifact);
  protectedRoutes.post('/artifacts/cleanup', cleanupArtifacts);

  // Package cleanup route (for fixing version bug)
  protectedRoutes.post('/packages/cleanup-numeric-versions', cleanupNumericVersions);

  // Mount protected routes under /api
  apiRoutes.route('/', protectedRoutes);

  app.route('/api', apiRoutes);

  // Composer routes (with auth and version check) - registered AFTER /api
  // These are the specific Composer endpoints that require authentication

  // Composer auth middleware for specific routes
  const composerAuth = async (c: any, next: any) => {
    await composerVersionMiddleware(c, next);
  };
  const composerTokenAuth = async (c: any, next: any) => {
    return authMiddleware(c, next);
  };

  // packages.json - main Composer entry point
  app.get('/packages.json', composerAuth, composerTokenAuth, packagesJsonRoute);

  // p2 provider - package metadata
  app.get('/p2/:vendor/:package', composerAuth, composerTokenAuth, p2PackageRoute);

  // dist - artifact downloads (vendor/package format requires separate params)
  // Uses dual auth: accepts either Composer token (Basic Auth) OR admin session (Bearer token)
  const distAuth = async (c: any, next: any) => {
    return distAuthMiddleware(c, next);
  };
  // Mirror format: /dist/m/:vendor/:package/:version (looks up repo_id from DB)
  app.get('/dist/m/:vendor/:package/:version', composerAuth, distAuth, distMirrorRoute);
  // Lockfile format: /dist/:vendor/:package/:version/:reference (from composer.lock files)
  app.get('/dist/:vendor/:package/:version/:reference', composerAuth, distAuth, distLockfileRoute);
  // Direct format: /dist/:repo_id/:vendor/:package/:version
  app.get('/dist/:repo_id/:vendor/:package/:version', composerAuth, distAuth, distRoute);

  return app;
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
