/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Composer routes - packages.json and p2 provider

import type { Context } from 'hono';
import type { DatabasePort, CachePort } from '../ports';
import { repositories, packages } from '../db/schema';
import { eq, and, inArray, or } from 'drizzle-orm';
import { createJobProcessor, type Job } from '../jobs/processor';
import type { StorageDriver } from '../storage/driver';
import { isPackagistMirroringEnabled, isPackageCachingEnabled } from './api/settings';
import { COMPOSER_USER_AGENT } from '@package-broker/shared';
import { nanoid } from 'nanoid';
import { encryptCredentials } from '../utils/encryption';
import { getLogger } from '../utils/logger';
import { getAnalytics } from '../utils/analytics';

export interface ComposerRouteEnv {
  Bindings: {
    DB: D1Database;
    KV?: KVNamespace; // Optional - only needed for package caching
    QUEUE?: Queue; // Optional - only available on Workers Paid plan
    PACKAGE_STORAGE_WORKFLOW?: Workflow; // Optional - Cloudflare Workflow for background storage
    ENCRYPTION_KEY: string;
  };
  Variables: {
    storage: StorageDriver;
    database: DatabasePort;
    requestId?: string;
  };
}

/**
 * GET /packages.json
 * Serve aggregated packages.json for all private repositories
 * Uses KV caching with stale-while-revalidate strategy
 */
export async function packagesJsonRoute(c: Context<ComposerRouteEnv>): Promise<Response> {
  const kvKey = 'packages:all:packages.json';
  const metadataKey = 'packages:all:metadata';

  // First, check if there are pending repositories that need sync
  // This must happen BEFORE returning cached data to ensure new repos are synced
  const hasPendingRepos = await syncPendingRepositories(c);

  // If we synced repos, clear cache to get fresh data
  if (hasPendingRepos && c.env.KV) {
    await c.env.KV.delete(kvKey).catch(() => { });
    await c.env.KV.delete(metadataKey).catch(() => { });
  }

  // Check conditional request (If-Modified-Since)
  const ifModifiedSince = c.req.header('If-Modified-Since');
  const metadata = c.env.KV ? await c.env.KV.get(metadataKey, 'json') as { lastModified: number } | null : null;

  if (ifModifiedSince && metadata?.lastModified) {
    const clientDate = new Date(ifModifiedSince).getTime();
    if (clientDate >= metadata.lastModified) {
      return new Response(null, { status: 304 });
    }
  }

  // Try to get from KV cache
  const cached = c.env.KV ? await c.env.KV.get(kvKey) : null;

  if (cached) {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    if (metadata?.lastModified) {
      headers.set('Last-Modified', new Date(metadata.lastModified).toUTCString());
    }
    headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');

    // Track metadata request (cache hit)
    const analytics = getAnalytics();
    const requestId = c.get('requestId') as string | undefined;
    analytics.trackPackageMetadataRequest({
      requestId,
      cacheHit: true,
    });

    return new Response(cached, { status: 200, headers });
  }

  // No cache - build packages.json from database
  const packagesJson = await buildPackagesJson(c);

  // Cache the result (fire-and-forget to avoid blocking on KV rate limits)
  const cachingEnabled = await isPackageCachingEnabled(c.env.KV);
  if (cachingEnabled && c.env.KV) {
    c.executionCtx.waitUntil(
      Promise.all([
        c.env.KV.put(kvKey, JSON.stringify(packagesJson)).catch(() => { }),
        c.env.KV.put(metadataKey, JSON.stringify({ lastModified: Date.now() })).catch(() => { })
      ])
    );
  }

  // Track metadata request (cache miss)
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  const packageCount = packagesJson.packages ? Object.keys(packagesJson.packages).length : 0;
  analytics.trackPackageMetadataRequest({
    requestId,
    cacheHit: false,
    packageCount,
  });

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Last-Modified', new Date().toUTCString());
  headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');

  return new Response(JSON.stringify(packagesJson), { status: 200, headers });
}

/**
 * GET /p2/:vendor/:package.json
 * Serve individual package metadata (Composer 2 provider format)
 * Supports public Packagist mirroring with lazy loading
 */
