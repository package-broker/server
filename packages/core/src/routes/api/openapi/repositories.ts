/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import {
  createRepositorySchema,
  updateRepositorySchema,
  repositoryResponseSchema,
  repositoryListResponseSchema,
  errorResponseSchema,
} from '@package-broker/shared';

export const listRepositoriesRouteDef = createRoute({
  method: 'get',
  path: '/repositories',
  summary: 'List repositories',
  description: 'List all repositories',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: repositoryListResponseSchema,
        },
      },
      description: 'List of repositories',
    },
  },
  tags: ['Repositories'],
});

export const createRepositoryRouteDef = createRoute({
  method: 'post',
  path: '/repositories',
  summary: 'Create repository',
  description: 'Create a new repository',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createRepositorySchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: repositoryResponseSchema,
        },
      },
      description: 'Repository created',
    },
    400: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Invalid request',
    },
    500: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Server error',
    },
  },
  tags: ['Repositories'],
});

export const getRepositoryRouteDef = createRoute({
  method: 'get',
  path: '/repositories/{id}',
  summary: 'Get repository',
  description: 'Get a single repository by ID',
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
          schema: repositoryResponseSchema,
        },
      },
      description: 'Repository details',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Repository not found',
    },
  },
  tags: ['Repositories'],
});

export const updateRepositoryRouteDef = createRoute({
  method: 'put',
  path: '/repositories/{id}',
  summary: 'Update repository',
  description: 'Update a repository',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateRepositorySchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: repositoryResponseSchema,
        },
      },
      description: 'Repository updated',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Repository not found',
    },
  },
  tags: ['Repositories'],
});

export const deleteRepositoryRouteDef = createRoute({
  method: 'delete',
  path: '/repositories/{id}',
  summary: 'Delete repository',
  description: 'Delete a repository',
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
      description: 'Repository deleted',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Repository not found',
    },
  },
  tags: ['Repositories'],
});

export const verifyRepositoryRouteDef = createRoute({
  method: 'get',
  path: '/repositories/{id}/verify',
  summary: 'Verify repository',
  description: 'Verify repository connection and credentials',
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
            valid: z.boolean(),
            message: z.string(),
          }),
        },
      },
      description: 'Verification result',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Repository not found',
    },
  },
  tags: ['Repositories'],
});

export const syncRepositoryRouteDef = createRoute({
  method: 'post',
  path: '/repositories/{id}/sync',
  summary: 'Sync repository',
  description: 'Trigger immediate repository synchronization',
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
      description: 'Sync triggered',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Repository not found',
    },
  },
  tags: ['Repositories'],
});
