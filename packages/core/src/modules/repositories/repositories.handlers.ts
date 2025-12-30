/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context } from 'hono';
import type { OpenAPIContext } from '../../routes/api/types';
import type { DatabasePort } from '../../ports';
import { repositories } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createRepositorySchema, updateRepositorySchema, buildAuthHeaders, type CredentialType, COMPOSER_USER_AGENT } from '@package-broker/shared';
import { encryptCredentials, decryptCredentials } from '../../utils/encryption';
import { nanoid } from 'nanoid';
import { getAnalytics } from '../../utils/analytics';

export interface RepositoriesRouteEnv {
  Bindings: {
    DB: D1Database;
    KV: KVNamespace;
    QUEUE?: Queue;
    ENCRYPTION_KEY: string;
  };
  Variables: {
    database: DatabasePort;
    storage: any;
    requestId?: string;
    session?: { userId: string; email: string };
  };
}

export async function listRepositories(c: OpenAPIContext<RepositoriesRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const allRepos = await db.select().from(repositories).orderBy(repositories.created_at);

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

export async function createRepository(c: OpenAPIContext<RepositoriesRouteEnv, ReturnType<typeof createRepositorySchema.parse>>): Promise<Response> {
  const validated = c.req.valid('json');

  if (!c.env.ENCRYPTION_KEY || typeof c.env.ENCRYPTION_KEY !== 'string') {
    return c.json(
      { error: 'Internal Server Error', message: 'Server configuration error: ENCRYPTION_KEY is not set' },
      500
    );
  }

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
    status: 'pending',
    created_at: Math.floor(Date.now() / 1000),
  });

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, repoId)).limit(1);

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
    200
  );
}

export async function getRepository(c: OpenAPIContext<RepositoriesRouteEnv>): Promise<Response> {
  const { id } = c.req.valid('param');
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

export async function deleteRepository(c: OpenAPIContext<RepositoriesRouteEnv>): Promise<Response> {
  const { id } = c.req.valid('param');
  const db = c.get('database');

  if (id === 'packagist') {
    return c.json({ error: 'Forbidden', message: 'The Public Packagist repository cannot be deleted' }, 403);
  }

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!repo) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

  await db.delete(repositories).where(eq(repositories.id, id));

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

export async function updateRepository(c: OpenAPIContext<RepositoriesRouteEnv, ReturnType<typeof updateRepositorySchema.parse>>): Promise<Response> {
  const { id } = c.req.valid('param');
  const validated = c.req.valid('json');

  if (id === 'packagist') {
    return c.json({ error: 'Forbidden', message: 'The Public Packagist repository cannot be edited' }, 403);
  }

  const db = c.get('database');

  const [existing] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!existing) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

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
    if (!c.env.ENCRYPTION_KEY || typeof c.env.ENCRYPTION_KEY !== 'string') {
      return c.json(
        { error: 'Internal Server Error', message: 'Server configuration error: ENCRYPTION_KEY is not set' },
        500
      );
    }
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

  if (Object.keys(updateData).length > 0) {
    await db.update(repositories).set(updateData).where(eq(repositories.id, id));
  }

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

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

export async function verifyRepository(c: Context<RepositoriesRouteEnv>): Promise<Response> {
  const { id } = (c as any).req.valid('param');
  const db = c.get('database');

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!repo) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

  const result = await validateRepositoryCredentials(repo, c.env.ENCRYPTION_KEY);

  return c.json({
    valid: result.success,
    message: result.success ? 'Connection verified successfully' : result.error || 'Verification failed',
  });
}

export async function syncRepositoryNow(c: OpenAPIContext<RepositoriesRouteEnv>): Promise<Response> {
  const { id } = c.req.valid('param');
  const db = c.get('database');

  if (id === 'packagist') {
    return c.json({ error: 'Forbidden', message: 'The Public Packagist repository cannot be tested' }, 403);
  }

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);

  if (!repo) {
    return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
  }

  await db
    .update(repositories)
    .set({ status: 'syncing' })
    .where(eq(repositories.id, id));

  const result = await validateRepositoryCredentials(repo, c.env.ENCRYPTION_KEY);

  if (!result.success) {
    await db
      .update(repositories)
      .set({
        status: 'error',
        error_message: result.error || 'Connection test failed',
        last_synced_at: Math.floor(Date.now() / 1000),
      })
      .where(eq(repositories.id, id));

    return c.json({
      message: 'Sync triggered',
    }, 200);
  }

  await db
    .update(repositories)
    .set({
      status: 'active',
      error_message: null,
      last_synced_at: Math.floor(Date.now() / 1000),
    })
    .where(eq(repositories.id, id));

  if (c.env.KV) {
    await c.env.KV.delete('packages:all:packages.json');
    await c.env.KV.delete('packages:all:metadata');
  }

  return c.json({
    message: 'Sync triggered',
    status: 'active',
  });
}

async function validateRepositoryCredentials(
  repo: typeof repositories.$inferSelect,
  encryptionKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const credentialsJson = await decryptCredentials(repo.auth_credentials, encryptionKey);
    const credentials = JSON.parse(credentialsJson);

    const authHeaders = buildAuthHeaders(repo.credential_type as CredentialType, credentials);

    const baseUrl = repo.url.replace(/\/$/, '');
    const packagesUrl = `${baseUrl}/packages.json`;

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