export async function p2PackageRoute(c: Context<ComposerRouteEnv>): Promise<Response> {
  const vendor = c.req.param('vendor');
  const packageFile = c.req.param('package');
  const packageName = `${vendor}/${packageFile?.replace('.json', '')}`;

  if (!vendor || !packageFile) {
    return c.json({ error: 'Bad Request', message: 'Invalid package name' }, 400);
  }

  const kvKey = `p2:${packageName}`;
  const metadataKey = `p2:${packageName}:metadata`;
  const db = c.get('database');

  // Check conditional request
  const ifModifiedSince = c.req.header('If-Modified-Since');
  const metadata = c.env.KV ? await c.env.KV.get(metadataKey, 'json') as { lastModified: number } | null : null;

  if (ifModifiedSince && metadata?.lastModified) {
    const clientDate = new Date(ifModifiedSince).getTime();
    if (clientDate >= metadata.lastModified) {
      return new Response(null, { status: 304 });
    }
  }

  // Try to get from KV cache first (includes Packagist proxied packages)
  const cached = c.env.KV ? await c.env.KV.get(kvKey) : null;

  if (cached) {
    // Return cached data directly - validation happens during storage, not retrieval
    // This avoids expensive O(n) validation loops that consume CPU time
    try {
      const cachedData = JSON.parse(cached);
      // Validate cached data type and format
      if (
        typeof cachedData !== 'object' ||
        cachedData === null ||
        (cachedData.transformed && !cachedData.packages)
      ) {
        const logger = getLogger();
        logger.warn('Invalid cache format (not an object or old format), treating as cache miss', { packageName });
        // Fire-and-forget cache deletion
        if (c.env.KV) {
          c.executionCtx.waitUntil(
            Promise.all([
              c.env.KV.delete(kvKey).catch(() => { }),
              c.env.KV.delete(metadataKey).catch(() => { })
            ])
          );
        }
      } else {
        // Valid cached response - return as-is (trust the data)
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        if (metadata?.lastModified) {
          headers.set('Last-Modified', new Date(metadata.lastModified).toUTCString());
        }
        headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
        headers.set('X-Cache', 'HIT-KV');

        // Track metadata request (cache hit)
        const analytics = getAnalytics();
        const requestId = c.get('requestId') as string | undefined;
        const packageCount = cachedData.packages?.[packageName] ? Object.keys(cachedData.packages[packageName]).length : 0;
        analytics.trackPackageMetadataRequest({
          requestId,
          cacheHit: true,
          packageCount,
        });

        return new Response(cached, { status: 200, headers });
      }
    } catch (e) {
      // Invalid JSON in cache - delete and treat as cache miss
      const logger = getLogger();
      logger.warn('Invalid JSON in cache, treating as cache miss', { packageName, error: e instanceof Error ? e.message : String(e) });
      // Fire-and-forget cache deletion
      if (c.env.KV) {
        c.executionCtx.waitUntil(
          Promise.all([
            c.env.KV.delete(kvKey).catch(() => { }),
            c.env.KV.delete(metadataKey).catch(() => { })
          ])
        );
      }
    }
  }

  // Check if packages are already in database
  const existingPackages = await db
    .select()
    .from(packages)
    .where(eq(packages.name, packageName));

  if (existingPackages.length > 0) {
    // Build response from database packages
    const packageData = buildP2Response(packageName, existingPackages);

    // Cache the result (fire-and-forget to avoid blocking on KV rate limits)
    const cachingEnabled = await isPackageCachingEnabled(c.env.KV);
    if (cachingEnabled && c.env.KV) {
      c.executionCtx.waitUntil(
        Promise.all([
          c.env.KV.put(kvKey, JSON.stringify(packageData)).catch(() => { }),
          c.env.KV.put(metadataKey, JSON.stringify({ lastModified: Date.now() })).catch(() => { })
        ])
      );
    }

    // Track metadata request (cache miss, from DB)
    const analytics = getAnalytics();
    const requestId = c.get('requestId') as string | undefined;
    const packageCount = packageData.packages[packageName] ? Object.keys(packageData.packages[packageName]).length : 0;
    analytics.trackPackageMetadataRequest({
      requestId,
      cacheHit: false,
      packageCount,
    });

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Last-Modified', new Date().toUTCString());
    headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    headers.set('X-Cache', 'HIT-DB');

    return new Response(JSON.stringify(packageData), { status: 200, headers });
  }

  // Not in database - try lazy loading from upstream repositories
  const activeRepos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.status, 'active'));

  // Try to fetch from upstream Composer repositories
  for (const repo of activeRepos) {
    if (repo.vcs_type === 'composer') {
      try {
        const { fetchPackageFromUpstream } = await import('../utils/upstream-fetch');
        const packageData = await fetchPackageFromUpstream(
          {
            id: repo.id,
            url: repo.url,
            vcs_type: repo.vcs_type,
            credential_type: repo.credential_type,
            auth_credentials: repo.auth_credentials,
            package_filter: repo.package_filter,
          },
          packageName,
          c.env.ENCRYPTION_KEY
        );

        if (packageData) {
          // Transform dist URLs in memory (lightweight, no D1 operations)
          const url = new URL(c.req.url);
          const baseUrl = `${url.protocol}//${url.host}`;
          const transformedData = transformDistUrlsInMemory(packageData, repo.id, baseUrl);

          // Check if we should skip storage (for Free tier optimization)
          const skipStorage = (c.env as any).SKIP_PACKAGE_STORAGE === 'true';

          // Store in D1 in background (doesn't block response)
          // Priority: 1. Cloudflare Workflow (durable, high CPU limits)
          //           2. waitUntil (best-effort, low CPU limits)
          if (!skipStorage) {
            const workflow = c.env.PACKAGE_STORAGE_WORKFLOW;
            const repoLogger = getLogger();

            if (workflow) {
              // Use Cloudflare Workflow for durable background processing
              c.executionCtx.waitUntil((async () => {
                try {
                  const instance = await workflow.create({
                    id: `pkg-${packageName.replace('/', '-')}-${repo.id}-${Date.now()}`,
                    params: {
                      packageName,
                      packageData,
                      repoId: repo.id,
                      proxyBaseUrl: baseUrl,
                    },
                  });
                  repoLogger.debug('Workflow triggered for repo package storage', {
                    packageName,
                    repoId: repo.id,
                    instanceId: instance.id
                  });
                } catch (e) {
                  // Workflow creation failed - fall back to inline processing
                  repoLogger.warn('Workflow creation failed for repo, falling back to inline', {
                    packageName,
                    repoId: repo.id,
                    error: e instanceof Error ? e.message : String(e)
                  });
                  try {
                    const db = c.get('database');
                    await transformPackageDistUrls(packageData, repo.id, baseUrl, db);
                  } catch (fallbackError) {
                    repoLogger.warn('Fallback storage also failed', {
                      packageName,
                      repoId: repo.id,
                      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                    });
                  }
                }
              })());
            } else {
              // Fallback to waitUntil (original behavior, may hit CPU limits)
              c.executionCtx.waitUntil((async () => {
                try {
                  const db = c.get('database');
                  const { storedCount, errors } = await transformPackageDistUrls(packageData, repo.id, baseUrl, db);
                  repoLogger.info('Stored package versions from repo (background)', { packageName, repoId: repo.id, storedCount, errorCount: errors.length });
                  if (errors.length > 0) {
                    repoLogger.warn('Package storage errors (background)', { packageName, repoId: repo.id, errors });
                  }
                } catch (e) {
                  // Ignore background errors - storage is best-effort
                  repoLogger.warn('Background storage failed', { packageName, repoId: repo.id, error: e instanceof Error ? e.message : String(e) });
                }
              })());
            }
          }

          // Track metadata request (cache miss, from upstream)
          const analytics = getAnalytics();
          const requestId = c.get('requestId') as string | undefined;
          const packageCount = transformedData.packages?.[packageName] ? Object.keys(transformedData.packages[packageName]).length : 0;
          analytics.trackPackageMetadataRequest({
            requestId,
            cacheHit: false,
            packageCount,
          });

          const headers = new Headers();
          headers.set('Content-Type', 'application/json');
          headers.set('Last-Modified', new Date().toUTCString());
          headers.set('Cache-Control', 'public, max-age=3600');
          headers.set('X-Cache', 'MISS-UPSTREAM');

          return new Response(JSON.stringify(transformedData), { status: 200, headers });
        }
      } catch (error) {
        const logger = getLogger();
        logger.warn('Error fetching package from repo', { packageName, repoId: repo.id, error: error instanceof Error ? error.message : String(error) });
        // Continue to next repository
      }
    }
  }

  // Not found in any upstream repo - check if Packagist mirroring is enabled
  const mirroringEnabled = await isPackagistMirroringEnabled(c.env.KV);

  if (!mirroringEnabled) {
    return c.json(
      {
        error: 'Not Found',
        message: 'Package not found. Public Packagist mirroring is disabled.',
      },
      404
    );
  }

  // Proxy to public Packagist
  return proxyToPackagist(c, packageName);
}

