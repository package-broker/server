/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './system.routes';
import * as handlers from './system.handlers';

const systemModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Public route (no auth required)
systemModule.openapi(routes.healthRouteDef, handlers.healthHandler as any);

export default systemModule;
