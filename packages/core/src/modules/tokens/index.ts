/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './tokens.routes';
import * as handlers from './tokens.handlers';

const tokensModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// All routes are protected (session middleware applied in factory.ts via protectedRoutes)
tokensModule.openapi(routes.listTokensRouteDef, handlers.listTokens as any);
tokensModule.openapi(routes.createTokenRouteDef, handlers.createToken as any);
tokensModule.openapi(routes.updateTokenRouteDef, handlers.updateToken as any);
tokensModule.openapi(routes.deleteTokenRouteDef, handlers.deleteToken as any);

export default tokensModule;
