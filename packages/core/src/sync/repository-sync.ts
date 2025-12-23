/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Main repository sync orchestrator

import { createD1Database, type Database } from '../db';
import { repositories, packages as packagesTable, artifacts } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { decryptCredentials } from '../utils/encryption';
import { syncGitHubRepository } from './github-sync';
import { syncComposerRepository } from './strategies/composer-repo';
import type { SyncResult, ComposerPackage } from './types';
import type { CredentialType } from '@package-broker/shared';
import type { StorageDriver } from '../storage/driver';
import { buildStorageKey } from '../storage/driver';
import { nanoid } from 'nanoid';
import { getLogger } from '../utils/logger';
import { getAnalytics } from '../utils/analytics';

export interface SyncEnv {
  DB: D1Database;
  KV?: KVNamespace; // Optional - only needed for some features
  QUEUE?: Queue; // Optional - only available on Workers Paid plan
  ENCRYPTION_KEY: string;
}

export interface SyncOptions {
  storage: StorageDriver;
  proxyBaseUrl: string; // URL of this proxy for transforming dist URLs
}

/**
 * Sync a repository by ID
 * Called on-demand when packages.json is requested
 */
export async function syncRepository(
  repoId: string,
  env: SyncEnv,
  options: SyncOptions
): Promise<SyncResult> {
  const db = createD1Database(env.DB);

  // Get repository details
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);

  if (!repo) {
    return { success: false, packages: [], error: 'repo_not_found' };
  }

  // Update status to syncing
  await db
    .update(repositories)
    .set({ status: 'syncing' })
    .where(eq(repositories.id, repoId));

  // Track sync start
  const analytics = getAnalytics();
  analytics.trackRepositorySyncStart({ repoId });

  try {
    // Decrypt credentials
    const credentialsJson = await decryptCredentials(repo.auth_credentials, env.ENCRYPTION_KEY);
    const credentials = JSON.parse(credentialsJson);

    let syncResult: SyncResult;

    // Dispatch to appropriate sync strategy based on vcs_type and credential_type
    if (repo.vcs_type === 'git') {
      syncResult = await syncGitRepository(
        repo.url,
        repo.credential_type as CredentialType,
        credentials,
        repo.composer_json_path || undefined
      );
    } else if (repo.vcs_type === 'composer') {
      syncResult = await syncComposerRepository(
        repo.url,
        repo.credential_type as CredentialType,
        credentials,
        repo.package_filter || undefined
      );
    } else {
      syncResult = { success: false, packages: [], error: 'unsupported_vcs_type' };
    }

    if (!syncResult.success) {
      // Update status to error
      await db
        .update(repositories)
        .set({
          status: 'error',
          error_message: syncResult.error,
          last_synced_at: Math.floor(Date.now() / 1000),
        })
        .where(eq(repositories.id, repoId));

      // Track sync failure
      analytics.trackRepositorySyncFailure({
        repoId,
        error: syncResult.error || 'unknown_error',
      });

      return syncResult;
    }

    // Store packages and transform dist URLs
    await storePackages(db, repoId, syncResult.packages, options);

    // Update repository status
    await db
      .update(repositories)
      .set({
        status: 'active',
        error_message: null,
        last_synced_at: Math.floor(Date.now() / 1000),
      })
      .where(eq(repositories.id, repoId));

    // Invalidate KV cache (if KV available)
    if (env.KV) {
      await env.KV.delete(`packages:${repoId}:packages.json`).catch(() => { });
      await env.KV.delete('packages:all:packages.json').catch(() => { });
      await env.KV.delete('packages:all:metadata').catch(() => { });
    }

    // Track sync success
    analytics.trackRepositorySyncSuccess({
      repoId,
      packageCount: syncResult.packages.length,
      strategy: syncResult.strategy || 'unknown',
    });

    return {
      success: true,
      packages: syncResult.packages,
      strategy: syncResult.strategy,
    };
  } catch (error) {
    const logger = getLogger();
    logger.error('Sync error for repo', { repoId }, error instanceof Error ? error : new Error(String(error)));

    // Update status to error
    await db
      .update(repositories)
      .set({
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        last_synced_at: Math.floor(Date.now() / 1000),
      })
      .where(eq(repositories.id, repoId));

    // Track sync failure
    const analytics = getAnalytics();
    analytics.trackRepositorySyncFailure({
      repoId,
      error: error instanceof Error ? error.message : 'unknown_error',
    });

    return {
      success: false,
      packages: [],
      error: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

/**
 * Sync a Git repository based on URL and credential type
 */
async function syncGitRepository(
  url: string,
  credentialType: CredentialType,
  credentials: Record<string, string>,
  composerJsonPath?: string
): Promise<SyncResult> {
  // Parse URL to extract owner/repo
  const urlMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);

  if (urlMatch) {
    const [, owner, repo] = urlMatch;
    return syncGitHubRepository({
      owner,
      repo: repo.replace('.git', ''),
      token: credentials.token || credentials.password || '',
      composerJsonPath,
    });
  }

  // GitLab/Bitbucket would be handled similarly
  // For now, return error for unsupported Git hosts
  return {
    success: false,
    packages: [],
    error: 'unsupported_git_host',
  };
}

/**
 * Parse release time from ISO 8601 string or use fallback
 */
function parseReleaseTime(isoTime?: string, fallback?: number): number {
  if (isoTime) {
    const timestamp = Date.parse(isoTime);
    if (!isNaN(timestamp)) {
      return Math.floor(timestamp / 1000);
    }
  }
  return fallback ?? Math.floor(Date.now() / 1000);
}

/**
 * Store synced packages in database with transformed dist URLs
 */
async function storePackages(
  db: Database,
  repoId: string,
  packages: ComposerPackage[],
  options: SyncOptions
): Promise<void> {
  for (const pkg of packages) {
    // Transform dist URL to proxy URL
    const proxyDistUrl = `${options.proxyBaseUrl}/dist/${repoId}/${pkg.name}/${pkg.version}.zip`;
    // Store original source dist URL for on-demand mirroring
    const sourceDistUrl = pkg.dist?.url || null;

    // Get existing package to preserve created_at for first-seen date
    const [existing] = await db
      .select()
      .from(packagesTable)
      .where(
        and(
          eq(packagesTable.name, pkg.name),
          eq(packagesTable.version, pkg.version)
        )
      )
      .limit(1);

    const now = Math.floor(Date.now() / 1000);
    const firstSeenAt = existing?.created_at || now;

    // Use upstream time if available, otherwise use first-seen date (created_at)
    const releasedAt = parseReleaseTime(pkg.time, firstSeenAt);

    // Upsert package (use unique constraint on name+version)
    try {
      await db.insert(packagesTable).values({
        id: nanoid(),
        repo_id: repoId,
        name: pkg.name,
        version: pkg.version,
        dist_url: proxyDistUrl,
        source_dist_url: sourceDistUrl,
        description: pkg.description || null,
        license: pkg.license ? JSON.stringify(pkg.license) : null,
        package_type: pkg.type || null,
        homepage: pkg.homepage || null,
        released_at: releasedAt,
        readme_content: pkg.readme || null,
        created_at: firstSeenAt,
      }).onConflictDoUpdate({
        target: [packagesTable.name, packagesTable.version],
        set: {
          dist_url: proxyDistUrl,
          source_dist_url: sourceDistUrl,
          description: pkg.description || null,
          license: pkg.license ? JSON.stringify(pkg.license) : null,
          package_type: pkg.type || null,
          homepage: pkg.homepage || null,
          released_at: releasedAt,
        },
      });
    } catch (error) {
      const logger = getLogger();
      logger.error('Error storing package', { packageName: pkg.name, version: pkg.version, repoId }, error instanceof Error ? error : new Error(String(error)));
    }
  }
}

