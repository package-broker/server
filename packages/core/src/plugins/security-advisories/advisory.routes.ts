/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';

const advisorySchema = z.object({
  cve: z.string().nullable(),
  title: z.string(),
  link: z.string(),
  affected_versions: z.string(),
  package_name: z.string(),
});

const vulnerabilityCheckResultSchema = z.object({
  package_name: z.string(),
  version: z.string(),
  advisories: z.array(advisorySchema),
  is_vulnerable: z.boolean(),
});

export const listAdvisoriesRoute = createRoute({
  method: 'get',
  path: '/advisories',
  tags: ['Security'],
  summary: 'Check packages for security advisories',
  description: 'Query the Packagist security advisories database for vulnerabilities affecting specified packages.',
  request: {
    query: z.object({
      packages: z
        .string()
        .optional()
        .openapi({
          description: 'Comma-separated list of package names to check (e.g. "symfony/http-kernel,laravel/framework")',
          example: 'symfony/http-kernel,laravel/framework',
        }),
    }),
  },
  responses: {
    200: {
      description: 'Advisory check results',
      content: {
        'application/json': {
          schema: z.object({
            advisories: z.record(z.string(), z.array(advisorySchema)),
            packages_checked: z.number(),
            vulnerable_count: z.number(),
            upstream_error: z.boolean().optional(),
          }),
        },
      },
    },
  },
});

export const checkPackageRoute = createRoute({
  method: 'get',
  path: '/advisories/{vendor}/{package}/{version}',
  tags: ['Security'],
  summary: 'Check a specific package version for advisories',
  request: {
    params: z.object({
      vendor: z.string().openapi({ description: 'Composer vendor name (e.g. "symfony")', example: 'symfony' }),
      package: z.string().openapi({ description: 'Composer package name (e.g. "http-kernel")', example: 'http-kernel' }),
      version: z.string().openapi({ description: 'Package version (e.g. "6.3.0")', example: '6.3.0' }),
    }),
  },
  responses: {
    200: {
      description: 'Vulnerability check result for specific package version',
      content: {
        'application/json': {
          schema: vulnerabilityCheckResultSchema,
        },
      },
    },
  },
});