/**
 * Build aggregated packages.json from all repositories
 * Uses providers-lazy-url for large repositories (lazy loading pattern)
 */
async function buildPackagesJson(c: Context<ComposerRouteEnv>): Promise<ComposerPackagesJson> {
  const db = c.get('database');
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  // Check if we have any active Composer repositories
  const activeComposerRepos = await db
    .select()
    .from(repositories)
    .where(and(
      eq(repositories.status, 'active'),
      eq(repositories.vcs_type, 'composer')
    ));

  // Check if Packagist mirroring is enabled
  const mirroringEnabled = await isPackagistMirroringEnabled(c.env.KV);

  // Use lazy loading if:
  // 1. We have active Composer repositories, OR
  // 2. Packagist mirroring is enabled (so we can proxy public packages)
  if (activeComposerRepos.length > 0 || mirroringEnabled) {
    return {
      'providers-lazy-url': `${baseUrl}/p2/%package%.json`,
      'metadata-url': `${baseUrl}/p2/%package%.json`,
      'mirrors': [
        {
          'dist-url': `${baseUrl}/dist/m/%package%/%version%.%type%`,
          'preferred': true,
        },
      ],
      packages: {}, // Empty - packages loaded on-demand
    };
  }

  // For Git repositories only (when no Composer repos and no Packagist mirroring), use direct packages
  const allPackages = await db.select().from(packages);

  // Build Composer packages.json structure
  const packagesMap: Record<string, Record<string, PackageVersion>> = {};

  for (const pkg of allPackages) {
    if (!packagesMap[pkg.name]) {
      packagesMap[pkg.name] = {};
    }
    // Use dist_url (proxy URL) and transform to mirror format
    // source_dist_url is the original external URL - don't expose it to clients
    packagesMap[pkg.name][pkg.version] = {
      name: pkg.name,
      version: pkg.version,
      dist: {
        type: 'zip',
        url: transformDistUrlToMirrorFormat(pkg.dist_url) || pkg.dist_url,
      },
    };
  }

  return {
    packages: packagesMap,
  };
}

/**
 * Build Composer 2 provider response for a single package from stored metadata
 * Generates clean response with proper types from D1 stored data
 * 
 * NOTE: Composer 2 (p2) format expects versions as an ARRAY, not a dict keyed by version.
 * See: https://packagist.org/apidoc
 */
