/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Dist route - serve cached artifacts

import type { Context } from 'hono';
import type { DatabasePort } from '../ports';
import { artifacts, packages, repositories } from '../db/schema';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { StorageDriver } from '../storage/driver';
import { buildStorageKey, buildReadmeStorageKey, buildChangelogStorageKey } from '../storage/driver';
import { downloadFromSource } from '../utils/download';
import { decryptCredentials } from '../utils/encryption';
import { COMPOSER_USER_AGENT } from '@package-broker/shared';
import { nanoid } from 'nanoid';
import { unzipSync, strFromU8 } from 'fflate';
import { getLogger } from '../utils/logger';
import { getAnalytics } from '../utils/analytics';
import { type AuthContext } from '../middleware/auth';
import { isPackagistMirroringEnabled } from '../modules/admin';
import { matchesPackageFilter } from '../utils/repository-filter.js';

/**
 * Convert a normalized version back to possible original versions.
 * Composer uses version_normalized in mirror URLs, but we store original versions.
 * 
 * Examples:
 * - '103.0.7.0-patch8' → ['103.0.7-p8', '103.0.7.0-patch8']
 * - '7.17.3.0' → ['7.17.3', 'v7.17.3', '7.17.3.0']
 * - '1.33.0.0' → ['1.33.0', 'v1.33.0', '1.33.0.0']
 */
function denormalizeVersion(normalizedVersion: string): string[] {
  const versions: string[] = [normalizedVersion];
  
  // Handle Magento patch format: 103.0.7.0-patch8 → 103.0.7-p8
  const patchMatch = normalizedVersion.match(/^(\d+\.\d+\.\d+)\.0-patch(\d+)$/);
  if (patchMatch) {
    const [, base, patch] = patchMatch;
    versions.push(`${base}-p${patch}`);
    return versions;
  }
  
  // Handle 4-part version with trailing .0: 7.17.3.0 → 7.17.3, v7.17.3
  const fourPartMatch = normalizedVersion.match(/^(\d+\.\d+\.\d+)\.0$/);
  if (fourPartMatch) {
    const [, base] = fourPartMatch;
    versions.push(base);
    versions.push(`v${base}`);
    return versions;
  }
  
  // Handle simple version with trailing .0: 1.2.0 → 1.2, v1.2
  const trailingZeroMatch = normalizedVersion.match(/^(\d+\.\d+)\.0$/);
  if (trailingZeroMatch) {
    const [, base] = trailingZeroMatch;
    versions.push(base);
    versions.push(`v${base}`);
    return versions;
  }
  
  // Add v-prefixed version as fallback
  if (!normalizedVersion.startsWith('v')) {
    versions.push(`v${normalizedVersion}`);
  }
  
  return versions;
}

export interface DistRouteEnv {
  Bindings: {
    DB: D1Database;
    KV: KVNamespace;
    QUEUE?: Queue; // Optional - only available on Workers Paid plan
    ENCRYPTION_KEY: string;
  };
  Variables: {
    storage: StorageDriver;
    database: DatabasePort;
    requestId?: string;
    auth?: AuthContext;
    session?: { userId: string; email: string };
  };
}

/**
 * Extract README.md or README.mdown from ZIP archive
 */
