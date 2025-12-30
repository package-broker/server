/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import { statsResponseSchema, settingsResponseSchema, updatePackagistMirroringRequestSchema, errorResponseSchema } from '@package-broker/shared';

// Route paths are relative to module mount points
export const getStatsRouteDef = createRoute({
  method: 'get',
  path: '/',
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

// Note: getPackageStats is kept here temporarily but should be moved to packages module
// For now, it will be mounted separately at /api/packages/:name/:version/stats
export const getPackageStatsRouteDef = createRoute({
  method: 'get',
  path: '/{name}/{version}/stats',
  summary: 'Get package statistics',
  description: 'Get download statistics for a specific package version',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      name: z.string().openapi({
        param: {
          name: 'name',
          in: 'path',
        },
      }),
      version: z.string().openapi({
        param: {
          name: 'version',
          in: 'path',
        },
      }),
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

export const getSettingsRouteDef = createRoute({
  method: 'get',
  path: '/',
  summary: 'Get settings',
  description: 'Get all settings including KV availability',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: settingsResponseSchema,
        },
      },
      description: 'Settings',
    },
  },
  tags: ['Settings'],
});

export const updatePackagistMirroringRouteDef = createRoute({
  method: 'put',
  path: '/packagist-mirroring',
  summary: 'Update Packagist mirroring',
  description: 'Enable or disable public Packagist mirroring',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: updatePackagistMirroringRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            packagist_mirroring_enabled: z.boolean(),
            message: z.string(),
          }),
        },
      },
      description: 'Settings updated',
    },
    400: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
    503: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'KV not available',
    },
  },
  tags: ['Settings'],
});
