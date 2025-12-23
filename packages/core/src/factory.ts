
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
    composerVersionMiddleware,
    authMiddleware,
    distAuthMiddleware,
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
    getLogger,
    initAnalytics,
    type StorageDriver,
    type DatabasePort,
} from './index';

// Generic Environment Interface
export interface AppBindings {
    // Cloudflare specific bindings can be optional or generic
    DB?: any;
    KV?: any;
    QUEUE?: any;
    ANALYTICS?: any;
    // Core config
    LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
    [key: string]: any;
}

export interface AppVariables {
    storage: StorageDriver;
    database: DatabasePort;
    requestId?: string;
    session?: { userId: string; email: string };
}

export type AppInstance = Hono<{ Bindings: AppBindings; Variables: AppVariables }>;

/**
 * Create the generic Hono application
 * This factory function expects drivers to be injected via middleware or arguments,
 * or it sets up the structure for them to be set.
 */
export function createApp(options?: {
    storage?: StorageDriver;
    database?: DatabasePort;
    onInit?: (app: AppInstance) => void;
}): AppInstance {
    const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
    const logger = getLogger('info'); // Default logger, can vary per request if needed

    // Global middleware
    app.use('*', cors());
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

    // Custom Init hook (for setting generic drivers from outer scope)
    if (options?.onInit) {
        options.onInit(app);
    } else {
        // If drivers provided directly, inject them
        if (options?.database) {
            app.use('*', async (c, next) => {
                c.set('database', options.database!);
                await next();
            });
        }
        if (options?.storage) {
            app.use('*', async (c, next) => {
                c.set('storage', options.storage!);
                await next();
            });
        }
    }

    // Health check (no auth required)
    app.get('/health', healthRoute);

    // API routes
    const apiRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

    // Auth routes (no session required)
    apiRoutes.post('/auth/login', loginRoute);
    apiRoutes.get('/auth/check', checkAuthRequired);
    apiRoutes.post('/setup', setupRoute); /* Fresh install flow */
    apiRoutes.post('/auth/invite/accept', acceptInviteRoute);

    // Protected routes - require session
    const protectedRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

    // ** SESSION MIDDLEWARE **
    protectedRoutes.use('*', async (c, next) => {
        return sessionMiddleware(c as any, next as any);
    });

    // Auth routes (session required)
    protectedRoutes.post('/auth/logout', logoutRoute);
    protectedRoutes.get('/auth/me', meRoute);
    protectedRoutes.post('/auth/2fa/setup', setup2FARoute);
    protectedRoutes.post('/auth/2fa/enable', enable2FARoute);
    protectedRoutes.post('/auth/2fa/disable', disable2FARoute);

    // User Management
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

    // Stats
    protectedRoutes.get('/stats', getStats);

    // Settings
    protectedRoutes.get('/settings', getSettings);
    protectedRoutes.put('/settings/packagist-mirroring', updatePackagistMirroring);

    // Artifacts
    protectedRoutes.delete('/artifacts/:id', deleteArtifact);
    protectedRoutes.post('/artifacts/cleanup', cleanupArtifacts);
    protectedRoutes.post('/packages/cleanup-numeric-versions', cleanupNumericVersions);

    // Mount protected routes under /api
    apiRoutes.route('/', protectedRoutes);
    app.route('/api', apiRoutes);

    // Composer routes
    const composerAuth = async (c: any, next: any) => {
        await composerVersionMiddleware(c, next);
    };
    const composerTokenAuth = async (c: any, next: any) => {
        return authMiddleware(c, next);
    };

    app.get('/packages.json', composerAuth, composerTokenAuth, packagesJsonRoute);
    app.get('/p2/:vendor/:package', composerAuth, composerTokenAuth, p2PackageRoute);

    const distAuth = async (c: any, next: any) => {
        return distAuthMiddleware(c, next);
    };
    app.get('/dist/m/:vendor/:package/:version', composerAuth, distAuth, distMirrorRoute);
    app.get('/dist/:vendor/:package/:version/:reference', composerAuth, distAuth, distLockfileRoute);
    app.get('/dist/:repo_id/:vendor/:package/:version', composerAuth, distAuth, distRoute);

    return app;
}
