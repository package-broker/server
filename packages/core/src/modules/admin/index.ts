/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './admin.routes';
import * as handlers from './admin.handlers';

// Stats module - mounted at /api/stats
export const statsModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();
statsModule.openapi(routes.getStatsRouteDef, handlers.getStats as any);

// Settings module - mounted at /api/settings
export const settingsModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();
settingsModule.openapi(routes.getSettingsRouteDef, handlers.getSettings as any);
settingsModule.openapi(routes.updatePackagistMirroringRouteDef, handlers.updatePackagistMirroring as any);

// Legacy export for backwards compatibility
const adminModule = statsModule;

// Re-export utility functions for use by other modules
export { isPackagistMirroringEnabled, isPackageCachingEnabled, PACKAGIST_MIRRORING_KEY, PACKAGE_CACHING_KEY } from './admin.handlers';

export default adminModule;
