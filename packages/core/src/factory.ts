
import { OpenAPIHono } from '@hono/zod-openapi';
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
    type CachePort,
} from './index';
import {
    healthRouteDef,
    loginRouteDef,
    logoutRouteDef,
    meRouteDef,
    checkAuthRequiredRouteDef,
    listUsersRouteDef,
    createUserRouteDef,
    deleteUserRouteDef,
    listRepositoriesRouteDef,
    createRepositoryRouteDef,
    getRepositoryRouteDef,
    updateRepositoryRouteDef,
    deleteRepositoryRouteDef,
    verifyRepositoryRouteDef,
    syncRepositoryRouteDef,
    listTokensRouteDef,
    createTokenRouteDef,
    updateTokenRouteDef,
    deleteTokenRouteDef,
    listPackagesRouteDef,
    getPackageRouteDef,
    getPackageReadmeRouteDef,
    getPackageChangelogRouteDef,
    getStatsRouteDef,
    getPackageStatsRouteDef,
    getSettingsRouteDef,
    updatePackagistMirroringRouteDef,
    deleteArtifactRouteDef,
    cleanupArtifactsRouteDef,
} from './routes/api/openapi';

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
    cache?: CachePort;
    requestId?: string;
    session?: { userId: string; email: string };
}

export type AppInstance = OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>;

/**
 * Create the generic Hono application
 * This factory function expects drivers to be injected via middleware or arguments,
 * or it sets up the structure for them to be set.
 */
export function createApp(options?: {
    storage?: StorageDriver;
    database?: DatabasePort;
    cache?: CachePort;
    onInit?: (app: AppInstance) => void;
}): AppInstance {
    const app = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();
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

    // Inject database, storage, and cache drivers if provided
    // This MUST happen regardless of whether onInit is provided
    if (options?.database) {
        app.use('*', async (c: any, next: any) => {
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
    if (options?.cache) {
        app.use('*', async (c: any, next: any) => {
            c.set('cache', options.cache!);
            await next();
        });
    }

    // Custom Init hook (for additional middleware/routes from outer scope)
    if (options?.onInit) {
        options.onInit(app);
    }

    // Health check (no auth required)
    app.openapi(healthRouteDef, healthRoute as any);;

    // API routes
    const apiRoutes = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

    // Auth routes (no session required)
    apiRoutes.openapi(loginRouteDef, loginRoute as any);
    apiRoutes.openapi(checkAuthRequiredRouteDef, checkAuthRequired as any);
    apiRoutes.post('/setup', setupRoute); /* Fresh install flow - not in OpenAPI yet */
    apiRoutes.post('/auth/invite/accept', acceptInviteRoute); /* Not in OpenAPI yet */

    // Protected routes - require session
    const protectedRoutes = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

    // ** SESSION MIDDLEWARE **
    protectedRoutes.use('*', async (c, next) => {
        return sessionMiddleware(c as any, next as any);
    });

    // Auth routes (session required)
    protectedRoutes.openapi(logoutRouteDef, logoutRoute as any);
    protectedRoutes.openapi(meRouteDef, meRoute as any);
    protectedRoutes.post('/auth/2fa/setup', setup2FARoute); /* Not in OpenAPI yet */
    protectedRoutes.post('/auth/2fa/enable', enable2FARoute); /* Not in OpenAPI yet */
    protectedRoutes.post('/auth/2fa/disable', disable2FARoute); /* Not in OpenAPI yet */

    // User Management
    protectedRoutes.openapi(listUsersRouteDef, listUsers as any);
    protectedRoutes.openapi(createUserRouteDef, createUser as any);
    protectedRoutes.openapi(deleteUserRouteDef, deleteUser as any);

    // Repository routes
    protectedRoutes.openapi(listRepositoriesRouteDef, listRepositories as any);
    protectedRoutes.openapi(createRepositoryRouteDef, createRepository as any);
    protectedRoutes.openapi(getRepositoryRouteDef, getRepository as any);
    protectedRoutes.openapi(updateRepositoryRouteDef, updateRepository as any);
    protectedRoutes.openapi(deleteRepositoryRouteDef, deleteRepository as any);
    protectedRoutes.openapi(verifyRepositoryRouteDef, verifyRepository as any);
    protectedRoutes.openapi(syncRepositoryRouteDef, syncRepositoryNow as any);

    // Token routes
    protectedRoutes.openapi(listTokensRouteDef, listTokens as any);
    protectedRoutes.openapi(createTokenRouteDef, createToken as any);
    protectedRoutes.openapi(updateTokenRouteDef, updateToken as any);
    protectedRoutes.openapi(deleteTokenRouteDef, deleteToken as any);

    // Package routes
    protectedRoutes.openapi(listPackagesRouteDef, listPackages as any);
    protectedRoutes.openapi(getPackageRouteDef, getPackage as any);
    protectedRoutes.openapi(getPackageReadmeRouteDef, getPackageReadme as any);
    protectedRoutes.openapi(getPackageChangelogRouteDef, getPackageChangelog as any);
    protectedRoutes.openapi(getPackageStatsRouteDef, getPackageStats as any);
    protectedRoutes.post('/packages/add-from-mirror', addPackagesFromMirror); /* Not in OpenAPI yet */

    // Stats
    protectedRoutes.openapi(getStatsRouteDef, getStats as any);

    // Settings
    protectedRoutes.openapi(getSettingsRouteDef, getSettings as any);
    protectedRoutes.openapi(updatePackagistMirroringRouteDef, updatePackagistMirroring as any);

    // Artifacts
    protectedRoutes.openapi(deleteArtifactRouteDef, deleteArtifact as any);
    protectedRoutes.openapi(cleanupArtifactsRouteDef, cleanupArtifacts as any);
    protectedRoutes.post('/packages/cleanup-numeric-versions', cleanupNumericVersions); /* Not in OpenAPI yet */

    // Mount protected routes under /api
    apiRoutes.route('/', protectedRoutes);
    app.route('/api', apiRoutes);

    // OpenAPI documentation endpoints
    app.doc('/api/openapi.json', {
        openapi: '3.0.0',
        info: {
            version: '1.0.0',
            title: 'PACKAGE.broker API',
            description: 'REST API for PACKAGE.broker - Composer Package Mirror',
        },
        servers: [
            {
                url: '/',
                description: 'Current server',
            },
        ],
    } as any);

    // Swagger UI endpoint (using CDN)
    app.get('/api/swagger', (c) => {
        return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>PACKAGE.broker API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
    <style>
        html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
        *, *:before, *:after { box-sizing: inherit; }
        body { margin:0; background: #fafafa; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            window.ui = SwaggerUIBundle({
                url: '/api/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout"
            });
        };
    </script>
</body>
</html>
        `);
    });

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
