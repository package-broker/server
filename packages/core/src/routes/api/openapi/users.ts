/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import {
  userListResponseSchema,
  createUserRequestSchema,
  createUserResponseSchema,
  userResponseSchema,
  errorResponseSchema,
} from '@package-broker/shared';

export const listUsersRouteDef = createRoute({
  method: 'get',
  path: '/api/users',
  summary: 'List all users',
  description: 'List all users (admin only)',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: userListResponseSchema,
        },
      },
      description: 'List of users',
    },
    403: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Forbidden',
    },
  },
  tags: ['Users'],
});

export const createUserRouteDef = createRoute({
  method: 'post',
  path: '/api/users',
  summary: 'Create user',
  description: 'Create a new user (admin only)',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createUserRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: createUserResponseSchema,
        },
      },
      description: 'User created',
    },
    400: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
    403: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Forbidden',
    },
    409: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'User already exists',
    },
  },
  tags: ['Users'],
});

export const deleteUserRouteDef = createRoute({
  method: 'delete',
  path: '/api/users/{id}',
  summary: 'Delete user',
  description: 'Delete a user (admin only)',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({
        param: {
          name: 'id',
          in: 'path',
        },
        example: 'user123',
      }),
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
      description: 'User deleted',
    },
    400: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Cannot delete own account',
    },
    403: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Forbidden',
    },
  },
  tags: ['Users'],
});