export function buildP2Response(
  packageName: string,
  packageVersions: Array<typeof packages.$inferSelect>
): ComposerP2Response {
  const versions: any[] = [];

  for (const pkg of packageVersions) {
    // Build dist object from database columns (no metadata parse needed)
    // Use dist_url (proxy URL) and transform to mirror format
    // source_dist_url is the original external URL - don't expose it to clients
    const dist: any = {
      type: 'zip', // Default, can be overridden from metadata if needed
      url: transformDistUrlToMirrorFormat(pkg.dist_url) || pkg.dist_url,
    };
    if (pkg.dist_reference) {
      dist.reference = pkg.dist_reference;
    }

    // Build version object with required fields (from database columns)
    const versionData: any = {
      name: packageName,
      version: pkg.version,
      dist,
    };

    // Use database columns first (no JSON parsing needed)
    if (pkg.description) {
      versionData.description = pkg.description;
    }
    if (pkg.license) {
      try {
        // License is stored as JSON string (for array support)
        const license = JSON.parse(pkg.license);
        if (typeof license === 'string' || Array.isArray(license)) {
          versionData.license = license;
        }
      } catch {
        // If parsing fails, treat as plain string
        versionData.license = pkg.license; // pkg.license is not null here due to if check
      }
    }
    if (pkg.package_type) {
      versionData.type = pkg.package_type;
    }
    if (pkg.homepage) {
      versionData.homepage = pkg.homepage;
    }
    if (pkg.released_at) {
      // Convert Unix timestamp to ISO 8601 string
      versionData.time = new Date(pkg.released_at * 1000).toISOString();
    }

    // Only parse metadata if we need fields not in database columns
    // This significantly reduces CPU usage for packages with many versions
    // We parse metadata to get: source, require, autoload, and other dependency fields
    if (pkg.metadata) {
      try {
        // Lazy parse: only extract fields we actually need
        const fullMetadata = JSON.parse(pkg.metadata);

        // Only extract essential fields that aren't in database columns
        // Essential: source, require, autoload (needed for Composer resolution)
        // Optional: require-dev, autoload-dev, conflict, replace, provide, suggest, extra, bin, keywords, authors

        // Source (not in columns, but commonly needed)
        if (fullMetadata.source !== null &&
          fullMetadata.source !== undefined &&
          fullMetadata.source !== '__unset' &&
          typeof fullMetadata.source === 'object' &&
          !Array.isArray(fullMetadata.source) &&
          typeof fullMetadata.source.type === 'string' &&
          typeof fullMetadata.source.url === 'string') {
          versionData.source = {
            type: fullMetadata.source.type,
            url: fullMetadata.source.url,
            ...(fullMetadata.source.reference && { reference: fullMetadata.source.reference }),
          };
        }

        // Dist type and shasum (if not default)
        if (fullMetadata.dist?.type && fullMetadata.dist.type !== 'zip') {
          dist.type = fullMetadata.dist.type;
        }
        if (fullMetadata.dist?.shasum) {
          dist.shasum = fullMetadata.dist.shasum;
        }

        // Dependencies (essential for Composer)
        if (fullMetadata.require && typeof fullMetadata.require === 'object' && !Array.isArray(fullMetadata.require)) {
          versionData.require = fullMetadata.require;
        }
        if (fullMetadata['require-dev'] && typeof fullMetadata['require-dev'] === 'object' && !Array.isArray(fullMetadata['require-dev'])) {
          versionData['require-dev'] = fullMetadata['require-dev'];
        }
        if (fullMetadata.autoload && typeof fullMetadata.autoload === 'object' && !Array.isArray(fullMetadata.autoload)) {
          versionData.autoload = fullMetadata.autoload;
        }
        if (fullMetadata['autoload-dev'] && typeof fullMetadata['autoload-dev'] === 'object' && !Array.isArray(fullMetadata['autoload-dev'])) {
          versionData['autoload-dev'] = fullMetadata['autoload-dev'];
        }

        // Conflict/replace/provide (important for dependency resolution)
        if (fullMetadata.conflict && typeof fullMetadata.conflict === 'object' && !Array.isArray(fullMetadata.conflict)) {
          versionData.conflict = fullMetadata.conflict;
        }
        if (fullMetadata.replace && typeof fullMetadata.replace === 'object' && !Array.isArray(fullMetadata.replace)) {
          versionData.replace = fullMetadata.replace;
        }
        if (fullMetadata.provide && typeof fullMetadata.provide === 'object' && !Array.isArray(fullMetadata.provide)) {
          versionData.provide = fullMetadata.provide;
        }

        // Optional but commonly used fields
        if (fullMetadata.suggest && typeof fullMetadata.suggest === 'object' && !Array.isArray(fullMetadata.suggest)) {
          versionData.suggest = fullMetadata.suggest;
        }
        if (fullMetadata.extra && typeof fullMetadata.extra === 'object' && !Array.isArray(fullMetadata.extra)) {
          versionData.extra = fullMetadata.extra;
        }
        if (fullMetadata.bin) {
          versionData.bin = fullMetadata.bin;
        }
        if (fullMetadata.keywords && Array.isArray(fullMetadata.keywords)) {
          versionData.keywords = fullMetadata.keywords;
        }
        if (fullMetadata.authors && Array.isArray(fullMetadata.authors)) {
          versionData.authors = fullMetadata.authors;
        }
        if (fullMetadata['notification-url'] !== undefined) {
          versionData['notification-url'] = fullMetadata['notification-url'];
        }
      } catch (error) {
        // If metadata parse fails, we still have all essential fields from database columns
        const logger = getLogger();
        logger.warn('Failed to parse stored metadata', {
          packageName: pkg.name,
          version: pkg.version,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Update dist with any metadata overrides
    versionData.dist = dist;

    versions.push(versionData);
  }

  return {
    packages: {
      [packageName]: versions,
    },
  };
}

/**
 * Ensure Packagist repository exists in database
 * Creates it if it doesn't exist
 */
export async function ensurePackagistRepository(
  db: DatabasePort,
  encryptionKey: string,
  kv?: KVNamespace
): Promise<void> {
  // Cache check to avoid D1 query on every request
  const cacheKey = 'packagist_repo_exists';
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached === 'true') {
      return; // Repository exists, skip D1 query
    }
  }

  const [existing] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, 'packagist'))
    .limit(1);

  if (existing) {
    // Cache the result for 1 hour
    if (kv) {
      await kv.put(cacheKey, 'true', { expirationTtl: 3600 });
    }
    return; // Repository already exists
  }

  // Create Packagist repository entry
  // Encrypt empty credentials object since auth_credentials is NOT NULL
  const emptyCredentials = await encryptCredentials('{}', encryptionKey);

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

  // Cache the result after creation
  if (kv) {
    await kv.put(cacheKey, 'true', { expirationTtl: 3600 });
  }
}

/**
 * Proxy request to public Packagist (for mirroring)
 * Also stores package metadata in database for artifact downloads
 */
