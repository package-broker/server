/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Package Storage Workflow - Durable background processing for D1 storage

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { createD1Database } from '../db';
import { repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import { encryptCredentials } from '../utils/encryption';
import { getLogger } from '../utils/logger';

/**
 * Environment for the Package Storage Workflow
 */
export interface PackageStorageEnv {
  DB: D1Database;
  KV?: KVNamespace;
  ENCRYPTION_KEY: string;
}

/**
 * Parameters passed to the workflow when triggered
 */
export interface PackageStorageParams {
  /** Package name in vendor/package format */
  packageName: string;
  /** Raw package data from upstream (Packagist or Composer repo) */
  packageData: any;
  /** Repository ID (e.g., 'packagist' or repo UUID) */
  repoId: string;
  /** Proxy base URL for transforming dist URLs */
  proxyBaseUrl: string;
}

/**
 * PackageStorageWorkflow - Handles CPU-intensive D1 storage in background
 * 
 * This workflow is triggered after a package is fetched from upstream.
 * It runs with higher CPU limits than the main Worker request handler,
 * allowing for reliable storage of packages with many versions.
 * 
 * Benefits:
 * - Automatic retries on failure
 * - Higher CPU time limits (15 minutes vs 10ms on Free tier)
 * - Durable execution - survives Worker restarts
 * - Observable progress and status
 */
export class PackageStorageWorkflow extends WorkflowEntrypoint<PackageStorageEnv, PackageStorageParams> {
  async run(event: WorkflowEvent<PackageStorageParams>, step: WorkflowStep) {
    const { packageName, packageData, repoId, proxyBaseUrl } = event.payload;
    const logger = getLogger();

    logger.info('Workflow started: storing package', { packageName, repoId });

    // Step 1: Ensure repository exists (with retries)
    await step.do(
      'ensure-repository',
      {
        retries: {
          limit: 3,
          delay: '1 second',
          backoff: 'exponential',
        },
        timeout: '30 seconds',
      },
      async () => {
        const db = createD1Database(this.env.DB);
        await this.ensureRepository(db, repoId);
        logger.debug('Repository ensured', { repoId });
      }
    );

    // Step 2: Store packages in D1 (with retries for reliability)
    const result = await step.do(
      'store-packages',
      {
        retries: {
          limit: 5,
          delay: '2 seconds',
          backoff: 'exponential',
        },
        timeout: '10 minutes', // Package storage can take time for large packages
      },
      async () => {
        const db = createD1Database(this.env.DB);
        const { transformPackageDistUrls } = await import('../routes/composer');

        const { storedCount, errors } = await transformPackageDistUrls(
          packageData,
          repoId,
          proxyBaseUrl,
          db
        );

        logger.info('Stored package versions via workflow', {
          packageName,
          repoId,
          storedCount,
          errorCount: errors.length,
        });

        if (errors.length > 0) {
          logger.warn('Package storage errors in workflow', {
            packageName,
            repoId,
            errors: errors.slice(0, 5), // Log first 5 errors to avoid log bloat
            totalErrors: errors.length,
          });
        }

        return { storedCount, errorCount: errors.length };
      }
    );

    logger.info('Workflow completed: package stored', {
      packageName,
      repoId,
      ...result
    });

    return result;
  }

  /**
   * Ensure repository exists in database
   * For Packagist, creates the repository entry if missing
   */
  private async ensureRepository(
    db: ReturnType<typeof createD1Database>,
    repoId: string
  ): Promise<void> {
    // For Packagist, we need to ensure the repository entry exists
    if (repoId === 'packagist') {
      // Cache check via KV to avoid D1 query
      if (this.env.KV) {
        const cached = await this.env.KV.get('packagist_repo_exists');
        if (cached === 'true') {
          return; // Repository exists
        }
      }

      const [existing] = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, 'packagist'))
        .limit(1);

      if (existing) {
        // Cache the result
        if (this.env.KV) {
          await this.env.KV.put('packagist_repo_exists', 'true', { expirationTtl: 3600 });
        }
        return;
      }

      // Create Packagist repository entry
      const emptyCredentials = await encryptCredentials('{}', this.env.ENCRYPTION_KEY);

      await db.insert(repositories).values({
        id: 'packagist',
        url: 'https://repo.packagist.org',
        vcs_type: 'composer',
        credential_type: 'none',
        auth_credentials: emptyCredentials,
        composer_json_path: null,
        package_filter: null,
        status: 'active',
        created_at: Math.floor(Date.now() / 1000),
      });

      // Cache after creation
      if (this.env.KV) {
        await this.env.KV.put('packagist_repo_exists', 'true', { expirationTtl: 3600 });
      }
    } else {
      // For other repositories, just verify it exists
      const [existing] = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repoId))
        .limit(1);

      if (!existing) {
        throw new Error(`Repository ${repoId} not found`);
      }
    }
  }
}


