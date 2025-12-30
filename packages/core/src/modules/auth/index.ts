/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './auth.routes';
import * as handlers from './auth.handlers';

const authModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Public routes (no session required)
authModule.openapi(routes.loginRouteDef, handlers.loginHandler as any);
authModule.openapi(routes.checkAuthRequiredRouteDef, handlers.checkAuthRequiredHandler as any);

// Non-OpenAPI public routes
// Note: /invite/accept is mounted at /api/auth/invite/accept
authModule.post('/invite/accept', handlers.acceptInviteHandler);

// Protected routes (session required)
// Apply session middleware to all routes registered below
authModule.use('*', async (c, next) => {
    return handlers.sessionMiddleware(c as any, next as any);
});

authModule.openapi(routes.logoutRouteDef, handlers.logoutHandler as any);
authModule.openapi(routes.meRouteDef, handlers.meHandler as any);

// Non-OpenAPI protected routes
authModule.post('/2fa/setup', handlers.setup2FAHandler);
authModule.post('/2fa/enable', handlers.enable2FAHandler);
authModule.post('/2fa/disable', handlers.disable2FAHandler);

// Re-export authMiddleware for use by other modules (e.g., composer/dist)
export { authMiddleware } from '../../middleware/auth';

// Export sessionMiddleware for use by other protected route groups
export { sessionMiddleware } from './auth.handlers';

// Export setup handler separately since it needs to be mounted at /api/setup (not /api/auth/setup)
export { setupHandler } from './auth.handlers';

export default authModule;