function extractReadme(zipData: Uint8Array): string | null {
  try {
    const files = unzipSync(zipData);

    // Look for README in common locations (case-insensitive)
    // Prefer .md over .mdown if both exist
    const readmeNames = [
      'README.md', 'readme.md', 'README.MD', 'Readme.md',
      'README.mdown', 'readme.mdown', 'README.MDOWN', 'Readme.mdown'
    ];

    // First pass: look for .md files
    for (const [path, content] of Object.entries(files)) {
      const filename = path.split('/').pop() || '';
      if (readmeNames.slice(0, 4).includes(filename)) {
        return strFromU8(content);
      }
    }

    // Second pass: look for .mdown files
    for (const [path, content] of Object.entries(files)) {
      const filename = path.split('/').pop() || '';
      if (readmeNames.slice(4).includes(filename)) {
        return strFromU8(content);
      }
    }

    return null;
  } catch (error) {
    const logger = getLogger();
    logger.error('Error extracting README from ZIP', {}, error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Extract CHANGELOG.md or CHANGELOG.mdown from ZIP archive
 */
function extractChangelog(zipData: Uint8Array): string | null {
  try {
    const files = unzipSync(zipData);

    // Look for CHANGELOG in common locations (case-insensitive)
    // Prefer .md over .mdown if both exist
    const changelogNames = [
      'CHANGELOG.md', 'changelog.md', 'CHANGELOG.MD', 'Changelog.md',
      'CHANGELOG.mdown', 'changelog.mdown', 'CHANGELOG.MDOWN', 'Changelog.mdown'
    ];

    // First pass: look for .md files
    for (const [path, content] of Object.entries(files)) {
      const filename = path.split('/').pop() || '';
      if (changelogNames.slice(0, 4).includes(filename)) {
        return strFromU8(content);
      }
    }

    // Second pass: look for .mdown files
    for (const [path, content] of Object.entries(files)) {
      const filename = path.split('/').pop() || '';
      if (changelogNames.slice(4).includes(filename)) {
        return strFromU8(content);
      }
    }

    return null;
  } catch (error) {
    const logger = getLogger();
    logger.error('Error extracting CHANGELOG from ZIP', {}, error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Proactively extract and store README and CHANGELOG from ZIP data
 * Runs in background to not block the response
 */
async function extractAndStoreReadme(
  storage: StorageDriver,
  zipData: Uint8Array,
  storageType: 'private' | 'public',
  repoId: string,
  packageName: string,
  version: string
): Promise<void> {
  try {
    const logger = getLogger();

    // Extract and store README
    const readmeContent = extractReadme(zipData);
    const readmeStorageKey = buildReadmeStorageKey(storageType, repoId, packageName, version);

    if (readmeContent) {
      // Store README in R2/S3
      const readmeBytes = new TextEncoder().encode(readmeContent);
      await storage.put(readmeStorageKey, readmeBytes);
      logger.info('Proactively stored README', { packageName, version, storageType, repoId });
    } else {
      // Store NOT_FOUND marker to avoid repeated extraction attempts
      const notFoundMarker = new TextEncoder().encode('NOT_FOUND');
      await storage.put(readmeStorageKey, notFoundMarker);
    }

    // Extract and store CHANGELOG
    const changelogContent = extractChangelog(zipData);
    const changelogStorageKey = buildChangelogStorageKey(storageType, repoId, packageName, version);

    if (changelogContent) {
      // Store CHANGELOG in R2/S3
      const changelogBytes = new TextEncoder().encode(changelogContent);
      await storage.put(changelogStorageKey, changelogBytes);
      logger.info('Proactively stored CHANGELOG', { packageName, version, storageType, repoId });
    } else {
      // Store NOT_FOUND marker to avoid repeated extraction attempts
      const notFoundMarker = new TextEncoder().encode('NOT_FOUND');
      await storage.put(changelogStorageKey, notFoundMarker);
    }
  } catch (error) {
    // Don't fail the main request if README extraction fails
    const logger = getLogger();
    logger.error('Error extracting/storing README', { packageName, version, storageType, repoId }, error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * GET /dists/:vendor/:package/:version/:reference (mirror URL format - Private Packagist style)
 * OR
 * GET /dist/m/:vendor/:package/:version.zip (legacy mirror format)
 * 
 * Server resolves repository from package name - no repo ID in URL.
 * Serve cached artifact with streaming, Last-Modified headers, and conditional requests.
 */
export async function distRoute(c: Context<DistRouteEnv>): Promise<Response> {
  const vendor = c.req.param('vendor');
  const pkgParam = c.req.param('package');
  let version = c.req.param('version')?.replace('.zip', '') || '';
  const reference = c.req.param('reference')?.replace('.zip', '');
  
  // Optional legacy route param (only present on /dist/:repo_id/:vendor/:package/:version)
  const repoIdParam = c.req.param('repo_id');
  
  const db = c.get('database');

  if (!vendor || !pkgParam || !version) {
    return c.json({ error: 'Bad Request', message: 'Missing required parameters' }, 400);
  }

  const packageName = `${vendor}/${pkgParam}`;
  
  // Get possible original versions from the normalized version
  // Composer uses version_normalized in mirror URLs, but we store original versions
  const possibleVersions = denormalizeVersion(version);

  const upstreamHasRequestedVersion = (packageVersions: unknown, versionsToMatch: string[]): boolean => {
    if (!packageVersions) return false;
    if (Array.isArray(packageVersions)) {
      // Composer 2 p2 format: array of version objects
      return packageVersions.some((v: any) =>
        versionsToMatch.includes(v?.version) || versionsToMatch.includes(v?.version_normalized)
      );
    }
    if (typeof packageVersions === 'object') {
      // Composer 1 format: object keyed by version
      return versionsToMatch.some((v) => (packageVersions as any)[v]);
    }
    return false;
  };
  
  // Look up package in database to find repo_id and actual version
  let repoId: string | undefined;
  if (repoIdParam && repoIdParam !== 'm') {
    repoId = repoIdParam;

    // If version exists for this explicit repo, normalize to the stored version
    const [pkgInRepo] = await db
      .select({ version: packages.version })
      .from(packages)
      .where(and(
        eq(packages.repo_id, repoIdParam),
        eq(packages.name, packageName),
        or(...possibleVersions.map(v => eq(packages.version, v)))
      ))
      .limit(1);
    if (pkgInRepo) {
      version = pkgInRepo.version;
    }
  } else {
    // Prefer a DB match on package+version if present (avoids unnecessary upstream calls)
    const matchingPkgs = await db
      .select({ repo_id: packages.repo_id, version: packages.version })
      .from(packages)
      .where(and(
        eq(packages.name, packageName),
        or(...possibleVersions.map(v => eq(packages.version, v)))
      ));

    if (matchingPkgs.length > 0) {
      // Deterministically pick repo by UI priority (created_at ASC), and only then fall back
      const repoIds = Array.from(new Set(matchingPkgs.map((p: { repo_id: string }) => p.repo_id))).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      );

      const nonPackagistRepoIds = repoIds.filter((id) => id !== 'packagist');
      if (nonPackagistRepoIds.length > 0) {
        const reposInPriorityOrder = await db
          .select({ id: repositories.id })
          .from(repositories)
          .where(inArray(repositories.id, nonPackagistRepoIds))
          .orderBy(repositories.created_at);

        const pickedRepoId = reposInPriorityOrder[0]?.id;
        if (pickedRepoId) {
          repoId = pickedRepoId;
          const matched = matchingPkgs.find((p: { repo_id: string; version: string }) => p.repo_id === pickedRepoId);
          if (matched) {
            version = matched.version;
          }
        }
      }

      // If only Packagist is available in DB (or repo lookup failed), fall back to the first match
      if (!repoId) {
        repoId = matchingPkgs[0]!.repo_id;
        version = matchingPkgs[0]!.version;
      }
    } else {
      // Not in DB for this version - probe active repos in deterministic priority order
      const activeRepos = await db
        .select()
        .from(repositories)
        .where(eq(repositories.status, 'active'))
        .orderBy(repositories.created_at);

      const { fetchPackageFromUpstream } = await import('../utils/upstream-fetch.js');

      for (const repo of activeRepos) {
        if (repo.vcs_type !== 'composer') continue;
        if (!matchesPackageFilter(repo.package_filter, packageName)) continue;

        try {
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

          const packageVersions = packageData?.packages?.[packageName];
          if (upstreamHasRequestedVersion(packageVersions, possibleVersions)) {
            repoId = repo.id;
            break;
          }
        } catch (error) {
          const logger = getLogger();
          logger.debug('Repo does not have requested package version', {
            repoId: repo.id,
            packageName,
            version,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Finally fall back to 'packagist' if no private repos have it and mirroring is enabled
      if (!repoId) {
        const mirroringEnabled = await isPackagistMirroringEnabled(c.env.KV);
        if (mirroringEnabled) {
          repoId = 'packagist';
        }
      }
    }
  }

  if (!repoId) {
    return c.json({ error: 'Bad Request', message: 'Could not determine repository for package' }, 400);
  }

  const storage = c.var.storage;

  // Handle Packagist packages (repo_id = "packagist") - cache in storage
  if (repoId === 'packagist') {
    // Use public storage key for Packagist packages
    const storageKey = buildStorageKey('public', 'packagist', packageName, version);

    // Look up artifact in database
    let artifact: (typeof artifacts.$inferSelect) | undefined = (
      await db
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.repo_id, 'packagist'),
            eq(artifacts.package_name, packageName),
            eq(artifacts.version, version)
          )
        )
        .limit(1)
    )[0];

    // Check if artifact exists in storage
    let stream = await storage.get(storageKey);

    // If not in storage, fetch from Packagist and cache
    if (!stream) {
      const packagistUrl = `https://repo.packagist.org/p2/${packageName}.json`;
      try {
        const response = await fetch(packagistUrl, {
          headers: {
            'User-Agent': COMPOSER_USER_AGENT,
          },
        });

        if (response.ok) {
          const packagistData: any = await response.json();
          const versions = packagistData.packages?.[packageName];

          // Find version in array (Composer 2 p2 format) or dictionary (legacy format)
          // Handle version normalization:
          // - 1.5.9.0 → 1.5.9 (trailing .0)
          // - 3.9999999.9999999.9999999-dev → 3.x-dev (dev version)
          // - 2.4.8.0-patch3 → 2.4.8-p3 (patch alias)
          const shortVersion = version.replace(/\.0$/, '');
          const devMatch = version.match(/^(\d+)\.9999999\.9999999\.9999999-dev$/);
          const xDevVersion = devMatch ? `${devMatch[1]}.x-dev` : null;
          const patchVersion = version.includes('-patch')
            ? version.replace(/\.0(-|$)/, '$1').replace('-patch', '-p')
            : null;

          let versionData: any = null;
          if (Array.isArray(versions)) {
            // Composer 2 p2 format: array of version objects
            versionData = versions.find((v: any) =>
              v.version === version ||
              v.version === shortVersion ||
              v.version_normalized === version ||
              (xDevVersion && v.version === xDevVersion) ||
              (patchVersion && v.version === patchVersion)
            );
          } else if (versions) {
            // Legacy format: dictionary keyed by version
            versionData = versions[version] ||
              versions[shortVersion] ||
              (xDevVersion && versions[xDevVersion]) ||
              (patchVersion && versions[patchVersion]);
          }

          if (versionData?.dist?.url) {
            // Download from Packagist
            const sourceResponse = await fetch(versionData.dist.url, {
              headers: {
                'User-Agent': COMPOSER_USER_AGENT,
              },
            });

            if (sourceResponse.ok && sourceResponse.body) {
              // Read the response body as a stream
              const sourceStream = sourceResponse.body;
              const chunks: Uint8Array[] = [];
              const reader = sourceStream.getReader();
              let totalSize = 0;

              // Read all chunks
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                  chunks.push(value);
                  totalSize += value.length;
                }
              }

              // Combine chunks into a single Uint8Array
              const combined = new Uint8Array(totalSize);
              let offset = 0;
              for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
              }

              // Store in storage (synchronous)
              const arrayBuffer = combined.buffer.slice(
                combined.byteOffset,
                combined.byteOffset + combined.byteLength
              );
              try {
                await storage.put(storageKey, arrayBuffer);
                const logger = getLogger();
                logger.info('Successfully stored Packagist artifact in storage', { storageKey, size: totalSize, packageName, version });

                // Proactively extract and store README in background
                c.executionCtx.waitUntil(
                  extractAndStoreReadme(
                    storage,
                    combined,
                    'public',
                    'packagist',
                    packageName,
                    version
                  )
                );
              } catch (err) {
                const logger = getLogger();
                logger.error('Error storing Packagist artifact in storage', { storageKey, size: totalSize, packageName, version }, err instanceof Error ? err : new Error(String(err)));
                // Don't fail the download if storage fails - still return the file to user
              }

              // Create or update artifact record
              const now = Math.floor(Date.now() / 1000);
              if (artifact) {
                // Update existing artifact record
                c.executionCtx.waitUntil(
                  db
                    .update(artifacts)
                    .set({
                      size: totalSize,
                      created_at: now,
                    })
                    .where(eq(artifacts.id, artifact.id))
                    .catch((err: unknown) => {
                      const logger = getLogger();
                      logger.error('Error updating Packagist artifact record', { artifactId: artifact?.id, packageName, version }, err instanceof Error ? err : new Error(String(err)));
                    })
                );
              } else {
                // Create new artifact record
                const artifactId = nanoid();
                c.executionCtx.waitUntil(
                  db
                    .insert(artifacts)
                    .values({
                      id: artifactId,
                      repo_id: 'packagist',
                      package_name: packageName,
                      version: version,
                      file_key: storageKey,
                      size: totalSize,
                      download_count: 0,
                      created_at: now,
                    })
                    .catch((err: unknown) => {
                      const logger = getLogger();
                      logger.error('Error creating Packagist artifact record', { artifactId, packageName, version }, err instanceof Error ? err : new Error(String(err)));
                    })
                );
                // Set artifact for download count update
                artifact = {
                  id: artifactId,
                  repo_id: 'packagist',
                  package_name: packageName,
                  version: version,
                  file_key: storageKey,
                  size: totalSize,
                  download_count: 0,
                  created_at: now,
                  last_downloaded_at: null,
                };
              }

              // Create stream from combined data
              stream = new Response(combined).body;
            }
          }
        }
      } catch (error) {
        const logger = getLogger();
        logger.error('Error proxying Packagist artifact', { packageName, version }, error instanceof Error ? error : new Error(String(error)));
      }

      // If Packagist fetch failed or version not found, try local DB fallback
      if (!stream) {
        // Fallback: Check if we have the package in our local DB
        // This handles cases where metadata is cached in KV/DB (so composer found it)
        // but upstream Packagist no longer lists it (so dist fetch failed)
        try {
          // Normalize version for DB lookup (remove trailing .0 if present)
          const shortVersion = version.replace(/\.0$/, '');

          let [pkg] = await db
            .select()
            .from(packages)
            .where(
              and(
                eq(packages.repo_id, 'packagist'),
                eq(packages.name, packageName),
                or(
                  eq(packages.version, version),
                  eq(packages.version, shortVersion)
                )
              )
            )
            .limit(1);

          // Handle 3.999... -> 3.x-dev normalization for DB lookup
          if (!pkg && version.includes('9999999') && version.endsWith('-dev')) {
            const devMatch = version.match(/^(\d+)\.9999999\.9999999\.9999999-dev$/);
            if (devMatch) {
              const xDevVersion = `${devMatch[1]}.x-dev`;
              [pkg] = await db
                .select()
                .from(packages)
                .where(
                  and(
                    eq(packages.repo_id, 'packagist'),
                    eq(packages.name, packageName),
                    eq(packages.version, xDevVersion)
                  )
                )
                .limit(1);
            }
          }

          if (pkg?.source_dist_url) {
            const logger = getLogger();
            logger.info('Found package in local DB fallback', { packageName, version, sourceDistUrl: pkg.source_dist_url });

            // Download from source
            const sourceResponse = await fetch(pkg.source_dist_url, {
              headers: {
                'User-Agent': COMPOSER_USER_AGENT,
              },
            });

            if (sourceResponse.ok && sourceResponse.body) {
              // Read the response body as a stream
              const sourceStream = sourceResponse.body;
              const chunks: Uint8Array[] = [];
              const reader = sourceStream.getReader();
              let totalSize = 0;

              // Read all chunks
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                  chunks.push(value);
                  totalSize += value.length;
                }
              }

              // Combine chunks into a single Uint8Array
              const combined = new Uint8Array(totalSize);
              let offset = 0;
              for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
              }

              // Store in storage (synchronous)
              const arrayBuffer = combined.buffer.slice(
                combined.byteOffset,
                combined.byteOffset + combined.byteLength
              );
              try {
                await storage.put(storageKey, arrayBuffer);
                // Proactively extract and store README
                c.executionCtx.waitUntil(
                  extractAndStoreReadme(
                    storage,
                    combined,
                    'public',
                    'packagist',
                    packageName,
                    version
                  )
                );
              } catch (err) {
                logger.error('Error storing artifact from DB fallback', { packageName, version }, err instanceof Error ? err : new Error(String(err)));
              }

              // Create stream from combined data
              stream = new Response(combined).body;

              // Create or update artifact record
              const now = Math.floor(Date.now() / 1000);
              const artifactId = artifact?.id || nanoid();

              const artifactData = {
                id: artifactId,
                repo_id: 'packagist',
                package_name: packageName,
                version: version,
                file_key: storageKey,
                size: totalSize,
                created_at: now,
                download_count: (artifact?.download_count || 0),
                last_downloaded_at: artifact?.last_downloaded_at || null
              };

              if (artifact) {
                c.executionCtx.waitUntil(
                  db.update(artifacts)
                    .set({ size: totalSize, created_at: now })
                    .where(eq(artifacts.id, artifact.id))
                    .catch(() => { })
                );
              } else {
                c.executionCtx.waitUntil(
                  db.insert(artifacts)
                    .values({ ...artifactData, download_count: 0 })
                    .onConflictDoNothing()
                    .catch(() => { })
                );
                // Update local artifact var so download count tracking works
                artifact = artifactData;
              }
            }
          }
        } catch (e) {
          const logger = getLogger();
          logger.error('Error in DB fallback check', { packageName, version }, e instanceof Error ? e : new Error(String(e)));
        }
      }

      // If we get here, Packagist fetch failed AND DB fallback failed
      if (!stream) {
        return c.json({
          error: 'Not Found',
          message: 'Package not found on Packagist'
        }, 404);
      }
    }

    // Update download count (non-blocking) - only if artifact exists
    if (artifact) {
      const updateDownloadCount = async () => {
        if (c.env.QUEUE && typeof c.env.QUEUE.send === 'function') {
          // Use Queue for async processing (Paid plan)
          await c.env.QUEUE.send({
            type: 'update_artifact_download',
            artifactId: artifact!.id,
            timestamp: Math.floor(Date.now() / 1000),
          });
        } else {
          // Fallback: update directly in database (Free tier)
          await db
            .update(artifacts)
            .set({
              download_count: (artifact!.download_count || 0) + 1,
              last_downloaded_at: Math.floor(Date.now() / 1000),
            })
            .where(eq(artifacts.id, artifact!.id));
        }
      };

      // Run in background to not block the response
      c.executionCtx.waitUntil(updateDownloadCount());
    }

    // Build response headers
    const headers = new Headers();
    headers.set('Content-Type', 'application/zip');
    // Format filename as vendor--module-name--version.zip (replace / with --)
    const filename = `${packageName.replace('/', '--')}--${version}.zip`;
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);

    if (artifact?.size) {
      headers.set('Content-Length', String(artifact.size));
    }

    if (artifact?.created_at) {
      headers.set('Last-Modified', new Date(artifact.created_at * 1000).toUTCString());
    }

    // Cache immutable artifacts
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    // Track package download analytics
    const analytics = getAnalytics();
    const requestId = c.get('requestId') as string | undefined;
    analytics.trackPackageDownload({
      requestId,
      packageName,
      version,
      repoId: 'packagist',
      size: artifact?.size ?? undefined,
      cacheHit: !!stream, // Stream exists means it was cached
    });

    return new Response(stream, {
      status: 200,
      headers,
    });
  }

  // For private repositories, use private storage key
  const storageKey = buildStorageKey('private', repoId, packageName, version);

  // Look up artifact in database
  let artifact: (typeof artifacts.$inferSelect) | undefined = (
    await db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.repo_id, repoId),
          eq(artifacts.package_name, packageName),
          eq(artifacts.version, version)
        )
      )
      .limit(1)
  )[0];

  // Look up package to get source_dist_url (needed for on-demand mirroring)
  let [pkg] = await db
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.repo_id, repoId),
        eq(packages.name, packageName),
        eq(packages.version, version)
      )
    )
    .limit(1);

  // If not found with specific repo_id, try to find it with any repo_id
  // This handles cases where package was stored but repo_id doesn't match
  if (!pkg) {
    const [pkgAnyRepo] = await db
      .select()
      .from(packages)
      .where(
        and(
          eq(packages.name, packageName),
          eq(packages.version, version)
        )
      )
      .limit(1);

    if (pkgAnyRepo) {
      const logger = getLogger();
      logger.warn('Package found but with different repo_id', { packageName, version, foundRepoId: pkgAnyRepo.repo_id, expectedRepoId: repoId });
      pkg = pkgAnyRepo;
    }
  }

  if (!pkg) {
    // Package not found in database - try to fetch from repository directly
    // This handles race conditions where metadata wasn't stored yet
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);

    if (repo && repo.vcs_type === 'composer') {
      try {
        // Try to fetch package metadata from upstream and get source_dist_url
        const { fetchPackageFromUpstream } = await import('../utils/upstream-fetch.js');
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

        // p2 format returns packages[name] as an array, need to find matching version
        const packageVersions = packageData?.packages?.[packageName];
        let packageVersion: any = null;
        
        if (Array.isArray(packageVersions)) {
          // Composer 2 p2 format: array of versions
          // Also try denormalized versions for matching
          const possibleVersions = denormalizeVersion(version);
          packageVersion = packageVersions.find((v: any) => 
            possibleVersions.includes(v.version) || 
            possibleVersions.includes(v.version_normalized)
          );
        } else if (packageVersions && typeof packageVersions === 'object') {
          // Composer 1 format: object keyed by version
          const possibleVersions = denormalizeVersion(version);
          for (const v of possibleVersions) {
            if (packageVersions[v]) {
              packageVersion = packageVersions[v];
              break;
            }
          }
        }
        
        if (packageVersion?.dist?.url) {
          const sourceDistUrl = packageVersion.dist.url;

          // Download from source and stream to client
          const credentialsJson = await decryptCredentials(repo.auth_credentials, c.env.ENCRYPTION_KEY);
          const credentials = JSON.parse(credentialsJson);

          const sourceResponse = await downloadFromSource(
            sourceDistUrl,
            repo.credential_type as any,
            credentials
          );

          if (sourceResponse.ok && sourceResponse.body) {
            const headers = new Headers();
            headers.set('Content-Type', 'application/zip');
            headers.set('Cache-Control', 'public, max-age=3600');

            return new Response(sourceResponse.body, {
              status: 200,
              headers,
            });
          }
        }
      } catch (error) {
        const logger = getLogger();
        logger.error('Error fetching package from upstream', { packageName, version, repoId }, error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Package not found in database and couldn't fetch from upstream
    const logger = getLogger();
    logger.warn('Package not found in DB for repo', { packageName, version, repoId, note: 'This may indicate a race condition or missing package metadata' });
    return c.json({
      error: 'Not Found',
      message: 'Package not found. The package metadata may not be available yet. Try refreshing package metadata.'
    }, 404);
  }

  // Check conditional request (If-Modified-Since) if artifact exists
  if (artifact) {
    const ifModifiedSince = c.req.header('If-Modified-Since');
    if (ifModifiedSince && artifact.created_at) {
      const clientDate = new Date(ifModifiedSince).getTime();
      const artifactDate = artifact.created_at * 1000;

      if (clientDate >= artifactDate) {
        return new Response(null, { status: 304 });
      }
    }
  }

  // Get artifact from storage
  let stream = await storage.get(storageKey);

  // If artifact not in storage, try on-demand mirroring
  if (!stream) {
    // Validate source_dist_url exists and is a valid URL
    if (!pkg.source_dist_url) {
      const logger = getLogger();
      logger.error('Package found but source_dist_url is missing', { packageName, version, repoId });
      return c.json({ error: 'Not Found', message: 'Artifact file not found and source URL unavailable. Please re-sync the repository.' }, 404);
    }

    // Validate it's actually a URL (not a placeholder or column name)
    if (!pkg.source_dist_url.startsWith('http://') && !pkg.source_dist_url.startsWith('https://')) {
      const logger = getLogger();
      logger.error('Package has invalid source_dist_url', { packageName, version, repoId, sourceDistUrl: pkg.source_dist_url });
      return c.json({ error: 'Not Found', message: 'Invalid source URL. Please re-sync the repository to update package metadata.' }, 404);
    }

    // Get repository for credentials
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);

    if (!repo) {
      return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
    }

    try {
      // Decrypt credentials
      const credentialsJson = await decryptCredentials(repo.auth_credentials, c.env.ENCRYPTION_KEY);
      const credentials = JSON.parse(credentialsJson);

      // Download from source with authentication
      const sourceResponse = await downloadFromSource(
        pkg.source_dist_url,
        repo.credential_type as any,
        credentials
      );

      // Read the response body as a stream
      const sourceStream = sourceResponse.body;
      if (!sourceStream) {
        throw new Error('Source response has no body');
      }

      // Store in R2 storage (non-blocking for response, but we need to wait for it)
      // We'll stream to user while storing in background
      const chunks: Uint8Array[] = [];
      const reader = sourceStream.getReader();
      let totalSize = 0;

      // Read all chunks (we need to buffer for storage anyway)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalSize += value.length;
        }
      }

      // Combine chunks
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Create stream for response
      stream = new Response(combined).body;

      // Store in storage (background)
      c.executionCtx.waitUntil(
        (async () => {
          try {
            // Store artifact
            // Convert to ArrayBuffer
            const arrayBuffer = combined.buffer.slice(
              combined.byteOffset,
              combined.byteOffset + combined.byteLength
            );

            await storage.put(storageKey, arrayBuffer);
            const logger = getLogger();
            logger.info('Successfully stored artifact on-demand', { storageKey, size: totalSize });

            // Create or update artifact record
            const now = Math.floor(Date.now() / 1000);
            if (artifact) {
              await db
                .update(artifacts)
                .set({
                  size: totalSize,
                  created_at: now,
                })
                .where(eq(artifacts.id, artifact.id));
            } else {
              const artifactId = nanoid();
              await db.insert(artifacts).values({
                id: artifactId,
                repo_id: repoId,
                package_name: packageName,
                version: version,
                file_key: storageKey,
                size: totalSize,
                download_count: 0,
                created_at: now,
              }).onConflictDoNothing();
              // Update local artifact for download count
              artifact = {
                id: artifactId,
                repo_id: repoId,
                package_name: packageName,
                version: version,
                file_key: storageKey,
                size: totalSize,
                download_count: 0,
                created_at: now,
                last_downloaded_at: null,
              };
            }

            // Proactively extract and store README
            await extractAndStoreReadme(
              storage,
              combined,
              'private',
              repoId,
              packageName,
              version
            );

          } catch (error) {
            const logger = getLogger();
            logger.error('Error storing artifact on-demand', { storageKey }, error instanceof Error ? error : new Error(String(error)));
          }
        })()
      );

    } catch (error) {
      const logger = getLogger();
      logger.error('Error downloading artifact from source', { sourceDistUrl: pkg.source_dist_url }, error instanceof Error ? error : new Error(String(error)));
      return c.json({
        error: 'Bad Gateway',
        message: 'Failed to download package from source. The source URL may be invalid or accessible.'
      }, 502);
    }
  }

  // Update download count (non-blocking)
  if (artifact) {
    c.executionCtx.waitUntil(
      (async () => {
        if (c.env.QUEUE && typeof c.env.QUEUE.send === 'function') {
          await c.env.QUEUE.send({
            type: 'update_artifact_download',
            artifactId: artifact!.id,
            timestamp: Math.floor(Date.now() / 1000),
          });
        } else {
          await db
            .update(artifacts)
            .set({
              download_count: (artifact!.download_count || 0) + 1,
              last_downloaded_at: Math.floor(Date.now() / 1000),
            })
            .where(eq(artifacts.id, artifact!.id));
        }
      })()
    );
  }

  // Build response
  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  const filename = `${packageName.replace('/', '--')}--${version}.zip`;
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);

  if (artifact?.size) {
    headers.set('Content-Length', String(artifact.size));
  }

  if (artifact?.created_at) {
    headers.set('Last-Modified', new Date(artifact.created_at * 1000).toUTCString());
  }

  // Cache settings
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  // Track package download analytics
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  analytics.trackPackageDownload({
    requestId,
    packageName,
    version,
    repoId,
    size: artifact?.size ?? undefined,
    cacheHit: !!stream,
  });

  return new Response(stream, {
    status: 200,
    headers,
  });
}
// Aliases for specific route patterns handled by the same function
export const distMirrorRoute = distRoute;
export const distLockfileRoute = distRoute;
