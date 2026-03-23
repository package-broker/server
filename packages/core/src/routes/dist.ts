/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Dist route - serve cached artifacts

import type { Context } from 'hono';
import type { DatabasePort } from '../ports';
import { artifacts, packages, repositories } from '../db/schema';
import { and, eq, or } from 'drizzle-orm';
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
import { lazyLoadPackageFromRepositories, normalizePackageVersions, storePackageInDB, deriveVersionNormalized } from './composer';
import { computeShasum } from '../utils/checksum';

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
 * Get Content-Type header based on dist.type from package metadata
 */
function getContentTypeForDistType(distType: string | null | undefined): string {
  if (!distType) {
    return 'application/zip'; // Default fallback
  }
  
  const type = distType.toLowerCase();
  
  // Map common dist types to Content-Type headers
  if (type === 'zip') {
    return 'application/zip';
  }
  if (type === 'tar') {
    return 'application/x-tar';
  }
  if (type === 'tar.gz' || type === 'tgz') {
    return 'application/gzip';
  }
  if (type === 'tar.bz2') {
    return 'application/x-bzip2';
  }
  
  // Default fallback
  return 'application/octet-stream';
}

/**
 * Get file extension for Content-Disposition header based on dist.type
 */
function getFileExtensionForDistType(distType: string | null | undefined): string {
  if (!distType) {
    return 'zip'; // Default fallback
  }
  
  const type = distType.toLowerCase();
  
  // Map dist types to file extensions
  if (type === 'zip') {
    return 'zip';
  }
  if (type === 'tar') {
    return 'tar';
  }
  if (type === 'tar.gz' || type === 'tgz') {
    return 'tar.gz';
  }
  if (type === 'tar.bz2') {
    return 'tar.bz2';
  }
  
  // Default fallback
  return 'zip';
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

export function findVersionInMetadata(
  versionFromUrl: string,
  displayVersion: string,
  normalizedVersions: Array<{ version: string; metadata: any }>
): { version: string; metadata: any } | null {
  for (const { version: metadataVersion, metadata } of normalizedVersions) {
    if (versionFromUrl === metadataVersion) {
      return { version: metadataVersion, metadata };
    }

    if (displayVersion === metadataVersion) {
      return { version: metadataVersion, metadata };
    }

    const metadataNormalized = metadata.version_normalized;
    if (metadataNormalized && versionFromUrl === metadataNormalized) {
      return { version: metadataVersion, metadata };
    }

    const derivedNormalized = deriveVersionNormalized(metadataVersion);
    if (derivedNormalized && versionFromUrl === derivedNormalized) {
      return { version: metadataVersion, metadata };
    }

    const metadataVersionNoV = metadataVersion.startsWith('v') ? metadataVersion.slice(1) : metadataVersion;
    if (displayVersion === metadataVersionNoV) {
      return { version: metadataVersion, metadata };
    }

    const versionFromUrlNoV = versionFromUrl.startsWith('v') ? versionFromUrl.slice(1) : versionFromUrl;
    const metadataVersionNoVNormalized = deriveVersionNormalized(metadataVersionNoV);
    if (metadataVersionNoVNormalized && versionFromUrlNoV === metadataVersionNoVNormalized) {
      return { version: metadataVersion, metadata };
    }

    if (derivedNormalized && displayVersion === derivedNormalized) {
      return { version: metadataVersion, metadata };
    }

    const displayVersionNormalized = deriveVersionNormalized(displayVersion);
    if (displayVersionNormalized && metadataNormalized && displayVersionNormalized === metadataNormalized) {
      return { version: metadataVersion, metadata };
    }
  }

  return null;
}

/**
 * Extract version from URL parameter by removing archive extensions
 * Handles: .zip, .tar, .tar.gz, .tar.bz2
 */
function extractVersionFromParam(versionParam: string | undefined): string {
  if (!versionParam) return '';
  
  return versionParam
    .replace(/\.tar\.bz2$/, '')
    .replace(/\.tar\.gz$/, '')
    .replace(/\.tar$/, '')
    .replace(/\.zip$/, '');
}

export function normalizeVersionToDisplay(version: string): string {
  const patchMatch = version.match(/^(\d+\.\d+\.\d+)\.0-patch(\d+)$/);
  if (patchMatch) {
    const [, base, patch] = patchMatch;
    return `${base}-p${patch}`;
  }

  if (version.match(/^\d+\.\d+\.\d+\.0$/)) {
    return version.slice(0, -2);
  }

  const suffixMatch = version.match(/^(\d+\.\d+\.\d+)\.0(-.+)$/);
  if (suffixMatch) {
    const [, base, suffix] = suffixMatch;
    return `${base}${suffix}`;
  }

  return version;
}

/**
 * GET /dist/:repo_id/:vendor/:package/:version.zip
 * OR
 * GET /dist/:vendor/:package/:version/r:reference.zip (mirror URL format)
 * Serve cached artifact with streaming, Last-Modified headers, and conditional requests
 */
export async function distRoute(c: Context<DistRouteEnv>): Promise<Response> {
  let repoId = c.req.param('repo_id');
  let vendor = c.req.param('vendor');
  let pkgParam = c.req.param('package');
  let packageName: string;
  let version = extractVersionFromParam(c.req.param('version'));

  const db = c.get('database');

  if (!repoId && !vendor && pkgParam) {
    const fullPackageName = pkgParam;
    const displayVersion = normalizeVersionToDisplay(version);
    
    let [pkg] = await db
      .select({ repo_id: packages.repo_id, version: packages.version })
      .from(packages)
      .where(and(eq(packages.name, fullPackageName), eq(packages.version, version)))
      .limit(1);

    if (!pkg && displayVersion !== version) {
      [pkg] = await db
        .select({ repo_id: packages.repo_id, version: packages.version })
        .from(packages)
      .where(and(eq(packages.name, fullPackageName), eq(packages.version, displayVersion)))
      .limit(1);
      
      if (pkg) {
        version = pkg.version;
      }
    }

    if (pkg) {
      repoId = pkg.repo_id;
      packageName = fullPackageName;
      const parts = fullPackageName.split('/');
      if (parts.length === 2) {
        vendor = parts[0];
        pkgParam = parts[1];
      } else {
        return c.json({ error: 'Bad Request', message: 'Invalid package name format' }, 400);
      }
    } else {
      const url = new URL(c.req.url);
      const baseUrl = `${url.protocol}//${url.host}`;
      
      const lazyLoadResult = await lazyLoadPackageFromRepositories(
        db,
        fullPackageName,
        c.env.ENCRYPTION_KEY,
        c.env.KV
      );

      if (lazyLoadResult) {
        const { packageData, repoId: foundRepoId } = lazyLoadResult;
        const versions = packageData.packages?.[fullPackageName];
        const normalizedVersions = normalizePackageVersions(versions);
        const versionData = findVersionInMetadata(version, displayVersion, normalizedVersions);

        if (versionData) {
          const distType = versionData.metadata.dist?.type || 'zip';
          const fileExt = getFileExtensionForDistType(distType);
          const proxyDistUrl = `${baseUrl}/dist/${foundRepoId}/${fullPackageName}/${versionData.version}.${fileExt}`;
          const sourceDistUrl = versionData.metadata.dist?.url || null;
          
          await storePackageInDB(
            db,
            fullPackageName,
            versionData.version,
            versionData.metadata,
            foundRepoId,
            proxyDistUrl,
            sourceDistUrl
          );
          
          repoId = foundRepoId;
          packageName = fullPackageName;
          version = versionData.version;
          
          const parts = fullPackageName.split('/');
          if (parts.length === 2) {
            vendor = parts[0];
            pkgParam = parts[1];
          } else {
            return c.json({ error: 'Bad Request', message: 'Invalid package name format' }, 400);
          }
        } else {
          return c.json({ error: 'Not Found', message: 'Version not found in repository' }, 404);
        }
      } else {
        return c.json({ error: 'Not Found', message: 'Package not found in any repository' }, 404);
      }
    }
  } else if (!repoId && vendor && pkgParam) {
    packageName = `${vendor}/${pkgParam}`;
    const displayVersion = normalizeVersionToDisplay(version);
    let [pkg] = await db
      .select({ repo_id: packages.repo_id, version: packages.version })
      .from(packages)
      .where(and(eq(packages.name, packageName), eq(packages.version, version)))
      .limit(1);

    if (!pkg && displayVersion !== version) {
      [pkg] = await db
        .select({ repo_id: packages.repo_id, version: packages.version })
        .from(packages)
      .where(and(eq(packages.name, packageName), eq(packages.version, displayVersion)))
      .limit(1);
      
      if (pkg) {
        version = pkg.version;
      }
    }

    if (pkg) {
      repoId = pkg.repo_id;
    } else {
      const url = new URL(c.req.url);
      const baseUrl = `${url.protocol}//${url.host}`;
      
      const lazyLoadResult = await lazyLoadPackageFromRepositories(
        db,
        packageName,
        c.env.ENCRYPTION_KEY,
        c.env.KV
      );

      if (lazyLoadResult) {
        const { packageData, repoId: foundRepoId } = lazyLoadResult;
        const versions = packageData.packages?.[packageName];
        const normalizedVersions = normalizePackageVersions(versions);
        const versionData = findVersionInMetadata(version, displayVersion, normalizedVersions);

        if (versionData) {
          const distType = versionData.metadata.dist?.type || 'zip';
          const fileExt = getFileExtensionForDistType(distType);
          const proxyDistUrl = `${baseUrl}/dist/${foundRepoId}/${packageName}/${versionData.version}.${fileExt}`;
          const sourceDistUrl = versionData.metadata.dist?.url || null;
          
          await storePackageInDB(
            db,
            packageName,
            versionData.version,
            versionData.metadata,
            foundRepoId,
            proxyDistUrl,
            sourceDistUrl
          );
          
          repoId = foundRepoId;
          version = versionData.version;
        } else {
          return c.json({ error: 'Not Found', message: 'Version not found in repository' }, 404);
        }
      } else {
        return c.json({ error: 'Not Found', message: 'Package not found in any repository' }, 404);
      }
    }
  } else {
    // Standard format: /dist/:repo_id/:vendor/:package/:version
    packageName = `${vendor}/${pkgParam}`;
  }

  if (!repoId || !packageName || !version) {
    return c.json({ error: 'Bad Request', message: 'Missing required parameters' }, 400);
  }

  const storage = c.var.storage;

  if (repoId === 'packagist') {
    const storageKey = buildStorageKey('public', 'packagist', packageName, version);

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

    let stream = await storage.get(storageKey);

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

              const combined = new Uint8Array(totalSize);
              let offset = 0;
              for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
              }

              let computedShasum: string | undefined;
              if (!versionData.dist?.shasum) {
                computedShasum = computeShasum(combined);
              }

              const arrayBuffer = combined.buffer.slice(
                combined.byteOffset,
                combined.byteOffset + combined.byteLength
              );
              try {
                await storage.put(storageKey, arrayBuffer);
                const logger = getLogger();
                logger.info('Successfully stored Packagist artifact in storage', { storageKey, size: totalSize, packageName, version });

                if (computedShasum) {
                  c.executionCtx.waitUntil(
                    (async () => {
                      try {
                        const [pkg] = await db
                          .select({ metadata: packages.metadata })
                          .from(packages)
                          .where(
                            and(
                              eq(packages.repo_id, 'packagist'),
                              eq(packages.name, packageName),
                              eq(packages.version, version)
                            )
                          )
                          .limit(1);

                        if (pkg?.metadata) {
                          try {
                            const metadata = JSON.parse(pkg.metadata);
                            if (!metadata.dist?.shasum) {
                              if (!metadata.dist) {
                                metadata.dist = {};
                              }
                              metadata.dist.shasum = computedShasum;
                              
                              await db
                                .update(packages)
                                .set({ metadata: JSON.stringify(metadata) })
                                .where(
                                  and(
                                    eq(packages.repo_id, 'packagist'),
                                    eq(packages.name, packageName),
                                    eq(packages.version, version)
                                  )
                                );
                            }
                          } catch {
                            // Ignore metadata update errors in background task
                          }
                        }
                      } catch {
                        // Ignore background task errors
                      }
                    })()
                  );
                }

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

      if (!stream) {
        try {
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

              const combined = new Uint8Array(totalSize);
              let offset = 0;
              for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
              }

              let computedShasum: string | undefined;
              if (pkg?.metadata) {
                try {
                  const metadata = JSON.parse(pkg.metadata);
                  if (!metadata.dist?.shasum) {
                    computedShasum = computeShasum(combined);
                  }
                } catch {
                  // If metadata parsing fails, compute shasum anyway
                  computedShasum = computeShasum(combined);
                }
              } else {
                computedShasum = computeShasum(combined);
              }

              const arrayBuffer = combined.buffer.slice(
                combined.byteOffset,
                combined.byteOffset + combined.byteLength
              );
              try {
                await storage.put(storageKey, arrayBuffer);
                
                if (computedShasum && pkg) {
                  c.executionCtx.waitUntil(
                    (async () => {
                      try {
                        const metadata = pkg.metadata ? JSON.parse(pkg.metadata) : {};
                        if (!metadata.dist?.shasum) {
                          if (!metadata.dist) {
                            metadata.dist = {};
                          }
                          metadata.dist.shasum = computedShasum;
                          
                          await db
                            .update(packages)
                            .set({ metadata: JSON.stringify(metadata) })
                            .where(
                              and(
                                eq(packages.repo_id, 'packagist'),
                                eq(packages.name, packageName),
                                eq(packages.version, version)
                              )
                            );
                        }
                      } catch {
                        // Ignore metadata update errors in background task
                      }
                    })()
                  );
                }
                
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

    // Get dist.type from package metadata to determine Content-Type
    let distType: string | null = null;
    if (artifact) {
      // Try to get dist.type from stored package metadata
      const [pkgForType] = await db
        .select({ metadata: packages.metadata })
        .from(packages)
        .where(
          and(
            eq(packages.repo_id, 'packagist'),
            eq(packages.name, packageName),
            eq(packages.version, version)
          )
        )
        .limit(1);
      
      if (pkgForType?.metadata) {
        try {
          const metadata = JSON.parse(pkgForType.metadata);
          distType = metadata.dist?.type || null;
        } catch {
          // Ignore parse errors
        }
      }
    }
    
    // Build response headers
    const headers = new Headers();
    const contentType = getContentTypeForDistType(distType);
    const fileExt = getFileExtensionForDistType(distType);
    headers.set('Content-Type', contentType);
    // Format filename as vendor--module-name--version.{ext} (replace / with --)
    const filename = `${packageName.replace('/', '--')}--${version}.${fileExt}`;
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
    // This handles race conditions where metadata wasn't stored yet
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);

    if (repo && repo.vcs_type === 'composer') {
      try {
        // Try to fetch package metadata from upstream and get source_dist_url
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

        const packageVersion = packageData?.packages?.[packageName]?.[version];
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
            const distType = packageVersion.dist?.type || null;
            const headers = new Headers();
            headers.set('Content-Type', getContentTypeForDistType(distType));
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

    const logger = getLogger();
    logger.warn('Package not found in DB for repo', { packageName, version, repoId, note: 'This may indicate a race condition or missing package metadata' });
    return c.json({
      error: 'Not Found',
      message: 'Package not found. The package metadata may not be available yet. Try refreshing package metadata.'
    }, 404);
  }

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

  let stream = await storage.get(storageKey);

  if (!stream) {
    if (!pkg.source_dist_url) {
      const logger = getLogger();
      logger.error('Package found but source_dist_url is missing', { packageName, version, repoId });
      return c.json({ error: 'Not Found', message: 'Artifact file not found and source URL unavailable. Please re-sync the repository.' }, 404);
    }

    if (!pkg.source_dist_url.startsWith('http://') && !pkg.source_dist_url.startsWith('https://')) {
      const logger = getLogger();
      logger.error('Package has invalid source_dist_url', { packageName, version, repoId, sourceDistUrl: pkg.source_dist_url });
      return c.json({ error: 'Not Found', message: 'Invalid source URL. Please re-sync the repository to update package metadata.' }, 404);
    }

    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);

    if (!repo) {
      return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
    }

    try {
      const credentialsJson = await decryptCredentials(repo.auth_credentials, c.env.ENCRYPTION_KEY);
      const credentials = JSON.parse(credentialsJson);

      const sourceResponse = await downloadFromSource(
        pkg.source_dist_url,
        repo.credential_type as any,
        credentials
      );

      const sourceStream = sourceResponse.body;
      if (!sourceStream) {
        throw new Error('Source response has no body');
      }

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

      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      stream = new Response(combined).body;

      let computedShasum: string | undefined;
      if (pkg?.metadata) {
        try {
          const metadata = JSON.parse(pkg.metadata);
          if (!metadata.dist?.shasum) {
            computedShasum = computeShasum(combined);
          }
        } catch {
          // If metadata parsing fails, compute shasum anyway
          computedShasum = computeShasum(combined);
        }
      } else {
        computedShasum = computeShasum(combined);
      }

      c.executionCtx.waitUntil(
        (async () => {
          try {
            const arrayBuffer = combined.buffer.slice(
              combined.byteOffset,
              combined.byteOffset + combined.byteLength
            );

            await storage.put(storageKey, arrayBuffer);
            const logger = getLogger();
            logger.info('Successfully stored artifact on-demand', { storageKey, size: totalSize });

            if (computedShasum && pkg) {
              try {
                const metadata = pkg.metadata ? JSON.parse(pkg.metadata) : {};
                if (!metadata.dist?.shasum) {
                  if (!metadata.dist) {
                    metadata.dist = {};
                  }
                  metadata.dist.shasum = computedShasum;
                  
                  await db
                    .update(packages)
                    .set({ metadata: JSON.stringify(metadata) })
                    .where(
                      and(
                        eq(packages.repo_id, repoId),
                        eq(packages.name, packageName),
                        eq(packages.version, version)
                      )
                    );
                }
              } catch {
                // Ignore metadata update errors in background task
              }
            }

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

  let distType: string | null = null;
  if (pkg?.metadata) {
    try {
      const metadata = JSON.parse(pkg.metadata);
      distType = metadata.dist?.type || null;
    } catch {
      // Ignore invalid JSON; fallback to null distType
    }
  }
  
  const headers = new Headers();
  const contentType = getContentTypeForDistType(distType);
  const fileExt = getFileExtensionForDistType(distType);
  headers.set('Content-Type', contentType);
  const filename = `${packageName.replace('/', '--')}--${version}.${fileExt}`;
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);

  if (artifact?.size) {
    headers.set('Content-Length', String(artifact.size));
  }

  if (artifact?.created_at) {
    headers.set('Last-Modified', new Date(artifact.created_at * 1000).toUTCString());
  }

  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

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

export const distMirrorRoute = distRoute;
export const distLockfileRoute = distRoute;
