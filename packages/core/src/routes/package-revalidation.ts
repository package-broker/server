/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Stale-while-revalidate for package metadata served from the database.
//
// Once a package is stored in D1, the p2 route serves it from the database
// and never contacts upstream again. Without revalidation, new upstream
// releases (e.g. a Magento security patch) are invisible forever. This module
// re-fetches upstream metadata in the background while the stale copy keeps
// being served.
//
// Rate limiting is structural, not marker-based: the route only triggers
// revalidation on the DB-served path, which is reached at most once per
// cached-response TTL (the KV entry written by that same path). An in-memory
// set dedupes concurrent triggers within an isolate, and a content hash
// stored in KV skips the D1 upsert entirely when upstream did not change.

import type { DatabasePort } from '../ports';
import { repositories } from '../db/schema';
import { inArray } from 'drizzle-orm';
import { getLogger } from '../utils/logger';
import type { fetchPackageFromRepository, transformPackageDistUrls } from './composer';

/** How long a cached p2 response lives — doubles as the revalidation cadence. */
export const REVALIDATION_TTL_SECONDS = 3600;

/**
 * Minimal cache surface needed for revalidation. Structurally satisfied by
 * Cloudflare KVNamespace and by CachePort implementations (Redis, memory),
 * keeping this module platform-neutral per the core architecture rules.
 */
export interface RevalidationCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RevalidationDeps {
  db: DatabasePort;
  cache: RevalidationCache;
  packageName: string;
  /** Repositories the stored rows came from — revalidation is pinned to them
   * so a refresh can never migrate versions to a different repo_id
   * (cross-repo collisions, see issue #99). */
  repoIds: string[];
  encryptionKey: string;
  proxyBaseUrl: string;
  /** Injected type-safely from routes/composer.ts (type-only import avoids a runtime cycle) */
  loadPackageFromRepo: typeof fetchPackageFromRepository;
  storePackages: typeof transformPackageDistUrls;
}

/** Dedupe concurrent revalidations of the same package within this isolate */
const inFlight = new Set<string>();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Re-fetch package metadata from the repositories it was originally stored
 * from, and refresh the database only when the upstream content changed.
 * On change, the cached p2 response is purged so the next request rebuilds
 * from the refreshed rows.
 */
export async function revalidateStalePackage(deps: RevalidationDeps): Promise<void> {
  const { db, cache, packageName, repoIds, encryptionKey, proxyBaseUrl } = deps;

  if (inFlight.has(packageName)) {
    return;
  }
  inFlight.add(packageName);

  try {
    const repos = repoIds.length > 0
      ? await db.select().from(repositories).where(inArray(repositories.id, repoIds))
      : [];

    let changed = false;

    for (const repo of repos) {
      const packageData = await deps.loadPackageFromRepo(repo, packageName, encryptionKey);
      if (!packageData) {
        continue; // Upstream has no data (removed or unreachable) — keep serving stored rows
      }

      // Skip the D1 upsert when upstream content is byte-identical to the
      // last stored fetch — revalidating unchanged packages must not burn
      // the D1 write budget.
      const hashKey = `p2:${packageName}:${repo.id}:content-hash`;
      const contentHash = await sha256Hex(JSON.stringify(packageData));
      const previousHash = await cache.get(hashKey);
      if (previousHash === contentHash) {
        continue;
      }

      await deps.storePackages(packageData, repo.id, proxyBaseUrl, db);
      await cache.put(hashKey, contentHash);
      changed = true;
    }

    if (changed) {
      // Purge the cached response so the next request rebuilds from refreshed rows
      await Promise.all([
        cache.delete(`p2:${packageName}`),
        cache.delete(`p2:${packageName}:metadata`),
      ]);

      const logger = getLogger();
      logger.info('Revalidated package metadata from upstream', { packageName, repoIds });
    }
  } finally {
    inFlight.delete(packageName);
  }
}
