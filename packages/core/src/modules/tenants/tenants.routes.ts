/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import { errorResponseSchema } from '@package-broker/shared';

const slugPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const tenantResponseSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  name: z.string(),
  slug: z.string(),
  created_at: z.number(),
});

const tenantPackageResponseSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  package_pattern: z.string(),
  access_level: z.enum(['read', 'write']),
  created_at: z.number(),
});

const createTenantSchema = z.object({
  name: z.string().min(1).max(100).openapi({ example: 'Production' }),
  slug: z.string().min(3).max(63).regex(slugPattern, 'Slug must be lowercase alphanumeric with hyphens, 3-63 chars').openapi({ example: 'production' }),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const packagePatternRegex = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?\/((\*)|([a-z0-9]([a-z0-9._-]*[a-z0-9])?))$/;

const addTenantPackageSchema = z.object({
  package_pattern: z.string().min(3).max(255).regex(packagePatternRegex, 'Must be vendor/package or vendor/* format (lowercase)').openapi({ example: 'vendor/*' }),
  access_level: z.enum(['read', 'write']).default('read'),
});

// Route paths are relative to module mount at /api/organizations/:org_id/tenants
// org_id is injected via middleware in factory.ts, not declared as a route param
export const listTenantsRouteDef = createRoute({
  method: 'get',
  path: '/',
  summary: 'List tenants',
  description: 'List all tenants in the organization',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(tenantResponseSchema) } },
      description: 'List of tenants',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Not a member',
    },
  },
  tags: ['Tenants'],
});

export const createTenantRouteDef = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create tenant',
  description: 'Create a new tenant in the organization. Requires owner or admin role.',
  security: [{ Bearer: [] }],
  request: {
    body: { content: { 'application/json': { schema: createTenantSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: tenantResponseSchema } },
      description: 'Tenant created',
    },
    400: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Invalid request',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    409: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Slug already taken in this organization',
    },
  },
  tags: ['Tenants'],
});

export const getTenantRouteDef = createRoute({
  method: 'get',
  path: '/{id}',
  summary: 'Get tenant',
  description: 'Get tenant details',
  security: [{ Bearer: [] }],
  request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }) },
  responses: {
    200: {
      content: { 'application/json': { schema: tenantResponseSchema } },
      description: 'Tenant details',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Tenant not found',
    },
  },
  tags: ['Tenants'],
});

export const updateTenantRouteDef = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update tenant',
  description: 'Update tenant name. Requires owner or admin role.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
    body: { content: { 'application/json': { schema: updateTenantSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: tenantResponseSchema } },
      description: 'Tenant updated',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Tenant not found',
    },
  },
  tags: ['Tenants'],
});

export const deleteTenantRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  summary: 'Delete tenant',
  description: 'Delete a tenant. Requires owner or admin role.',
  security: [{ Bearer: [] }],
  request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      description: 'Tenant deleted',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Tenant not found',
    },
  },
  tags: ['Tenants'],
});

// Tenant package patterns
export const listTenantPackagesRouteDef = createRoute({
  method: 'get',
  path: '/{id}/packages',
  summary: 'List tenant package patterns',
  description: 'List all package access patterns for this tenant',
  security: [{ Bearer: [] }],
  request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(tenantPackageResponseSchema) } },
      description: 'List of package patterns',
    },
  },
  tags: ['Tenants'],
});

export const addTenantPackageRouteDef = createRoute({
  method: 'post',
  path: '/{id}/packages',
  summary: 'Add package pattern to tenant',
  description: 'Add a package access pattern. Requires owner or admin role.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }),
    body: { content: { 'application/json': { schema: addTenantPackageSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: tenantPackageResponseSchema } },
      description: 'Package pattern added',
    },
    400: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Invalid request',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    409: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Pattern already exists for this tenant',
    },
  },
  tags: ['Tenants'],
});

export const removeTenantPackageRouteDef = createRoute({
  method: 'delete',
  path: '/{id}/packages/{package_id}',
  summary: 'Remove package pattern from tenant',
  description: 'Remove a package access pattern. Requires owner or admin role.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
      package_id: z.string().openapi({ param: { name: 'package_id', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      description: 'Package pattern removed',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Package pattern not found',
    },
  },
  tags: ['Tenants'],
});

export {
  createTenantSchema,
  updateTenantSchema,
  addTenantPackageSchema,
};
