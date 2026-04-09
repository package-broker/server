/* PACKAGE.broker - Copyright (C) 2025 Łukasz Bajsarowicz - Licensed under AGPL-3.0 */

import { createRoute, z } from '@hono/zod-openapi';
import { errorResponseSchema } from '@package-broker/shared';

const importGithubOrgBodySchema = z.object({
  github_org: z.string().min(1).regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/, 'Invalid GitHub organization/user name').openapi({ description: 'GitHub organization or user name' }),
  auth_token: z.string().min(1).trim().openapi({ description: 'GitHub personal access token with read:org + repo scope' }),
  package_filter: z.string().optional().openapi({ description: 'Filter packages by name (substring match)' }),
  dry_run: z.boolean().optional().default(false).openapi({ description: 'Preview what would be imported without creating repositories' }),
});

const discoveredPackageSchema = z.object({
  name: z.string(),
  versions: z.array(z.string()),
  source: z.enum(['github_packages', 'github_api']),
});

const importGithubOrgResponseSchema = z.object({
  packages: z.array(discoveredPackageSchema),
  dryRun: z.boolean(),
  errors: z.array(z.string()),
});

export const importGithubOrgRouteDef = createRoute({
  method: 'post',
  path: '/github-org',
  summary: 'Import packages from GitHub organization',
  description: 'Discover and optionally import all Composer packages from a GitHub organization via GitHub Packages registry.',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: importGithubOrgBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: importGithubOrgResponseSchema,
        },
      },
      description: 'Discovery/import results',
    },
    400: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'Validation error',
    },
    502: {
      content: {
        'application/json': {
          schema: errorResponseSchema,
        },
      },
      description: 'GitHub API unreachable or returned an error',
    },
  },
  tags: ['Import'],
});
