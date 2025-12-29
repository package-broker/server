/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import {
  packageListResponseSchema,
  packageWithVersionsResponseSchema,
  errorResponseSchema,
} from '@package-broker/shared';

export const listPackagesRouteDef = createRoute({
  method: 'get',
  path: '/api/packages',
  summary: 'List packages',
  description: 'List all packages with optional search',
  security: [{ Bearer: [] }],
  request: {
    query: z.object({
      search: z.string().optional().openapi({
        param: {
          name: 'search',
          in: 'query',
        },
        description: 'Search term to filter packages by name',
        example: 'vendor',
      }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: packageListResponseSchema,
        },
      },
      description: 'List of packages',
    },
  },
  tags: ['Packages'],
});

export const getPackageRouteDef = createRoute({
  method: 'get',
  path: '/api/packages/{name}',
  summary: 'Get package',
  description: 'Get a single package with all versions',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      name: z.string().openapi({
        param: {
          name: 'name',
          in: 'path',
        },
        description: 'Package name (e.g., vendor/package)',
        example: 'vendor/package',
      }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: packageWithVersionsResponseSchema,
        },
      },
      description: 'Package with versions',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Package not found',
    },
  },
  tags: ['Packages'],
});

export const getPackageReadmeRouteDef = createRoute({
  method: 'get',
  path: '/api/packages/{name}/{version}/readme',
  summary: 'Get package README',
  description: 'Get README.md content for a specific package version',
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
        'text/markdown': {
          schema: z.string(),
        },
      },
      description: 'README content',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'README not found',
    },
  },
  tags: ['Packages'],
});

export const getPackageChangelogRouteDef = createRoute({
  method: 'get',
  path: '/api/packages/{name}/{version}/changelog',
  summary: 'Get package changelog',
  description: 'Get CHANGELOG.md content for a specific package version',
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
        'text/markdown': {
          schema: z.string(),
        },
      },
      description: 'Changelog content',
    },
    404: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Changelog not found',
    },
  },
  tags: ['Packages'],
});
