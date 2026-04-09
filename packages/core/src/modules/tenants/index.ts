/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './tenants.routes';
import * as handlers from './tenants.handlers';

const tenantsModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Tenant CRUD
tenantsModule.openapi(routes.listTenantsRouteDef, handlers.listTenants as any);
tenantsModule.openapi(routes.createTenantRouteDef, handlers.createTenant as any);
tenantsModule.openapi(routes.getTenantRouteDef, handlers.getTenant as any);
tenantsModule.openapi(routes.updateTenantRouteDef, handlers.updateTenant as any);
tenantsModule.openapi(routes.deleteTenantRouteDef, handlers.deleteTenant as any);

// Tenant package patterns
tenantsModule.openapi(routes.listTenantPackagesRouteDef, handlers.listTenantPackages as any);
tenantsModule.openapi(routes.addTenantPackageRouteDef, handlers.addTenantPackage as any);
tenantsModule.openapi(routes.removeTenantPackageRouteDef, handlers.removeTenantPackage as any);

export default tenantsModule;
