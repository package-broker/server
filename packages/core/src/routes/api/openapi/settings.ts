/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import {
  settingsResponseSchema,
  updatePackagistMirroringRequestSchema,
  errorResponseSchema,
} from '@package-broker/shared';

export const getSettingsRouteDef = createRoute({
  method: 'get',
  path: '/api/settings',
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
  path: '/api/settings/packagist-mirroring',
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
