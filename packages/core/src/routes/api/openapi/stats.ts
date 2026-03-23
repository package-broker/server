/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import { statsResponseSchema } from '@package-broker/shared';

export const getStatsRouteDef = createRoute({
  method: 'get',
  path: '/stats',
  summary: 'Get statistics',
  description: 'Get dashboard statistics',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: statsResponseSchema,
        },
      },
      description: 'Statistics',
    },
  },
  tags: ['Statistics'],
});

export const getPackageStatsRouteDef = createRoute({
  method: 'get',
  path: '/packages/{name}/{version}/stats',
  summary: 'Get package statistics',
  description: 'Get download statistics for a specific package version',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      name: z.string(),
      version: z.string(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            downloads: z.number(),
            last_downloaded: z.number().nullable(),
          }),
        },
      },
      description: 'Package statistics',
    },
  },
  tags: ['Statistics'],
});
