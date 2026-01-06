/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './packages.routes';
import * as handlers from './packages.handlers';

const packagesModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// All routes are protected (session middleware applied in factory.ts via protectedRoutes)
packagesModule.openapi(routes.listPackagesRouteDef, handlers.listPackages as any);
packagesModule.openapi(routes.getPackageRouteDef, handlers.getPackage as any);
packagesModule.openapi(routes.getPackageReadmeRouteDef, handlers.getPackageReadme as any);
packagesModule.openapi(routes.getPackageChangelogRouteDef, handlers.getPackageChangelog as any);
packagesModule.openapi(routes.uploadPackageRouteDef, handlers.uploadPackage as any);

// Non-OpenAPI routes
packagesModule.post('/add-from-mirror', handlers.addPackagesFromMirror);
packagesModule.post('/cleanup-numeric-versions', handlers.cleanupNumericVersions);

export default packagesModule;