async function proxyToPackagist(
  c: Context<ComposerRouteEnv>,
  packageName: string
): Promise<Response> {
  const packagistUrl = `https://repo.packagist.org/p2/${packageName}.json`;
  const logger = getLogger();

  try {
    // Add timeout to prevent hanging requests (Cloudflare Workers have 30s limit)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

    let response: Response;
    try {
      response = await fetch(packagistUrl, {
        headers: {
          'User-Agent': COMPOSER_USER_AGENT,
        },
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Timeout fetching from Packagist', { packageName, url: packagistUrl });
        return c.json({
          error: 'Gateway Timeout',
          message: 'Request to Packagist timed out. Please try again.'
        }, 504);
      }
      throw fetchError;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        return c.json({ error: 'Not Found', message: 'Package not found' }, 404);
      }
      if (response.status >= 500) {
        logger.warn('Packagist server error', { packageName, status: response.status });
        return c.json({
          error: 'Upstream Error',
          message: `Packagist returned error ${response.status}. Please try again later.`
        }, 502);
      }
      return c.json({
        error: 'Upstream Error',
        message: `Failed to fetch from Packagist: ${response.status} ${response.statusText}`
      }, 502);
    }

    let packageData: any;
    try {
      packageData = await response.json();
    } catch (parseError) {
      logger.error('Failed to parse Packagist response', { packageName, error: parseError instanceof Error ? parseError.message : String(parseError) });
      return c.json({
        error: 'Upstream Error',
        message: 'Invalid response from Packagist'
      }, 502);
    }

    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Transform dist URLs in memory (lightweight, no D1 operations)
    // This allows us to return the response immediately before hitting CPU limits
    const transformedData = transformDistUrlsInMemory(packageData, 'packagist', baseUrl);

    // Check if we should skip storage (for Free tier optimization)
    const skipStorage = (c.env as any).SKIP_PACKAGE_STORAGE === 'true';

    // Store in D1 in background (doesn't block response)
    // Priority: 1. Cloudflare Workflow (durable, high CPU limits)
    //           2. waitUntil (best-effort, low CPU limits)
    if (!skipStorage) {
      const workflow = c.env.PACKAGE_STORAGE_WORKFLOW;

      if (workflow) {
        // Use Cloudflare Workflow for durable background processing
        // This provides higher CPU limits and automatic retries
        c.executionCtx.waitUntil((async () => {
          try {
            const instance = await workflow.create({
              id: `pkg-${packageName.replace('/', '-')}-${Date.now()}`,
              params: {
                packageName,
                packageData,
                repoId: 'packagist',
                proxyBaseUrl: baseUrl,
              },
            });
            logger.debug('Workflow triggered for package storage', {
              packageName,
              instanceId: instance.id
            });
          } catch (e) {
            // Workflow creation failed - fall back to inline processing
            logger.warn('Workflow creation failed, falling back to inline', {
              packageName,
              error: e instanceof Error ? e.message : String(e)
            });
            // Fallback to inline processing
            try {
              const db = c.get('database');
              await ensurePackagistRepository(db, c.env.ENCRYPTION_KEY, c.env.KV);
              await transformPackageDistUrls(packageData, 'packagist', baseUrl, db);
            } catch (fallbackError) {
              logger.warn('Fallback storage also failed', {
                packageName,
                error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
              });
            }
          }
        })());
      } else {
        // Fallback to waitUntil (original behavior, may hit CPU limits)
        c.executionCtx.waitUntil((async () => {
          try {
            const db = c.get('database');
            await ensurePackagistRepository(db, c.env.ENCRYPTION_KEY, c.env.KV);
            const { storedCount, errors } = await transformPackageDistUrls(packageData, 'packagist', baseUrl, db);

            logger.info('Stored package versions from Packagist (background)', { packageName, storedCount, errorCount: errors.length });
            if (errors.length > 0) {
              logger.warn('Package storage errors (background)', { packageName, errors });
            }
          } catch (e) {
            // Ignore background errors - storage is best-effort
            logger.warn('Background storage failed', { packageName, error: e instanceof Error ? e.message : String(e) });
          }
        })());
      }
    }

    // Track metadata request (cache miss, from Packagist)
    const analytics = getAnalytics();
    const requestId = c.get('requestId') as string | undefined;
    const packageCount = transformedData.packages?.[packageName] ? Object.keys(transformedData.packages[packageName]).length : 0;
    analytics.trackPackageMetadataRequest({
      requestId,
      cacheHit: false,
      packageCount,
    });

    // Return response immediately (fast path)
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Last-Modified', new Date().toUTCString());
    headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    headers.set('X-Cache', 'MISS-PACKAGIST');

    return new Response(JSON.stringify(transformedData), { status: 200, headers });
  } catch (error) {
    logger.error('Error proxying to Packagist', {
      packageName,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    // Determine appropriate error response
    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('aborted')) {
        return c.json({
          error: 'Gateway Timeout',
          message: 'Request to Packagist timed out. Please try again.'
        }, 504);
      }
      if (error.message.includes('network') || error.message.includes('fetch')) {
        return c.json({
          error: 'Service Unavailable',
          message: 'Unable to reach Packagist. Please try again later.'
        }, 503);
      }
    }

    return c.json({
      error: 'Upstream Error',
      message: 'Failed to fetch from Packagist'
    }, 502);
  }
}

/**
 * Sync all pending repositories
 * Uses job processor which automatically chooses sync vs async execution
 * @returns true if any repositories were synced
 */
async function syncPendingRepositories(c: Context<ComposerRouteEnv>): Promise<boolean> {
  const db = c.get('database');

  // Get repositories that need sync (pending status)
  const reposToSync = await db
    .select()
    .from(repositories)
    .where(eq(repositories.status, 'pending'));

  if (reposToSync.length === 0) {
    return false;
  }

  // Determine proxy base URL from request
  const url = new URL(c.req.url);
  const proxyBaseUrl = `${url.protocol}//${url.host}`;

  // Create job processor (auto-selects Queue or Sync based on availability)
  const jobProcessor = createJobProcessor(
    {
      DB: c.env.DB,
      KV: c.env.KV,
      QUEUE: c.env.QUEUE,
      ENCRYPTION_KEY: c.env.ENCRYPTION_KEY,
    },
    {
      syncOptions: {
        storage: c.var.storage,
        proxyBaseUrl,
      },
    }
  );

  // Create sync jobs for all pending repositories
  const syncJobs: Job[] = reposToSync.map((repo: any) => ({
    type: 'sync_repository' as const,
    repoId: repo.id,
  }));

  // Process all jobs (parallel for sync, queued for async)
  await jobProcessor.enqueueAll(syncJobs);

  return true;
}

/**
 * Transform stored dist URL to mirror format
 * Converts /dist/{repoId}/package/version.zip -> /dist/m/package/version.zip
 * Leaves mirror format and external URLs unchanged
 */
