/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import { errorResponseSchema } from '@package-broker/shared';

const slugPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const organizationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  owner_user_id: z.string(),
  created_at: z.number(),
});

const organizationMemberResponseSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  user_id: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  created_at: z.number(),
});

const createOrganizationSchema = z.object({
  name: z.string().min(1).max(100).openapi({ example: 'My Organization' }),
  slug: z.string().min(3).max(63).regex(slugPattern, 'Slug must be lowercase alphanumeric with hyphens, 3-63 chars').openapi({ example: 'my-org' }),
});

const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const addMemberSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(['admin', 'member']).default('member'),
});

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
});

const idParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
});

const orgMemberParams = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
  user_id: z.string().openapi({ param: { name: 'user_id', in: 'path' } }),
});

// Route paths are relative to module mount at /api/organizations
export const listOrganizationsRouteDef = createRoute({
  method: 'get',
  path: '/',
  summary: 'List organizations',
  description: 'List organizations the current user belongs to',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(organizationResponseSchema) } },
      description: 'List of organizations',
    },
  },
  tags: ['Organizations'],
});

export const createOrganizationRouteDef = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create organization',
  description: 'Create a new organization. The current user becomes the owner.',
  security: [{ Bearer: [] }],
  request: {
    body: { content: { 'application/json': { schema: createOrganizationSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: organizationResponseSchema } },
      description: 'Organization created',
    },
    400: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Invalid request',
    },
    409: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Slug already taken',
    },
  },
  tags: ['Organizations'],
});

export const getOrganizationRouteDef = createRoute({
  method: 'get',
  path: '/{id}',
  summary: 'Get organization',
  description: 'Get organization details',
  security: [{ Bearer: [] }],
  request: { params: idParam },
  responses: {
    200: {
      content: { 'application/json': { schema: organizationResponseSchema } },
      description: 'Organization details',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Not a member',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Organization not found',
    },
  },
  tags: ['Organizations'],
});

export const updateOrganizationRouteDef = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update organization',
  description: 'Update organization name. Requires owner or admin role.',
  security: [{ Bearer: [] }],
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: updateOrganizationSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: organizationResponseSchema } },
      description: 'Organization updated',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Organization not found',
    },
  },
  tags: ['Organizations'],
});

export const deleteOrganizationRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  summary: 'Delete organization',
  description: 'Delete an organization. Requires owner role.',
  security: [{ Bearer: [] }],
  request: { params: idParam },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      description: 'Organization deleted',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Only the owner can delete',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Organization not found',
    },
  },
  tags: ['Organizations'],
});

export const listMembersRouteDef = createRoute({
  method: 'get',
  path: '/{id}/members',
  summary: 'List organization members',
  description: 'List all members of an organization',
  security: [{ Bearer: [] }],
  request: { params: idParam },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(organizationMemberResponseSchema) } },
      description: 'List of members',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Not a member',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Organization not found',
    },
  },
  tags: ['Organizations'],
});

export const addMemberRouteDef = createRoute({
  method: 'post',
  path: '/{id}/members',
  summary: 'Add member to organization',
  description: 'Add a user as a member. Requires owner or admin role.',
  security: [{ Bearer: [] }],
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: addMemberSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: organizationMemberResponseSchema } },
      description: 'Member added',
    },
    400: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Invalid request',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Organization or user not found',
    },
    409: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'User is already a member',
    },
  },
  tags: ['Organizations'],
});

export const updateMemberRouteDef = createRoute({
  method: 'patch',
  path: '/{id}/members/{user_id}',
  summary: 'Update member role',
  description: 'Change a member role. Requires owner or admin role.',
  security: [{ Bearer: [] }],
  request: {
    params: orgMemberParams,
    body: { content: { 'application/json': { schema: updateMemberSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: organizationMemberResponseSchema } },
      description: 'Member updated',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Member not found',
    },
  },
  tags: ['Organizations'],
});

export const removeMemberRouteDef = createRoute({
  method: 'delete',
  path: '/{id}/members/{user_id}',
  summary: 'Remove member from organization',
  description: 'Remove a member. Requires owner or admin role. Cannot remove the owner.',
  security: [{ Bearer: [] }],
  request: { params: orgMemberParams },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      description: 'Member removed',
    },
    403: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Insufficient permissions',
    },
    404: {
      content: { 'application/json': { schema: errorResponseSchema } },
      description: 'Member not found',
    },
  },
  tags: ['Organizations'],
});

export {
  createOrganizationSchema,
  updateOrganizationSchema,
  addMemberSchema,
  updateMemberSchema,
};
