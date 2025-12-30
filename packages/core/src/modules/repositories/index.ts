/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './repositories.routes';
import * as handlers from './repositories.handlers';

const repositoriesModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// All routes are protected (session middleware applied in factory.ts via protectedRoutes)
repositoriesModule.openapi(routes.listRepositoriesRouteDef, handlers.listRepositories as any);
repositoriesModule.openapi(routes.createRepositoryRouteDef, handlers.createRepository as any);
repositoriesModule.openapi(routes.getRepositoryRouteDef, handlers.getRepository as any);
repositoriesModule.openapi(routes.updateRepositoryRouteDef, handlers.updateRepository as any);
repositoriesModule.openapi(routes.deleteRepositoryRouteDef, handlers.deleteRepository as any);
repositoriesModule.openapi(routes.verifyRepositoryRouteDef, handlers.verifyRepository as any);
repositoriesModule.openapi(routes.syncRepositoryRouteDef, handlers.syncRepositoryNow as any);

export default repositoriesModule;
