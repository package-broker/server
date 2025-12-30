/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import {
  createTokenSchema,
  updateTokenSchema,
  tokenResponseSchema,
  tokenCreationResponseSchema,
  errorResponseSchema,
} from '@package-broker/shared';

export const listTokensRouteDef = createRoute({
  method: 'get',
  path: '/tokens',
  summary: 'List tokens',
  description: 'List all API tokens',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(tokenResponseSchema),
        },
      },
      description: 'List of tokens',
    },
  },
  tags: ['Tokens'],
});

export const createTokenRouteDef = createRoute({
  method: 'post',
  path: '/tokens',
  summary: 'Create token',
  description: 'Create a new API token. The token is returned only once.',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createTokenSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: tokenCreationResponseSchema,
        },
      },
      description: 'Token created',
    },
    400: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
  },
  tags: ['Tokens'],
});

export const updateTokenRouteDef = createRoute({
  method: 'patch',
  path: '/tokens/{id}',
  summary: 'Update token',
  description: 'Update token description and rate limit',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateTokenSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: tokenResponseSchema,
        },
      },
      description: 'Token updated',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Token not found',
    },
  },
  tags: ['Tokens'],
});

export const deleteTokenRouteDef = createRoute({
  method: 'delete',
  path: '/tokens/{id}',
  summary: 'Delete token',
  description: 'Revoke an API token',
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
      description: 'Token revoked',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Token not found',
    },
  },
  tags: ['Tokens'],
});
