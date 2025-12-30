/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './admin.routes';
import * as handlers from './admin.handlers';

const adminModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// All routes are protected (session middleware applied in factory.ts via protectedRoutes)
adminModule.openapi(routes.getStatsRouteDef, handlers.getStats as any);
// Note: getPackageStats is mounted separately in factory.ts at /api/packages/:name/:version/stats
// adminModule.openapi(routes.getPackageStatsRouteDef, handlers.getPackageStats as any);
adminModule.openapi(routes.getSettingsRouteDef, handlers.getSettings as any);
adminModule.openapi(routes.updatePackagistMirroringRouteDef, handlers.updatePackagistMirroring as any);

// Re-export utility functions for use by other modules
export { isPackagistMirroringEnabled, isPackageCachingEnabled, PACKAGIST_MIRRORING_KEY, PACKAGE_CACHING_KEY } from './admin.handlers';

export default adminModule;
