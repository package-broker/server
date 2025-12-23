/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Repository API routes

import type { Context } from 'hono';
import type { DatabasePort } from '../../ports';
import { repositories } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createRepositorySchema, updateRepositorySchema } from '@package-broker/shared';
import { encryptCredentials } from '../../utils/encryption';
import { nanoid } from 'nanoid';
import { buildAuthHeaders, type CredentialType, COMPOSER_USER_AGENT } from '@package-broker/shared';
import { decryptCredentials } from '../../utils/encryption';
import { getAnalytics } from '../../utils/analytics';

export interface RepositoriesRouteEnv {
  Bindings: {
    DB: D1Database;
    KV: KVNamespace;
    QUEUE?: Queue; // Optional - only available on Workers Paid plan
    ENCRYPTION_KEY: string;
  };
  Variables: {
    database: DatabasePort;
    storage: any; // StorageDriver
    requestId?: string;
    session?: { userId: string; email: string };
  };
}

/**
 * GET /api/repositories
 * List all repositories
 */
export async function listRepositories(c: Context<RepositoriesRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const allRepos = await db.select().from(repositories).orderBy(repositories.created_at);

  // Don't return encrypted credentials
  const repos = allRepos.map((repo: any) => ({
    id: repo.id,
    url: repo.url,
    vcs_type: repo.vcs_type,
    credential_type: repo.credential_type,
    composer_json_path: repo.composer_json_path,
    package_filter: repo.package_filter,
    status: repo.status,
    error_message: repo.error_message,
    last_synced_at: repo.last_synced_at,
    created_at: repo.created_at,
  }));

  return c.json(repos);
}

/**
 * POST /api/repositories
 * Create a new repository
 */
export async function createRepository(c: Context<RepositoriesRouteEnv>): Promise<Response> {
  const body = await c.req.json();
  const validated = createRepositorySchema.parse(body);

  // Encrypt credentials
  const encryptedCredentials = await encryptCredentials(
    JSON.stringify(validated.auth_credentials),
    c.env.ENCRYPTION_KEY
  );

  const db = c.get('database');
  const repoId = nanoid();

  await db.insert(repositories).values({
    id: repoId,
    url: validated.url,
    vcs_type: validated.vcs_type,
    credential_type: validated.credential_type,
    auth_credentials: encryptedCredentials,
    composer_json_path: validated.composer_json_path || null,
    package_filter: validated.package_filter || null,
    status: 'pending', // Will be validated on first sync/test
    created_at: Math.floor(Date.now() / 1000),
  });

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, repoId)).limit(1);

  // Track repository creation
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  const session = c.get('session') as { userId: string; email: string } | undefined;
  analytics.trackRepositoryCreated({
    requestId,
    repoId,
    userId: session?.userId,
  });

  return c.json(
    {
      id: repo.id,
      url: repo.url,
      vcs_type: repo.vcs_type,
      credential_type: repo.credential_type,
      composer_json_path: repo.composer_json_path,
      package_filter: repo.package_filter,
      status: repo.status,
      error_message: repo.error_message,
      last_synced_at: repo.last_synced_at,
      created_at: repo.created_at,
    },
    201
  );
}

/**
 * GET /api/repositories/:id
 * Get a single repository
 */
export async function getRepository(c: Context<RepositoriesRouteEnv>): Promise<Response> {
  const id = c.req.param('id');
  const db = c.get('database');

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!repo) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

  return c.json({
    id: repo.id,
    url: repo.url,
    vcs_type: repo.vcs_type,
    credential_type: repo.credential_type,
    composer_json_path: repo.composer_json_path,
    package_filter: repo.package_filter,
    status: repo.status,
    error_message: repo.error_message,
    last_synced_at: repo.last_synced_at,
    created_at: repo.created_at,
  });
}

/**
 * DELETE /api/repositories/:id
 * Delete a repository (cascade deletes artifacts and packages)
 */
export async function deleteRepository(c: Context<RepositoriesRouteEnv>): Promise<Response> {
  const id = c.req.param('id');
  const db = c.get('database');

  // Prevent deletion of Packagist repository
  if (id === 'packagist') {
    return c.json({ error: 'Forbidden', message: 'The Public Packagist repository cannot be deleted' }, 403);
  }

  // Check if exists
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!repo) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

  // Cascade delete will handle artifacts and packages
  await db.delete(repositories).where(eq(repositories.id, id));

  // Track repository deletion
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  const session = c.get('session') as { userId: string; email: string } | undefined;
  analytics.trackRepositoryDeleted({
    requestId,
    repoId: id,
    userId: session?.userId,
  });

  return c.json({ message: 'Repository deleted' });
}

/**
 * PUT /api/repositories/:id
 * Update a repository
 */
