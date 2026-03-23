/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute } from '@hono/zod-openapi';
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