function transformDistUrlToMirrorFormat(url: string | null): string | null {
  if (!url) {
    return null;
  }

  // If already mirror format or external URL, return as-is
  if (url.includes('/dist/m/') || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // Extract package name and version from stored format: /dist/{repoId}/vendor/package/version.zip
  const match = url.match(/\/dist\/[^/]+\/([^/]+\/[^/]+)\/([^/]+)\.zip$/);
  if (match) {
    const [, packageName, version] = match;
    // Extract base URL
    const baseUrl = url.substring(0, url.indexOf('/dist/'));
    return `${baseUrl}/dist/m/${packageName}/${version}.zip`;
  }

  // If pattern doesn't match, return as-is (fallback)
  return url;
}

/**
 * Transform dist URLs in memory (lightweight, no D1 storage)
 * Used for fast response before background storage
 * 
 * NOTE: Composer 2 (p2) format expects versions as an ARRAY, not a dict keyed by version.
 * See: https://packagist.org/apidoc
 */
function transformDistUrlsInMemory(
  packageData: any,
  repoId: string,
  proxyBaseUrl: string
): any {
  if (!packageData.packages) {
    return packageData;
  }

  const result: any = { packages: {} };

  for (const [pkgName, versions] of Object.entries(packageData.packages)) {
    // Composer 2 p2 format: versions must be an ARRAY of version objects
    result.packages[pkgName] = [];
    // Sanitize metadata to remove __unset values that break Composer
    const sanitizedVersions = sanitizeMetadata(versions);
    const normalizedVersions = normalizePackageVersions(sanitizedVersions);

    for (const { version, metadata } of normalizedVersions) {
      // Use existing reference or generate simple one (no expensive crypto)
      const distReference = metadata.dist?.reference || `${pkgName.replace('/', '-')}-${version}`.substring(0, 40);

      // Build transformed version
      const versionData: any = {
        ...metadata,
        name: pkgName,
        version,
        dist: {
          ...metadata.dist,
          type: metadata.dist?.type || 'zip',
          url: `${proxyBaseUrl}/dist/m/${pkgName}/${version}.zip`,
          reference: distReference,
        },
      };

      // Clean invalid source field if present
      if (versionData.source === '__unset' ||
        versionData.source === null ||
        (typeof versionData.source !== 'object' || Array.isArray(versionData.source))) {
        delete versionData.source;
      }

      // Push to array (Composer 2 p2 format)
      result.packages[pkgName].push(versionData);
    }
  }

  return result;
}

/**
 * Normalize package versions to handle both array format (Packagist p2) and object format (traditional repos)
 * Returns array of { version: string, metadata: any }
 */
function normalizePackageVersions(versions: any): Array<{ version: string; metadata: any }> {
  if (Array.isArray(versions)) {
    // Packagist p2 format: [{version: "3.9.0", ...}, {version: "3.8.1", ...}]
    return versions.map((metadata) => ({
      version: metadata.version || String(metadata),
      metadata,
    }));
  } else if (typeof versions === 'object' && versions !== null) {
    // Traditional Composer repo format: {"3.9.0": {...}, "3.8.1": {...}}
    return Object.entries(versions).map(([key, val]) => ({
      version: (val as any)?.version || key,
      metadata: val,
    }));
  }
  return [];
}

/**
 * Transform package dist URLs to proxy URLs and store in database
 * Waits for all database writes to complete before returning
 * Returns transformed data along with storage success metrics
 */
export async function transformPackageDistUrls(
  packageData: any,
  repoId: string,
  proxyBaseUrl: string,
  db: DatabasePort
): Promise<{ transformed: any; storedCount: number; errors: string[] }> {
  if (!packageData.packages) {
    return { transformed: packageData, storedCount: 0, errors: [] };
  }

  // NOTE: Composer 2 (p2) format expects versions as an ARRAY, not a dict keyed by version.
  const transformed: any = { packages: {} };
  const packagesToStore: Array<{
    pkgName: string;
    version: string;
    metadata: any;
    proxyDistUrl: string;
    sourceDistUrl: string | null;
  }> = [];

  // Step 1: Transform URLs and collect package data
  for (const [pkgName, versions] of Object.entries(packageData.packages)) {
    // Composer 2 p2 format: versions must be an ARRAY of version objects
    transformed.packages[pkgName] = [];

    // Normalize versions to handle both array and object formats
    // Normalize versions to handle both array and object formats
    // Sanitize metadata to remove __unset values that break Composer
    const sanitizedVersions = sanitizeMetadata(versions);
    const normalizedVersions = normalizePackageVersions(sanitizedVersions);

    for (const { version, metadata } of normalizedVersions) {
      const proxyDistUrl = `${proxyBaseUrl}/dist/${repoId}/${pkgName}/${version}.zip`;
      const sourceDistUrl = metadata.dist?.url || null;

      // Use existing reference or generate simple one (no expensive crypto)
      // Most Packagist packages already have dist.reference, so this is rarely needed
      const distReference = metadata.dist?.reference || `${pkgName.replace('/', '-')}-${version}`.substring(0, 40);

      // Store RAW metadata (complete upstream package version object)
      // We'll generate clean responses from stored data, not transform on ingestion
      // Only ensure name field is present for storage (if missing)
      const rawMetadata = { ...metadata };
      if (!rawMetadata.name) {
        rawMetadata.name = pkgName;
      }

      // Push to array (Composer 2 p2 format)
      transformed.packages[pkgName].push(rawMetadata);

      packagesToStore.push({
        pkgName,
        version,
        metadata: rawMetadata, // Store raw upstream metadata
        proxyDistUrl,
        sourceDistUrl,
      });
    }
  }

  // Step 2: Batch store packages to reduce D1 operations
  // Verify repository exists before storing packages
  const [repoExists] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);

  if (!repoExists) {
    const logger = getLogger();
    logger.error('Repository not found - cannot store packages', { repoId });
    return { transformed, storedCount: 0, errors: [`Repository ${repoId} not found`] };
  }

  if (packagesToStore.length === 0) {
    return { transformed, storedCount: 0, errors: [] };
  }

  // Batch check existing packages - use optimized approach to avoid SQL variable limit
  // Strategy: Query by package name only (single condition), then filter in memory
  // This avoids the OR clause with many conditions that hits SQLite's variable limit
  const packageKeys = packagesToStore.map(p => ({ name: p.pkgName, version: p.version }));
  const existingMap = new Map<string, typeof packages.$inferSelect>();

  // Get unique package names
  const uniquePackageNames = [...new Set(packageKeys.map(k => k.name))];

  // Query all versions for these packages in a single query (much more efficient)
  // This uses a single IN clause instead of many OR conditions
  if (uniquePackageNames.length > 0) {
    // Process package names in chunks to avoid variable limit on IN clause
    const nameChunkSize = 500; // IN clause can handle more items than OR clauses
    for (let i = 0; i < uniquePackageNames.length; i += nameChunkSize) {
      const nameChunk = uniquePackageNames.slice(i, i + nameChunkSize);
      const allVersions = await db
        .select()
        .from(packages)
        .where(inArray(packages.name, nameChunk));

      // Add all results to map
      for (const existing of allVersions) {
        existingMap.set(`${existing.name}:${existing.version}`, existing);
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const errors: string[] = [];
  let storedCount = 0;

  // Prepare batch insert data
  const insertData: Array<typeof packages.$inferInsert> = [];

  for (const { pkgName, version, metadata, proxyDistUrl, sourceDistUrl } of packagesToStore) {
    try {
      const key = `${pkgName}:${version}`;
      const existing = existingMap.get(key);
      const releasedAt = metadata.time ? Math.floor(new Date(metadata.time).getTime() / 1000) : now;

      // Use existing reference or generate simple one (no expensive crypto)
      // Most Packagist packages already have dist.reference, so this is rarely needed
      const distReference = metadata.dist?.reference || `${pkgName.replace('/', '-')}-${version}`.substring(0, 40);

      // Clean metadata before storing - remove invalid source values
      const cleanedMetadata = { ...metadata };
      if (cleanedMetadata.source === '__unset' ||
        cleanedMetadata.source === null ||
        (typeof cleanedMetadata.source !== 'object' || Array.isArray(cleanedMetadata.source))) {
        // Remove invalid source field
        delete cleanedMetadata.source;
      }

      const packageData: typeof packages.$inferInsert = {
        id: existing?.id || nanoid(),
        repo_id: repoId,
        name: pkgName,
        version: version,
        dist_url: proxyDistUrl,
        source_dist_url: sourceDistUrl,
        dist_reference: distReference,
        description: metadata.description || null,
        license: metadata.license ? JSON.stringify(metadata.license) : null,
        package_type: metadata.type || null,
        homepage: metadata.homepage || null,
        released_at: releasedAt,
        readme_content: metadata.readme || null,
        metadata: JSON.stringify(cleanedMetadata),
        created_at: existing?.created_at || now,
      };

      insertData.push(packageData);
    } catch (error) {
      const errorMsg = `${pkgName}@${version}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      const logger = getLogger();
      logger.error('Error preparing package for batch insert', { pkgName, version, repoId }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Batch insert/update using onConflictDoUpdate
  // Note: Drizzle's onConflictDoUpdate with batch inserts requires careful handling
  // We'll process in smaller batches to ensure reliability
  if (insertData.length > 0) {
    try {
      // Process in chunks of 50 to balance performance and reliability
      const chunkSize = 50;
      for (let i = 0; i < insertData.length; i += chunkSize) {
        const chunk = insertData.slice(i, i + chunkSize);

        // Use individual upserts within chunk for proper conflict handling
        // This is still much better than one-by-one for all packages
        await Promise.allSettled(
          chunk.map(async (pkgData) => {
            try {
              await db
                .insert(packages)
                .values(pkgData)
                .onConflictDoUpdate({
                  target: [packages.name, packages.version],
                  set: {
                    repo_id: pkgData.repo_id,
                    dist_url: pkgData.dist_url,
                    source_dist_url: pkgData.source_dist_url,
                    dist_reference: pkgData.dist_reference,
                    description: pkgData.description,
                    license: pkgData.license,
                    package_type: pkgData.package_type,
                    homepage: pkgData.homepage,
                    released_at: pkgData.released_at,
                    metadata: pkgData.metadata,
                  },
                });
            } catch (error) {
              const logger = getLogger();
              logger.error('Error upserting package in batch', {
                packageName: pkgData.name,
                version: pkgData.version,
                repoId
              }, error instanceof Error ? error : new Error(String(error)));
              throw error;
            }
          })
        );
      }
      storedCount = insertData.length;
    } catch (error) {
      const logger = getLogger();
      logger.error('Error in batch insert', { repoId, packageCount: insertData.length }, error instanceof Error ? error : new Error(String(error)));
      // Fall back to individual inserts if batch fails
      const fallbackResults = await Promise.allSettled(
        packagesToStore.map(({ pkgName, version, metadata, proxyDistUrl, sourceDistUrl }) =>
          storePackageInDB(db, pkgName, version, metadata, repoId, proxyDistUrl, sourceDistUrl)
        )
      );
      storedCount = fallbackResults.filter(r => r.status === 'fulfilled').length;
      fallbackResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const { pkgName, version } = packagesToStore[index];
          errors.push(`${pkgName}@${version}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        }
      });
    }
  }

  return { transformed, storedCount, errors };
}