export async function updateRepository(c: Context<RepositoriesRouteEnv>): Promise<Response> {
  const id = c.req.param('id');
  const body = await c.req.json();
  const validated = updateRepositorySchema.parse(body);

  // Prevent editing of Packagist repository
  if (id === 'packagist') {
    return c.json({ error: 'Forbidden', message: 'The Public Packagist repository cannot be edited' }, 403);
  }

  const db = c.get('database');

  // Check if exists
  const [existing] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!existing) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

  // Build update object with only provided fields
  const updateData: Partial<{
    url: string;
    vcs_type: string;
    credential_type: string;
    auth_credentials: string;
    composer_json_path: string | null;
    package_filter: string | null;
  }> = {};

  if (validated.url !== undefined) {
    updateData.url = validated.url;
  }
  if (validated.vcs_type !== undefined) {
    updateData.vcs_type = validated.vcs_type;
  }
  if (validated.credential_type !== undefined) {
    updateData.credential_type = validated.credential_type;
  }
  if (validated.auth_credentials !== undefined) {
    // Encrypt new credentials
    updateData.auth_credentials = await encryptCredentials(
      JSON.stringify(validated.auth_credentials),
      c.env.ENCRYPTION_KEY
    );
  }
  if (validated.composer_json_path !== undefined) {
    updateData.composer_json_path = validated.composer_json_path || null;
  }
  if (validated.package_filter !== undefined) {
    updateData.package_filter = validated.package_filter || null;
  }

  // Only update if there are changes
  if (Object.keys(updateData).length > 0) {
    await db.update(repositories).set(updateData).where(eq(repositories.id, id));
  }

  // Fetch updated repository
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  // Track repository update
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  const session = c.get('session') as { userId: string; email: string } | undefined;
  analytics.trackRepositoryUpdated({
    requestId,
    repoId: id,
    userId: session?.userId,
  });

  return c.json({
    id: repo.id,
    url: repo.url,
    vcs_type: repo.vcs_type,
    credential_type: repo.credential_type,
    composer_json_path: repo.composer_json_path,
    package_filter: repo.package_filter,
    status: repo.status,
    error_message: repo.error_message,
    last_synced_at: repo.last_synced_at,
    created_at: repo.created_at,
  });
}

/**
 * GET /api/repositories/:id/verify
 * Verify repository connection (validates credentials only)
 */
export async function verifyRepository(c: Context<RepositoriesRouteEnv>): Promise<Response> {
  const id = c.req.param('id');
  const db = c.get('database');

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!repo) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

  // Validate credentials by attempting to fetch packages.json
  const result = await validateRepositoryCredentials(repo, c.env.ENCRYPTION_KEY);

  return c.json({
    verified: result.success,
    message: result.success ? 'Connection verified successfully' : result.error || 'Verification failed',
  });
}

/**
 * POST /api/repositories/:id/sync
 * Test repository connection (repurposed from sync - only validates credentials)
 * Packages are loaded lazily on first request
 */
export async function syncRepositoryNow(c: Context<RepositoriesRouteEnv>): Promise<Response> {
  const id = c.req.param('id');
  const db = c.get('database');

  // Prevent testing of Packagist repository
  if (id === 'packagist') {
    return c.json({ error: 'Forbidden', message: 'The Public Packagist repository cannot be tested' }, 403);
  }

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!repo) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

  // Update status to syncing (for UI feedback)
  await db
    .update(repositories)
    .set({ status: 'syncing' })
    .where(eq(repositories.id, id));

  // Validate credentials only (no full package sync)
  const result = await validateRepositoryCredentials(repo, c.env.ENCRYPTION_KEY);

  if (!result.success) {
    // Update status to error
    await db
      .update(repositories)
      .set({
        status: 'error',
        error_message: result.error || 'Connection test failed',
        last_synced_at: Math.floor(Date.now() / 1000),
      })
      .where(eq(repositories.id, id));

    return c.json({
      message: 'Connection test failed',
      status: 'error',
      error: result.error,
    }, 400);
  }

  // Update status to active
  await db
    .update(repositories)
    .set({
      status: 'active',
      error_message: null,
      last_synced_at: Math.floor(Date.now() / 1000),
    })
    .where(eq(repositories.id, id));

  // Clear any cached packages.json to force refresh
  await c.env.KV.delete('packages:all:packages.json');
  await c.env.KV.delete('packages:all:metadata');

  return c.json({
    message: 'Connection verified successfully. Packages will be loaded on-demand when requested.',
    status: 'active',
  });
}

/**
 * Validate repository credentials by attempting to fetch packages.json
 */
async function validateRepositoryCredentials(
  repo: typeof repositories.$inferSelect,
  encryptionKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Decrypt credentials
    const credentialsJson = await decryptCredentials(repo.auth_credentials, encryptionKey);
    const credentials = JSON.parse(credentialsJson);

    // Build auth headers
    const authHeaders = buildAuthHeaders(repo.credential_type as CredentialType, credentials);

    // Normalize URL
    const baseUrl = repo.url.replace(/\/$/, '');
    const packagesUrl = `${baseUrl}/packages.json`;

    // Attempt to fetch packages.json
    const response = await fetch(packagesUrl, {
      headers: {
        ...authHeaders,
        Accept: 'application/json',
        'User-Agent': COMPOSER_USER_AGENT,
      },
    });

    if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'Authentication failed. Please check your credentials.' };
    }

    if (response.status === 404) {
      return { success: false, error: 'packages.json not found at repository URL.' };
    }

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    // Try to parse the response to ensure it's valid JSON
    await response.json();

    return { success: true };
  } catch (error) {
    console.error('Repository validation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during validation',
    };
  }
}
