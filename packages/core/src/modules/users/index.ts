/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './users.routes';
import * as handlers from './users.handlers';

const usersModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// All routes are protected (session middleware applied in factory.ts via protectedRoutes)
usersModule.openapi(routes.listUsersRouteDef, handlers.listUsers as any);
usersModule.openapi(routes.createUserRouteDef, handlers.createUser as any);
usersModule.openapi(routes.deleteUserRouteDef, handlers.deleteUser as any);

export default usersModule;
