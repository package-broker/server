/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context } from 'hono';
import type { OpenAPIContext } from '../../types/openapi';
import type { DatabasePort } from '../../ports';
import { repositories } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createRepositorySchema, updateRepositorySchema, buildAuthHeaders, type CredentialType, COMPOSER_USER_AGENT } from '@package-broker/shared';
import { encryptCredentials, decryptCredentials } from '../../utils/encryption';
import { isGitHubUrl, isSshGitUrl } from '../../utils/upstream-fetch';
import { isSshSupported } from '../../utils/environment';
import { nanoid } from 'nanoid';
import { getAnalytics } from '../../utils/analytics';
import { getVcsProviderRegistry } from '../../vcs/registry';

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

  // Validate SSH key support if SSH credential type is used
  if (validated.credential_type === 'ssh_key') {
    if (!isSshSupported()) {
      return c.json(
        { 
          error: 'Bad Request', 
          message: 'SSH key authentication is not supported in this environment. SSH keys are only available in Node.js/Docker environments, not in Cloudflare Workers.' 
        },
        400
      );
    }

    // Validate that private_key is provided
    if (!validated.auth_credentials?.private_key) {
      return c.json(
        { error: 'Bad Request', message: 'SSH private key is required for SSH authentication' },
        400
      );
    }
  }

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
    // Handle git repositories via VCS provider registry (supports GitHub, GitLab, Bitbucket)
    if (repo.vcs_type === 'git') {
      return validateGitRepository(repo, encryptionKey);
    }

    // Composer repository validation (existing logic)
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

/**
 * Validate a git repository using VCS provider registry.
 * Supports GitHub, GitLab, and Bitbucket URLs.
 */
async function validateGitRepository(
  repo: typeof repositories.$inferSelect,
  encryptionKey: string
): Promise<{ success: boolean; error?: string }> {
  // SSH key authentication is handled separately
  if (repo.credential_type === 'ssh_key') {
    if (!isSshSupported()) {
      return {
        success: false,
        error: 'SSH key authentication is not supported in this environment. SSH keys are only available in Node.js/Docker environments.',
      };
    }
    if (!repo.url || !isSshGitUrl(repo.url)) {
      return { success: false, error: 'Invalid repository URL for SSH authentication.' };
    }
    return { success: true };
  }

  // Check if any VCS provider recognizes this URL
  const registry = getVcsProviderRegistry();
  const provider = registry.resolve(repo.url);

  if (provider) {
    // Decrypt credentials and verify with the provider
    try {
      const credentialsJson = await decryptCredentials(repo.auth_credentials, encryptionKey);
      const valid = await provider.verifyCredentials(
        repo.url,
        repo.credential_type,
        credentialsJson,
      );
      if (!valid) {
        return { success: false, error: 'Authentication failed. Please check your credentials.' };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during validation',
      };
    }
  }

  // Fallback to GitHub-specific validation for backward compatibility
  return validateGitHubRepository(repo, encryptionKey);
}

/**
 * Validate a GitHub repository by checking access to the repo and composer.json
 */
async function validateGitHubRepository(
  repo: typeof repositories.$inferSelect,
  encryptionKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // For SSH key authentication, skip GitHub API validation
    // SSH validation will happen during actual sync
    if (repo.credential_type === 'ssh_key') {
      if (!isSshSupported()) {
        return { 
          success: false, 
          error: 'SSH key authentication is not supported in this environment. SSH keys are only available in Node.js/Docker environments.' 
        };
      }
      // Validate SSH URL using proper hostname check (security)
      if (!repo.url || !isSshGitUrl(repo.url)) {
        return { success: false, error: 'Invalid repository URL for SSH authentication. Only GitHub URLs are supported.' };
      }
      return { success: true };
    }

    // Validate GitHub URL using proper hostname check (security)
    if (!isGitHubUrl(repo.url)) {
      return { success: false, error: 'Invalid GitHub URL. Only github.com URLs are supported.' };
    }

    // Parse GitHub URL to get owner and repo name
    const urlMatch = repo.url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!urlMatch) {
      return { success: false, error: 'Invalid GitHub URL format. Expected: https://github.com/owner/repo' };
    }
    const [, owner, repoName] = urlMatch;
    const cleanRepoName = repoName.replace('.git', '');

    // Build headers for GitHub API
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'PackageBroker/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // Add auth header if credentials are provided
    if (repo.credential_type !== 'none') {
      const credentialsJson = await decryptCredentials(repo.auth_credentials, encryptionKey);
      const credentials = JSON.parse(credentialsJson);
      const token = credentials.token || credentials.password || '';
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    // Check if repository exists and is accessible
    const repoApiUrl = `https://api.github.com/repos/${owner}/${cleanRepoName}`;
    const repoResponse = await fetch(repoApiUrl, { headers });

    if (repoResponse.status === 401) {
      return { success: false, error: 'GitHub authentication failed. Please check your token.' };
    }
    if (repoResponse.status === 403) {
      const remaining = repoResponse.headers.get('X-RateLimit-Remaining');
      if (remaining === '0') {
        return { success: false, error: 'GitHub API rate limit exceeded. Try again later or add authentication.' };
      }
      return { success: false, error: 'Access forbidden. Check your token permissions.' };
    }
    if (repoResponse.status === 404) {
      return { success: false, error: `Repository not found: ${owner}/${cleanRepoName}. Check URL or permissions.` };
    }
    if (!repoResponse.ok) {
      return { success: false, error: `GitHub API error: HTTP ${repoResponse.status}` };
    }

    // Check for composer.json in the repository
    const composerJsonPath = repo.composer_json_path || 'composer.json';
    const contentsUrl = `https://api.github.com/repos/${owner}/${cleanRepoName}/contents/${composerJsonPath}`;
    const contentsResponse = await fetch(contentsUrl, { headers });

    if (contentsResponse.status === 404) {
      return { 
        success: false, 
        error: `composer.json not found at path: ${composerJsonPath}. This repository may not be a Composer package.` 
      };
    }
    if (!contentsResponse.ok) {
      // Don't fail if we can't check composer.json - the repo itself is valid
      console.warn(`Could not verify composer.json: HTTP ${contentsResponse.status}`);
    }

    return { success: true };
  } catch (error) {
    console.error('GitHub repository validation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during GitHub validation',
    };
  }
}
