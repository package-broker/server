/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import { errorResponseSchema } from '@package-broker/shared';

export const deleteArtifactRouteDef = createRoute({
  method: 'delete',
  path: '/artifacts/{id}',
  summary: 'Delete artifact',
  description: 'Delete an artifact from storage and database',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            message: z.string(),
          }),
        },
      },
      description: 'Artifact deleted',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Artifact not found',
    },
  },
  tags: ['Artifacts'],
});

export const cleanupArtifactsRouteDef = createRoute({
  method: 'post',
  path: '/artifacts/cleanup',
  summary: 'Cleanup artifacts',
  description: 'Clean up old artifacts based on retention days',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            retention_days: z.number().int().positive().default(90).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            message: z.string(),
            deleted_count: z.number(),
          }),
        },
      },
      description: 'Cleanup completed',
    },
  },
  tags: ['Artifacts'],
});