/**
 * Store package metadata in database (synchronous)
 */
export async function storeLazyPackageMetadata(
  db: DatabasePort,
  repoId: string,
  packageName: string,
  packageData: any,
  proxyBaseUrl: string
): Promise<void> {
  if (!packageData.packages?.[packageName]) {
    return;
  }

  const versions = packageData.packages[packageName];

  // Normalize versions to handle both array and object formats
  const normalizedVersions = normalizePackageVersions(versions);

  for (const { version, metadata } of normalizedVersions) {
    const proxyDistUrl = `${proxyBaseUrl}/dist/${repoId}/${packageName}/${version}.zip`;
    const sourceDistUrl = (metadata as any).dist?.url || null;

    await storePackageInDB(
      db,
      packageName,
      version,
      metadata as any,
      repoId,
      proxyDistUrl,
      sourceDistUrl
    );
  }
}

/**
 * Store a single package in database
 * Throws errors for caller to handle
 */
export async function storePackageInDB(
  db: DatabasePort,
  packageName: string,
  version: string,
  metadata: any,
  repoId: string,
  proxyDistUrl: string,
  sourceDistUrl: string | null
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const releasedAt = metadata.time ? Math.floor(new Date(metadata.time).getTime() / 1000) : now;

  // Check if package already exists
  const [existing] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.name, packageName), eq(packages.version, version)))
    .limit(1);

  // Use existing reference or generate simple one (no expensive crypto)
  // Most Packagist packages already have dist.reference, so this is rarely needed
  const distReference = metadata.dist?.reference || `${packageName.replace('/', '-')}-${version}`.substring(0, 40);

  // Clean metadata before storing - remove invalid source values
  const cleanedMetadata = { ...metadata };
  if (cleanedMetadata.source === '__unset' ||
    cleanedMetadata.source === null ||
    (typeof cleanedMetadata.source !== 'object' || Array.isArray(cleanedMetadata.source))) {
    // Remove invalid source field
    delete cleanedMetadata.source;
  }

  const packageData = {
    id: existing?.id || nanoid(),
    repo_id: repoId,
    name: packageName,
    version: version,
    dist_url: proxyDistUrl,
    source_dist_url: sourceDistUrl,
    dist_reference: distReference,
    description: metadata.description || null,
    license: metadata.license ? JSON.stringify(metadata.license) : null,
    package_type: metadata.type || null,
    homepage: metadata.homepage || null,
    released_at: releasedAt,
    readme_content: metadata.readme || null,
    metadata: JSON.stringify(cleanedMetadata), // Store cleaned upstream metadata as JSON
    created_at: existing?.created_at || now,
  };

  if (existing) {
    await db
      .update(packages)
      .set({
        repo_id: repoId, // Update repo_id in case it changed
        dist_url: proxyDistUrl,
        source_dist_url: sourceDistUrl,
        dist_reference: distReference,
        description: packageData.description,
        license: packageData.license,
        package_type: packageData.package_type,
        homepage: packageData.homepage,
        released_at: releasedAt,
        metadata: packageData.metadata, // Update metadata
      })
      .where(and(eq(packages.name, packageName), eq(packages.version, version)));
  } else {
    await db.insert(packages).values(packageData);
  }
}

