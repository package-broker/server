/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './artifacts.routes';
import * as handlers from './artifacts.handlers';

const artifactsModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// All routes are protected (session middleware applied in factory.ts via protectedRoutes)
artifactsModule.openapi(routes.deleteArtifactRouteDef, handlers.deleteArtifact as any);
artifactsModule.openapi(routes.cleanupArtifactsRouteDef, handlers.cleanupArtifacts as any);

export default artifactsModule;
