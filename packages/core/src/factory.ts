
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { VERSION } from '@package-broker/shared';
import {
    requestIdMiddleware,
    getLogger,
    type StorageDriver,
    type DatabasePort,
    type CachePort,
} from './index';
import authModule, { setupHandler, sessionMiddleware } from './modules/auth';
import systemModule from './modules/system';
import usersModule from './modules/users';
import repositoriesModule from './modules/repositories';
import tokensModule from './modules/tokens';
import packagesModule from './modules/packages';
import artifactsModule from './modules/artifacts';
import { statsModule, settingsModule } from './modules/admin';
import { mountComposerRoutes } from './modules/composer';
import { getPackageStatsRouteDef } from './modules/admin/admin.routes';
import { getPackageStats } from './modules/admin/admin.handlers';

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
                message: 'An unexpected error occurred',
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

    // Mount system module (health check) at /health
    app.route('/health', systemModule);

    // API routes
    const apiRoutes = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

    // Mount auth module at /api/auth
    // This includes: /api/auth/login, /api/auth/check, /api/auth/logout, /api/auth/me, /api/auth/2fa/*, /api/auth/invite/accept
    app.route('/api/auth', authModule);

    // Mount setup route separately at /api/setup (not under /api/auth)
    apiRoutes.post('/setup', setupHandler);

    // Define public paths that should be visible without authentication
    const PUBLIC_OPENAPI_PATHS = [
        '/health',
        '/api/auth/login',
        '/api/auth/check',
    ];

    // Define admin-only paths (only visible to admin users)
    const ADMIN_ONLY_PATHS = [
        '/api/users',           // All user management endpoints
        '/api/users/{id}',      // Delete user
    ];

    // Helper function to check authentication and get user role
    async function checkAuthentication(c: any): Promise<{ authenticated: boolean; role?: 'admin' | 'viewer' }> {
        try {
            const authHeader = c.req.header('Authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return { authenticated: false };
            }

            const token = authHeader.slice(7);
            let cache: any;
            try {
                cache = c.get('cache') || c.env?.KV;
            } catch (_e) {
                // If cache access fails, return unauthenticated
                return { authenticated: false };
            }

            if (!cache) {
                return { authenticated: false };
            }

            // Try to get session - handle both CachePort (getJson) and KV (get with 'json' type)
            let sessionData: { userId: string; email: string; role: 'admin' | 'viewer' } | null = null;
            try {
                if (typeof cache.getJson === 'function') {
                    sessionData = await cache.getJson(`session:${token}`);
                } else if (cache.get) {
                    sessionData = await cache.get(`session:${token}`, 'json');
                }
            } catch (_e) {
                // Session retrieval failed, return unauthenticated
                return { authenticated: false };
            }

            if (!sessionData) {
                return { authenticated: false };
            }

            return {
                authenticated: true,
                role: sessionData.role || 'viewer',
            };
        } catch (_e) {
            // Any error means not authenticated
            return { authenticated: false };
        }
    }

    // Protected routes - require session
    const protectedRoutes = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

    // ** SESSION MIDDLEWARE **
    // Note: Auth routes now handle their own session middleware in the auth module
    // This middleware is for all other protected routes (users, repositories, tokens, etc.)
    protectedRoutes.use('*', async (c, next) => {
        return sessionMiddleware(c as any, next as any);
    });

    // Mount all protected modules
    protectedRoutes.route('/users', usersModule);
    protectedRoutes.route('/repositories', repositoriesModule);
    protectedRoutes.route('/tokens', tokensModule);
    protectedRoutes.route('/packages', packagesModule);
    protectedRoutes.route('/artifacts', artifactsModule);
    
    // Admin module - split into separate modules to avoid route collisions
    protectedRoutes.route('/stats', statsModule);
    protectedRoutes.route('/settings', settingsModule);
    
    // Mount getPackageStats at correct path (temporary - should move to packages module)
    // This route needs to be at /api/packages/:name/:version/stats
    // Create a temporary route definition with the correct path
    const packageStatsRoute = {
      ...getPackageStatsRouteDef,
      path: '/packages/{name}/{version}/stats' as const,
    };
    protectedRoutes.openapi(packageStatsRoute as any, getPackageStats as any);

    // Mount protected routes under /api
    apiRoutes.route('/', protectedRoutes);

    // Register OpenAPI spec endpoint BEFORE mounting /api routes
    // This ensures the handler takes precedence over the /api mount
    // The handler executes at request time when all routes are registered
    app.get('/api/openapi.json', async (c) => {
        try {
            const auth = await checkAuthentication(c);
            const fullSpec = app.getOpenAPIDocument({
                openapi: '3.0.0',
                info: {
                    version: VERSION,
                    title: 'PACKAGE.broker API',
                    description: 'REST API for PACKAGE.broker - Composer Package Mirror',
                },
                servers: [
                    {
                        url: '/',
                        description: 'Current server',
                    },
                ],
            });

            // Filter paths based on authentication and role
            if (!auth.authenticated) {
                // Guest: only public endpoints
                const filteredPaths: Record<string, any> = {};
                for (const [path, pathItem] of Object.entries(fullSpec.paths || {})) {
                    if (PUBLIC_OPENAPI_PATHS.includes(path)) {
                        filteredPaths[path] = pathItem;
                    }
                }
                fullSpec.paths = filteredPaths;
            } else if (auth.role === 'viewer') {
                // Viewer (read-only): public + read-only endpoints (exclude admin-only)
                const filteredPaths: Record<string, any> = {};
                for (const [path, pathItem] of Object.entries(fullSpec.paths || {})) {
                    // Include public paths
                    if (PUBLIC_OPENAPI_PATHS.includes(path)) {
                        filteredPaths[path] = pathItem;
                        continue;
                    }

                    // Exclude admin-only paths
                    const isAdminOnly = ADMIN_ONLY_PATHS.some(adminPath => {
                        // Handle parameterized paths like /api/users/{id}
                        const adminPathPattern = adminPath.replace(/\{[^}]+\}/g, '[^/]+');
                        const adminRegex = new RegExp(`^${adminPathPattern}$`);
                        return adminRegex.test(path);
                    });

                    if (isAdminOnly) {
                        continue;
                    }

                    // For protected paths, only include GET methods (read-only)
                    if (pathItem && typeof pathItem === 'object') {
                        const readOnlyMethods = ['get'];
                        const filteredPathItem: Record<string, any> = {};
                        let hasReadOnlyMethod = false;

                        for (const [method, operation] of Object.entries(pathItem)) {
                            if (readOnlyMethods.includes(method.toLowerCase())) {
                                filteredPathItem[method] = operation;
                                hasReadOnlyMethod = true;
                            }
                        }

                        // Only include path if it has at least one read-only method
                        if (hasReadOnlyMethod) {
                            filteredPaths[path] = filteredPathItem;
                        }
                    }
                }
                fullSpec.paths = filteredPaths;
            }
            // Admin users see all endpoints (no filtering needed)

            return c.json(fullSpec);
        } catch (error) {
            const reqId = c.get('requestId') as string | undefined;
            logger.error(
                'Error generating OpenAPI spec',
                {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
                error instanceof Error ? error : new Error(String(error))
            );
            return c.json(
                {
                    error: 'Internal Server Error',
                    message: 'An unexpected error occurred',
                    ...(reqId && { requestId: reqId }),
                },
                500
            );
        }
    });

    // Mount /api routes AFTER registering /api/openapi.json
    app.route('/api', apiRoutes);

    // Mount Composer routes at root level (CRITICAL: must stay at root for Composer protocol compatibility)
    mountComposerRoutes(app);

    return app;
}