// Type definitions
interface ComposerPackagesJson {
  packages: Record<string, Record<string, PackageVersion>>;
  'providers-url'?: string;
  'provider-includes'?: Record<string, { sha256: string }>;
  'providers-lazy-url'?: string;
  'metadata-url'?: string;
  'mirrors'?: Array<{
    'dist-url': string;
    'preferred'?: boolean;
  }>;
}

interface ComposerP2Response {
  // Composer 2 p2 format: packages is a dict of package name -> array of versions
  packages: Record<string, PackageVersion[]>;
}

/**
 * Package version metadata in Composer p2 format
 * 
 * Required fields:
 * - name: Package name (vendor/package) - MUST be present
 * - version: Version string - MUST be present
 * - dist: Distribution information - MUST be present with at least type and url
 * 
 * Optional fields:
 * - time: Release timestamp (ISO 8601)
 * - description: Package description
 * - license: License identifier(s)
 * - type: Package type (e.g., "library", "metapackage")
 * - homepage: Homepage URL
 * - source: Source repository information
 * - require: Runtime dependencies
 * - require-dev: Development dependencies
 * - autoload: Autoload configuration
 * - notification-url: Notification URL
 */
interface PackageVersion {
  /** Required: Package name in vendor/package format */
  name: string;
  /** Required: Version string */
  version: string;
  /** Required: Distribution information */
  dist: {
    /** Required: Distribution type (usually "zip") */
    type: string;
    /** Required: Download URL */
    url: string;
    /** Optional: Reference (commit hash, tag, etc.) for mirror URL substitution */
    reference?: string;
    /** Optional: SHA-1 checksum */
    shasum?: string;
    /** Optional: Mirror URLs (used by repository-level mirrors) */
    mirrors?: Array<{
      url: string;
      preferred?: boolean;
    }>;
  };
  /** Optional: Release timestamp */
  time?: string;
  /** Optional: Package description */
  description?: string;
  /** Optional: License identifier(s) */
  license?: string | string[];
  /** Optional: Package type */
  type?: string;
  /** Optional: Homepage URL */
  homepage?: string;
  /** Optional: Source repository information */
  source?: {
    type: string;
    url: string;
    reference: string;
  };
  /** Optional: Runtime dependencies */
  require?: Record<string, string>;
  /** Optional: Development dependencies */
  'require-dev'?: Record<string, string>;
  /** Optional: Autoload configuration */
  autoload?: object;
  /** Optional: Notification URL */
  'notification-url'?: string | null;
}


/**
 * Sanitize package metadata to handle Packagist's minification artifacts
 * Specifically handles "__unset" string values which cause Composer to crash
 * when it expects an array or object
 */
function sanitizeMetadata(metadata: any): any {
  if (!metadata || typeof metadata !== 'object') {
    return metadata;
  }

  // Handle array input (recurse)
  if (Array.isArray(metadata)) {
    return metadata.map(item => sanitizeMetadata(item));
  }

  const sanitized: any = {};

  for (const key of Object.keys(metadata)) {
    const value = metadata[key];

    // Handle "__unset" value
    if (value === '__unset') {
      // For fields that are expected to be arrays/objects, replace with empty array
      // This is safe for Composer's foreach loops and array checks
      if ([
        'require', 'require-dev', 'suggest', 'provide', 'replace', 'conflict',
        'autoload', 'autoload-dev', 'extra', 'bin', 'license', 'authors',
        'keywords', 'repositories', 'include-path'
      ].includes(key)) {
        sanitized[key] = [];
      } else {
        // For other fields, just omit them (equivalent to unset)
        continue;
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recurse into objects
      sanitized[key] = sanitizeMetadata(value);
    } else {
      // Copy primitive values as-is
      sanitized[key] = value;
    }
  }

  return sanitized;
}
