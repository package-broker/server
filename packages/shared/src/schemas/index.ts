// Zod schemas for validation

import { z } from '@hono/zod-openapi';

export const credentialTypeSchema = z.enum([
  'http_basic',
  'github_token',
  'gitlab_token',
  'bitbucket_app_password',
  'bitbucket_api_token',
  'bitbucket_api_key',
  'bitbucket_server_pat',
  'bearer_token',
  'ssh_key',
  'none',
]);

export const vcsTypeSchema = z.enum(['git', 'composer', 'artifact']);

// Repository schemas (inline to avoid circular dependency)
// Base schema without refinement (for .partial() compatibility in Zod v4)
const repositoryBaseSchema = z.object({
  url: z.string().url('Invalid repository URL'),
  vcs_type: vcsTypeSchema,
  credential_type: credentialTypeSchema,
  // Zod v4 requires both key and value schemas
  // Empty object allowed for 'none' credential type (public repos)
  auth_credentials: z.record(z.string(), z.string()),
  composer_json_path: z.string().optional(),
  package_filter: z.string().optional(), // Comma-separated list of packages to sync
});

// Create schema with refinement for credential validation
export const createRepositorySchema = repositoryBaseSchema.refine(
  (data: z.infer<typeof repositoryBaseSchema>) => data.credential_type === 'none' || Object.keys(data.auth_credentials).length > 0,
  { message: 'Credentials are required unless using "none" authentication', path: ['auth_credentials'] }
);

// Update schema uses partial of base (without refinement)
// Refinement doesn't apply to partial updates since fields are optional
export const updateRepositorySchema = repositoryBaseSchema.partial();

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
  rate_limit_max: z.number().int().min(0).max(25000, 'Rate limit cannot exceed 25,000 requests/hour').nullable().default(null),
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

// Auth schemas
export const loginRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  code: z.string().optional(), // 2FA code
});

export const loginResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    role: z.enum(['admin', 'viewer']),
    two_factor_enabled: z.boolean(),
  }),
});

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(['admin', 'viewer']),
  two_factor_enabled: z.boolean(),
});

export const userListResponseSchema = z.object({
  users: z.array(userResponseSchema),
});

export const createUserRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().optional(),
  role: z.enum(['admin', 'viewer']).default('viewer'),
});

export const createUserResponseSchema = z.object({
  message: z.string(),
  user: userResponseSchema,
});

// Error response schema
export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  code: z.string().optional(),
  requestId: z.string().optional(),
});

// Health check response
export const healthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.number(),
});

// Stats response
export const statsResponseSchema = z.object({
  active_repos: z.number(),
  cached_packages: z.number(),
  total_downloads: z.number(),
});

// Settings response
export const settingsResponseSchema = z.object({
  kv_available: z.boolean(),
  packagist_mirroring_enabled: z.boolean(),
  package_caching_enabled: z.boolean(),
});

export const updatePackagistMirroringRequestSchema = z.object({
  enabled: z.boolean(),
});

// Pagination schema
export const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: paginationSchema,
  });
}

// Package schemas
export const packageResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  repo_id: z.string(),
  dist_url: z.string().nullable(),
  source_dist_url: z.string().nullable(),
  released_at: z.number().nullable(),
  created_at: z.number(),
});

export const packageListResponseSchema = z.array(packageResponseSchema);

export const paginatedPackageListResponseSchema = paginatedResponseSchema(packageResponseSchema);

export const packageWithVersionsResponseSchema = z.object({
  name: z.string(),
  versions: z.array(packageResponseSchema),
});

// Token creation response (includes token only once)
export const tokenCreationResponseSchema = tokenResponseSchema.extend({
  token: z.string(), // Only returned on creation
});

// Repository list response
export const repositoryListResponseSchema = z.array(repositoryResponseSchema);
