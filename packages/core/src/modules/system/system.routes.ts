/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import { healthResponseSchema } from '@package-broker/shared';

export const healthRouteDef = createRoute({
  method: 'get',
  // This module is mounted at /health in factory.ts
  // Keep route path relative so final URL is /health
  path: '/',
  summary: 'Health check',
  description: 'Returns 200 OK if service is healthy',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: healthResponseSchema,
        },
      },
      description: 'Service is healthy',
    },
  },
  tags: ['System'],
});

const sshSupportResponseSchema = z.object({
  ssh_supported: z.boolean().describe('Whether SSH key support is available in this environment'),
});

export const sshSupportRouteDef = createRoute({
  method: 'get',
  path: '/ssh-support',
  summary: 'Check SSH support',
  description: 'Returns whether SSH key support is available in the current environment',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: sshSupportResponseSchema,
        },
      },
      description: 'SSH support status',
    },
  },
  tags: ['System'],
});
