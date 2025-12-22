// Zod schemas for validation

import { z } from 'zod';

export const credentialTypeSchema = z.enum([
  'http_basic',
  'github_token',
  'gitlab_token',
  'bitbucket_app_password',
  'bitbucket_api_token',
  'bitbucket_api_key',
  'bitbucket_server_pat',
  'bearer_token',
]);

export const vcsTypeSchema = z.enum(['git', 'composer', 'artifact']);

// Repository schemas (inline to avoid circular dependency)
export const createRepositorySchema = z.object({
  url: z.string().url('Invalid repository URL'),
  vcs_type: vcsTypeSchema,
  credential_type: credentialTypeSchema,
  auth_credentials: z.record(z.string()).refine(
    (fields) => Object.keys(fields).length > 0,
    'At least one credential field is required'
  ),
  composer_json_path: z.string().optional(),
  package_filter: z.string().optional(), // Comma-separated list of packages to sync
});

export const updateRepositorySchema = createRepositorySchema.partial();

export const repositoryResponseSchema = z.object({
  id: z.string(),
  url: z.string(),
  vcs_type: vcsTypeSchema,
  credential_type: credentialTypeSchema,
  composer_json_path: z.string().nullable(),
  package_filter: z.string().nullable(),
  status: z.enum(['pending', 'active', 'error', 'syncing']),
  error_message: z.string().nullable(),
  last_synced_at: z.number().nullable(),
  created_at: z.number(),
});

// Token schemas (inline to avoid circular dependency)
export const tokenPermissionsSchema = z.enum(['readonly', 'write']);

export const createTokenSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  permissions: tokenPermissionsSchema.default('readonly'),
  rate_limit_max: z.number().int().min(0).max(25000, 'Rate limit cannot exceed 25,000 requests/hour').nullable().default(1000),
  expires_at: z.number().int().positive().optional(),
});

export const updateTokenSchema = z.object({
  description: z.string().min(1, 'Description is required').optional(),
  rate_limit_max: z.number().int().min(0).max(25000, 'Rate limit cannot exceed 25,000 requests/hour').nullable().optional(),
});

export const tokenResponseSchema = z.object({
  id: z.string(),
  description: z.string(),
  permissions: tokenPermissionsSchema,
  rate_limit_max: z.number().nullable(),
  created_at: z.number(),
  expires_at: z.number().nullable(),
  last_used_at: z.number().nullable(),
});

