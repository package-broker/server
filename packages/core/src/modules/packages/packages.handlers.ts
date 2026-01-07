// Packages API routes

import type { Context } from 'hono';
import type { OpenAPIContext } from '../../routes/api/types';
import type { DatabasePort, CachePort } from '../../ports';
import { packages, artifacts, repositories } from '../../db/schema';
import { eq, like, and, sql, count, countDistinct, inArray } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import type { StorageDriver } from '../../storage/driver';
import { buildStorageKey, buildReadmeStorageKey, buildChangelogStorageKey } from '../../storage/driver';
import { downloadFromSource } from '../../utils/download';
import { decryptCredentials } from '../../utils/encryption';
import { nanoid } from 'nanoid';
import { COMPOSER_USER_AGENT } from '@package-broker/shared';
import { isPackagistMirroringEnabled } from '../admin';
import { getLogger } from '../../utils/logger';
import { fetchPackageFromUpstream, type UpstreamRepository } from '../../utils/upstream-fetch.js';

export interface PackagesRouteEnv {
  Bindings: {
    DB: D1Database;
    KV: KVNamespace;
    ENCRYPTION_KEY: string;
  };
  Variables: {
    database: DatabasePort;
    storage: StorageDriver;
    cache?: CachePort;
  };
}

/**
 * GET /api/packages
 * List all packages with optional search and pagination
 * Paginates by unique package names (not individual versions)
 */
export async function listPackages(c: OpenAPIContext<PackagesRouteEnv, any, any, { search?: string; page?: number; limit?: number }>): Promise<Response> {
  const db = c.get('database');
  const query = c.req.valid('query');
  const search = query?.search;
  const page = query?.page ?? 1;
  const limit = query?.limit ?? 20;
  const offset = (page - 1) * limit;

  // Build where clause
  const whereClause = search ? like(packages.name, `%${search}%`) : undefined;

  // Get total count of UNIQUE package names
  const [countResult] = await db
    .select({ count: countDistinct(packages.name) })
    .from(packages)
    .where(whereClause);

  const total = countResult?.count ?? 0;
  const totalPages = Math.ceil(total / limit);

  // Get paginated UNIQUE package names
  let namesQuery = db
    .selectDistinct({ name: packages.name })
    .from(packages)
    .orderBy(packages.name)
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    namesQuery = namesQuery.where(whereClause) as typeof namesQuery;
  }

  const packageNames = await namesQuery;
  const names = packageNames.map((p: { name: string }) => p.name);

  // If no packages found, return empty result
  if (names.length === 0) {
    return c.json({
      data: [],
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  }

  // Fetch all versions for the paginated package names
  const data = await db
    .select()
    .from(packages)
    .where(inArray(packages.name, names))
    .orderBy(packages.name);

  return c.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  });
}

/**
 * GET /api/packages/:name
 * Get a single package with all versions
 */
export async function getPackage(c: OpenAPIContext<PackagesRouteEnv>): Promise<Response> {
  const { name: nameParam } = c.req.valid('param');
  // Decode URL-encoded package name (handles slashes like amasty/cron-schedule-list)
  const name = decodeURIComponent(nameParam);
  const db = c.get('database');

  const packageVersions = await db
    .select()
    .from(packages)
    .where(eq(packages.name, name))
    .orderBy(packages.released_at);

  if (packageVersions.length === 0) {
    return c.json({ error: 'Not Found', message: 'Package not found' }, 404);
  }

  return c.json({
    name,
    versions: packageVersions,
  });
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
    console.error('Error extracting README from ZIP:', error);
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
    console.error('Error extracting CHANGELOG from ZIP:', error);
    return null;
  }
}

/**
 * GET /api/packages/:name/:version/readme
 * Get README.md content for a specific package version
 * Uses R2/S3 storage instead of KV for better scalability
 */
export async function getPackageReadme(c: OpenAPIContext<PackagesRouteEnv>): Promise<Response> {
  const { name: nameParam, version } = c.req.valid('param');
  // Decode URL-encoded package name (handles slashes like amasty/cron-schedule-list)
  const name = decodeURIComponent(nameParam);

  if (!name || !version) {
    return c.json({ error: 'Bad Request', message: 'Missing package name or version' }, 400);
  }

  // 1. Get package from database to find repo_id
  const db = c.get('database');
  const [pkg] = await db
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.name, name),
        eq(packages.version, version)
      )
    )
    .limit(1);

  if (!pkg) {
    return c.json({ error: 'Not Found', message: 'Package version not found' }, 404);
  }

  // 2. Determine storage type (public for Packagist, private for others)
  const storageType = pkg.repo_id === 'packagist' ? 'public' : 'private';
  const readmeStorageKey = buildReadmeStorageKey(storageType, pkg.repo_id, name, version);
  const storage = c.var.storage;

  // 3. Check if README already exists in R2/S3 storage
  const existingReadme = await storage.get(readmeStorageKey);

  if (existingReadme) {
    // Read the stream to check if it's a "NOT_FOUND" marker
    const chunks: Uint8Array[] = [];
    const reader = existingReadme.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
      }
    }

    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const content = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.length;
    }

    const textContent = new TextDecoder().decode(content);

    // If it's a NOT_FOUND marker, return 404
    if (textContent === 'NOT_FOUND') {
      return c.json({
        error: 'Not Found',
        message: 'No README file exists in this package version'
      }, 404);
    }

    // Return cached README with aggressive CDN caching
    return new Response(textContent, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-README-Source': 'storage',
      },
    });
  }

  // 4. README not in storage - need to extract from ZIP
  // Get artifact to find ZIP storage key
  let [artifact] = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.repo_id, pkg.repo_id),
        eq(artifacts.package_name, name),
        eq(artifacts.version, version)
      )
    )
    .limit(1);

  let zipData: Uint8Array | null = null;

  // 5. If artifact doesn't exist, try on-demand download
  if (!artifact) {
    // Check if we can download from source
    if (!pkg.source_dist_url) {
      return c.json({ error: 'Not Found', message: 'Artifact not found and source URL unavailable. Package may need to be downloaded first.' }, 404);
    }

    // Validate it's actually a URL
    if (!pkg.source_dist_url.startsWith('http://') && !pkg.source_dist_url.startsWith('https://')) {
      return c.json({ error: 'Not Found', message: 'Invalid source URL. Please re-sync the repository to update package metadata.' }, 404);
    }

    // Get repository for credentials
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, pkg.repo_id))
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

      // Read the response body
      const sourceStream = sourceResponse.body;
      if (!sourceStream) {
        throw new Error('Source response has no body');
      }

      // Read all chunks into memory
      const chunks: Uint8Array[] = [];
      const reader = sourceStream.getReader();
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalSize += value.length;
        }
      }

      // Combine chunks into a single Uint8Array
      zipData = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        zipData.set(chunk, offset);
        offset += chunk.length;
      }

      // Store artifact in storage
      const storageType = pkg.repo_id === 'packagist' ? 'public' : 'private';
      const storageKey = buildStorageKey(storageType, pkg.repo_id, name, version);
      // Convert to ArrayBuffer (not SharedArrayBuffer) for storage
      const arrayBuffer = zipData.buffer.slice(
        zipData.byteOffset,
        zipData.byteOffset + zipData.byteLength
      ) as ArrayBuffer;

      try {
        await storage.put(storageKey, arrayBuffer);
        console.log(`Successfully stored artifact for README extraction: ${storageKey} (${totalSize} bytes)`);
      } catch (err) {
        console.error(`Error storing artifact ${storageKey}:`, err);
        // Continue - we can still extract README from zipData
      }

      // Create artifact record (ignore if already exists from concurrent request)
      const artifactId = nanoid();
      const now = Math.floor(Date.now() / 1000);
      try {
        await db.insert(artifacts).values({
          id: artifactId,
          repo_id: pkg.repo_id,
          package_name: name,
          version: version,
          file_key: storageKey,
          size: totalSize,
          download_count: 0,
          created_at: now,
        }).onConflictDoNothing();
        artifact = {
          id: artifactId,
          repo_id: pkg.repo_id,
          package_name: name,
          version: version,
          file_key: storageKey,
          size: totalSize,
          download_count: 0,
          created_at: now,
          last_downloaded_at: null,
        };
      } catch (err) {
        console.error(`Error creating artifact record:`, err);
        // Continue - we can still extract README from zipData
      }
    } catch (error) {
      console.error(`Error downloading artifact from source:`, error);
      return c.json(
        {
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to download artifact',
        },
        500
      );
    }
  }

  // 6. Get ZIP from storage if we don't already have it in memory
  if (!zipData) {
    if (!artifact) {
      return c.json({ error: 'Not Found', message: 'Artifact not found' }, 404);
    }

    const zipStream = await storage.get(artifact.file_key);

    if (!zipStream) {
      return c.json({ error: 'Not Found', message: 'Artifact file not found in storage' }, 404);
    }

    // Read ZIP into memory
    const zipChunks: Uint8Array[] = [];
    const zipReader = zipStream.getReader();

    while (true) {
      const { done, value } = await zipReader.read();
      if (done) break;
      if (value) {
        zipChunks.push(value);
      }
    }

    // Combine chunks
    const totalSize = zipChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    zipData = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of zipChunks) {
      zipData.set(chunk, offset);
      offset += chunk.length;
    }
  }

  // 7. Extract README from ZIP
  const readmeContent = extractReadme(zipData);

  if (!readmeContent) {
    // Store NOT_FOUND marker to avoid repeated extraction attempts
    const notFoundMarker = new TextEncoder().encode('NOT_FOUND');
    await storage.put(readmeStorageKey, notFoundMarker).catch((err) => {
      console.error(`Error storing NOT_FOUND marker for ${readmeStorageKey}:`, err);
    });

    return c.json({
      error: 'Not Found',
      message: 'No README file exists in this package version'
    }, 404);
  }

  // 8. Store README in R2/S3 for future requests
  const readmeBytes = new TextEncoder().encode(readmeContent);
  await storage.put(readmeStorageKey, readmeBytes).catch((err) => {
    console.error(`Error storing README for ${readmeStorageKey}:`, err);
    // Continue even if storage fails - we'll still return the content
  });

  // 9. Return with aggressive CDN caching headers
  return new Response(readmeContent, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-README-Source': 'extracted',
    },
  });
}

/**
 * GET /api/packages/:name/:version/changelog
 * Get CHANGELOG.md content for a specific package version
 * Uses R2/S3 storage instead of KV for better scalability
 */
export async function getPackageChangelog(c: OpenAPIContext<PackagesRouteEnv>): Promise<Response> {
  const { name: nameParam, version } = c.req.valid('param');
  // Decode URL-encoded package name (handles slashes like amasty/cron-schedule-list)
  const name = decodeURIComponent(nameParam);

  if (!name || !version) {
    return c.json({ error: 'Bad Request', message: 'Missing package name or version' }, 400);
  }

  // 1. Get package from database to find repo_id
  const db = c.get('database');
  const [pkg] = await db
    .select()
    .from(packages)
    .where(
      and(
        eq(packages.name, name),
        eq(packages.version, version)
      )
    )
    .limit(1);

  if (!pkg) {
    return c.json({ error: 'Not Found', message: 'Package version not found' }, 404);
  }

  // 2. Determine storage type (public for Packagist, private for others)
  const storageType = pkg.repo_id === 'packagist' ? 'public' : 'private';
  const changelogStorageKey = buildChangelogStorageKey(storageType, pkg.repo_id, name, version);
  const storage = c.var.storage;

  // 3. Check if CHANGELOG already exists in R2/S3 storage
  const existingChangelog = await storage.get(changelogStorageKey);

  if (existingChangelog) {
    // Read the stream to check if it's a "NOT_FOUND" marker
    const chunks: Uint8Array[] = [];
    const reader = existingChangelog.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
      }
    }

    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const content = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.length;
    }

    const textContent = new TextDecoder().decode(content);

    // If it's a NOT_FOUND marker, return 404
    if (textContent === 'NOT_FOUND') {
      return c.json({
        error: 'Not Found',
        message: 'No CHANGELOG file exists in this package version'
      }, 404);
    }

    // Return cached CHANGELOG with aggressive CDN caching
    return new Response(textContent, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-CHANGELOG-Source': 'storage',
      },
    });
  }

  // 4. CHANGELOG not in storage - need to extract from ZIP
  // Get artifact to find ZIP storage key
  let [artifact] = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.repo_id, pkg.repo_id),
        eq(artifacts.package_name, name),
        eq(artifacts.version, version)
      )
    )
    .limit(1);

  let zipData: Uint8Array | null = null;

  // 5. If artifact doesn't exist, try on-demand download
  if (!artifact) {
    // Check if we can download from source
    if (!pkg.source_dist_url) {
      return c.json({ error: 'Not Found', message: 'Artifact not found and source URL unavailable. Package may need to be downloaded first.' }, 404);
    }

    // Validate it's actually a URL
    if (!pkg.source_dist_url.startsWith('http://') && !pkg.source_dist_url.startsWith('https://')) {
      return c.json({ error: 'Not Found', message: 'Invalid source URL. Please re-sync the repository to update package metadata.' }, 404);
    }

    // Get repository for credentials
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, pkg.repo_id))
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

      // Read the response body
      const sourceStream = sourceResponse.body;
      if (!sourceStream) {
        throw new Error('Source response has no body');
      }

      // Read all chunks into memory
      const chunks: Uint8Array[] = [];
      const reader = sourceStream.getReader();
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalSize += value.length;
        }
      }

      // Combine chunks into a single Uint8Array
      zipData = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        zipData.set(chunk, offset);
        offset += chunk.length;
      }

      // Store artifact in storage
      const storageKey = buildStorageKey(storageType, pkg.repo_id, name, version);
      // Convert to ArrayBuffer (not SharedArrayBuffer) for storage
      const arrayBuffer = zipData.buffer.slice(
        zipData.byteOffset,
        zipData.byteOffset + zipData.byteLength
      ) as ArrayBuffer;

      try {
        await storage.put(storageKey, arrayBuffer);
        console.log(`Successfully stored artifact for CHANGELOG extraction: ${storageKey} (${totalSize} bytes)`);
      } catch (err) {
        console.error(`Error storing artifact ${storageKey}:`, err);
        // Continue - we can still extract CHANGELOG from zipData
      }

      // Create artifact record (ignore if already exists from concurrent request)
      const artifactId = nanoid();
      const now = Math.floor(Date.now() / 1000);
      try {
        await db.insert(artifacts).values({
          id: artifactId,
          repo_id: pkg.repo_id,
          package_name: name,
          version: version,
          file_key: storageKey,
          size: totalSize,
          download_count: 0,
          created_at: now,
        }).onConflictDoNothing();
        artifact = {
          id: artifactId,
          repo_id: pkg.repo_id,
          package_name: name,
          version: version,
          file_key: storageKey,
          size: totalSize,
          download_count: 0,
          created_at: now,
          last_downloaded_at: null,
        };
      } catch (err) {
        console.error(`Error creating artifact record:`, err);
        // Continue - we can still extract CHANGELOG from zipData
      }
    } catch (error) {
      console.error(`Error downloading artifact from source:`, error);
      return c.json(
        {
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Failed to download artifact',
        },
        500
      );
    }
  }

  // 6. Get ZIP from storage if we don't already have it in memory
  if (!zipData) {
    if (!artifact) {
      return c.json({ error: 'Not Found', message: 'Artifact not found' }, 404);
    }

    const zipStream = await storage.get(artifact.file_key);

    if (!zipStream) {
      return c.json({ error: 'Not Found', message: 'Artifact file not found in storage' }, 404);
    }

    // Read ZIP into memory
    const zipChunks: Uint8Array[] = [];
    const zipReader = zipStream.getReader();

    while (true) {
      const { done, value } = await zipReader.read();
      if (done) break;
      if (value) {
        zipChunks.push(value);
      }
    }

    // Combine chunks
    const totalSize = zipChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    zipData = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of zipChunks) {
      zipData.set(chunk, offset);
      offset += chunk.length;
    }
  }

  // 7. Extract CHANGELOG from ZIP
  const changelogContent = extractChangelog(zipData);

  if (!changelogContent) {
    // Store NOT_FOUND marker to avoid repeated extraction attempts
    const notFoundMarker = new TextEncoder().encode('NOT_FOUND');
    await storage.put(changelogStorageKey, notFoundMarker).catch((err) => {
      console.error(`Error storing NOT_FOUND marker for ${changelogStorageKey}:`, err);
    });

    return c.json({
      error: 'Not Found',
      message: 'No CHANGELOG file exists in this package version'
    }, 404);
  }

  // 8. Store CHANGELOG in R2/S3 for future requests
  const changelogBytes = new TextEncoder().encode(changelogContent);
  await storage.put(changelogStorageKey, changelogBytes).catch((err) => {
    console.error(`Error storing CHANGELOG for ${changelogStorageKey}:`, err);
    // Continue even if storage fails - we'll still return the content
  });

  // 9. Return with aggressive CDN caching headers
  return new Response(changelogContent, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-CHANGELOG-Source': 'extracted',
    },
  });
}

/**
 * POST /api/packages/add-from-mirror
 * Manually fetch and store packages from a selected mirror repository
 */
export async function addPackagesFromMirror(c: Context<PackagesRouteEnv>): Promise<Response> {
  const body = await c.req.json() as { repository_id: string; package_names: string[] };

  if (!body.repository_id || !Array.isArray(body.package_names) || body.package_names.length === 0) {
    return c.json({ error: 'Bad Request', message: 'repository_id and package_names array are required' }, 400);
  }

  const db = c.get('database');
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const results: Array<{ package: string; success: boolean; versions?: number; error?: string }> = [];

  // Handle Packagist repository
  if (body.repository_id === 'packagist') {
    const mirroringEnabled = await isPackagistMirroringEnabled(c.env.KV);
    if (!mirroringEnabled) {
      return c.json({ error: 'Bad Request', message: 'Packagist mirroring is not enabled' }, 400);
    }

    const { ensurePackagistRepository } = await import('../composer');
    await ensurePackagistRepository(db, c.env.ENCRYPTION_KEY, c.env.KV);

    // Fetch each package from Packagist
    for (const packageName of body.package_names) {
      try {
        const packagistUrl = `https://repo.packagist.org/p2/${packageName}.json`;
        const response = await fetch(packagistUrl, {
          headers: {
            'User-Agent': COMPOSER_USER_AGENT,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            results.push({ package: packageName, success: false, error: 'Package not found' });
            continue;
          }
          results.push({ package: packageName, success: false, error: `HTTP ${response.status}` });
          continue;
        }

        const packageData: any = await response.json();
        const { transformPackageDistUrls } = await import('../composer');
        const { storedCount, errors } = await transformPackageDistUrls(packageData, 'packagist', baseUrl, db);

        if (storedCount > 0) {
          results.push({ package: packageName, success: true, versions: storedCount });
        } else {
          results.push({ package: packageName, success: false, error: errors.join('; ') || 'No versions stored' });
        }
      } catch (error) {
        results.push({
          package: packageName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } else {
    // Handle Composer and Git repositories
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, body.repository_id))
      .limit(1);

    if (!repo) {
      return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
    }

    // Allow both composer and git repositories
    if (repo.vcs_type !== 'composer' && repo.vcs_type !== 'git') {
      return c.json({ error: 'Bad Request', message: 'Only Composer and Git repositories can be used for manual package addition' }, 400);
    }

    // Allow active, error, and pending repos (matching UI filter)
    if (repo.status === 'syncing') {
      return c.json({ error: 'Bad Request', message: 'Repository is currently syncing, please wait' }, 400);
    }

    const upstreamRepo: UpstreamRepository = {
      id: repo.id,
      url: repo.url,
      vcs_type: repo.vcs_type,
      credential_type: repo.credential_type,
      auth_credentials: repo.auth_credentials,
      package_filter: repo.package_filter,
    };

    for (const packageName of body.package_names) {
      try {
        let packageData = null;

        if (repo.vcs_type === 'composer') {
          packageData = await fetchPackageFromUpstream(upstreamRepo, packageName, c.env.ENCRYPTION_KEY);
        } else if (repo.vcs_type === 'git') {
          const { fetchPackageFromGitHub, isGitHubUrl } = await import('../../utils/upstream-fetch');
          if (!isGitHubUrl(repo.url)) {
            results.push({ package: packageName, success: false, error: 'Only GitHub URLs are supported for git repositories' });
            continue;
          }
          packageData = await fetchPackageFromGitHub(upstreamRepo, packageName, c.env.ENCRYPTION_KEY);
        }

        if (!packageData) {
          results.push({ package: packageName, success: false, error: 'Package not found' });
          continue;
        }

        const { transformPackageDistUrls } = await import('../composer');
        const { storedCount, errors } = await transformPackageDistUrls(packageData, repo.id, baseUrl, db);

        if (storedCount > 0) {
          results.push({ package: packageName, success: true, versions: storedCount });
        } else {
          results.push({ package: packageName, success: false, error: errors.join('; ') || 'No versions stored' });
        }
      } catch (error) {
        results.push({
          package: packageName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalVersions = results.reduce((sum, r) => sum + (r.versions || 0), 0);

  return c.json({
    results,
    summary: {
      total: results.length,
      succeeded,
      failed,
      total_versions: totalVersions,
    },
  });
}

/**
 * POST /api/packages/upload
 * Upload a package archive with composer.json metadata
 * 
 * Performance optimized for Cloudflare Workers:
 * - Validates archive before storage
 * - Automatically creates "manual" repository if needed
 * - Stores in private storage
 * - Extracts README for better UX
 */
export async function uploadPackage(c: OpenAPIContext<PackagesRouteEnv>): Promise<Response> {
  const logger = getLogger();
  const db = c.get('database');
  const storage = c.get('storage');
  const now = Math.floor(Date.now() / 1000);

  // Parse multipart form data
  const body = await c.req.parseBody();
  const file = body.file;

  if (!file || !(file instanceof File)) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Missing or invalid file upload',
      },
      400
    );
  }

  // Check file size (max 100MB)
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    return c.json(
      {
        error: 'Payload Too Large',
        message: `File too large: ${Math.round(file.size / 1024 / 1024)}MB (max 100MB)`,
      },
      413
    );
  }

  // Convert file to Uint8Array
  const arrayBuffer = await file.arrayBuffer();
  const archiveData = new Uint8Array(arrayBuffer);
  
  // Comprehensive debug logging
  const firstBytes = Array.from(archiveData.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  logger.info('Package upload received', { 
    fileName: file.name, 
    fileSize: file.size, 
    fileType: file.type,
    arrayBufferSize: arrayBuffer.byteLength,
    archiveDataSize: archiveData.length,
    firstBytes,
    isValidZipMagic: archiveData[0] === 0x50 && archiveData[1] === 0x4B,
  });

  // Validate package archive and extract composer.json
  const { validatePackageArchive, extractReadme: extractReadmeFromValidator } = await import('../../utils/package-validator.js');
  const validation = await validatePackageArchive(archiveData);
  
  // Log validation result for debugging
  if (!validation.success) {
    logger.warn('Package validation failed', {
      fileName: file.name,
      errors: validation.errors,
    });
  }

  if (!validation.success || !validation.metadata) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Invalid package archive',
        details: validation.errors || [],
      },
      400
    );
  }

  const metadata = validation.metadata;
  const { name, version } = metadata;

  // Check if package+version already exists
  const [existing] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.name, name), eq(packages.version, version)))
    .limit(1);

  if (existing) {
    return c.json(
      {
        error: 'Conflict',
        message: `Package ${name}@${version} already exists`,
      },
      409
    );
  }

  // Ensure "manual" repository exists
  const MANUAL_REPO_ID = 'manual';
  const [manualRepo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, MANUAL_REPO_ID))
    .limit(1);

  if (!manualRepo) {
    // Create manual repository
    try {
      await db.insert(repositories).values({
        id: MANUAL_REPO_ID,
        url: 'manual://uploads',
        vcs_type: 'manual',
        credential_type: 'none',
        auth_credentials: '{}', // Empty credentials
        composer_json_path: null,
        package_filter: null,
        status: 'active',
        error_message: null,
        last_synced_at: now,
        created_at: now,
      });
      logger.info('Created manual repository for uploads');
    } catch (error) {
      logger.error('Failed to create manual repository', {}, error instanceof Error ? error : new Error(String(error)));
      return c.json(
        {
          error: 'Internal Server Error',
          message: 'Failed to create manual repository',
        },
        500
      );
    }
  }

  // Store archive in private storage
  const storageKey = buildStorageKey('private', MANUAL_REPO_ID, name, version);
  
  try {
    // Convert to ArrayBuffer for storage (avoid SharedArrayBuffer)
    const storageBuffer = archiveData.buffer.slice(
      archiveData.byteOffset,
      archiveData.byteOffset + archiveData.byteLength
    ) as ArrayBuffer;

    await storage.put(storageKey, storageBuffer);
    logger.info('Stored package archive', { name, version, storageKey, size: archiveData.length });
  } catch (error) {
    logger.error('Failed to store package archive', { name, version }, error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to store package archive',
      },
      500
    );
  }

  // Create artifact record (ignore if already exists from concurrent request)
  const artifactId = nanoid();
  try {
    await db.insert(artifacts).values({
      id: artifactId,
      repo_id: MANUAL_REPO_ID,
      package_name: name,
      version: version,
      file_key: storageKey,
      size: archiveData.length,
      download_count: 0,
      created_at: now,
      last_downloaded_at: null,
    }).onConflictDoNothing();
  } catch (error) {
    logger.error('Failed to create artifact record', { name, version }, error instanceof Error ? error : new Error(String(error)));
    // Continue - package is stored, artifact record is optional
  }

  // Extract README if available (best effort)
  let readmeContent: string | null = null;
  try {
    readmeContent = extractReadmeFromValidator(archiveData);
    if (readmeContent) {
      const readmeKey = buildReadmeStorageKey('private', MANUAL_REPO_ID, name, version);
      const readmeBytes = new TextEncoder().encode(readmeContent);
      await storage.put(readmeKey, readmeBytes).catch((err) => {
        logger.warn('Failed to store README', { name, version, error: err instanceof Error ? err.message : String(err) });
      });
    }
  } catch (error) {
    logger.warn('Failed to extract README', { name, version, error: error instanceof Error ? error.message : String(error) });
    // Continue - README is optional
  }

  // Build dist URL for Composer
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const distUrl = `${baseUrl}/dist/${MANUAL_REPO_ID}/${name}/${version}`;

  // Create package record with manual upload flag
  const packageId = nanoid();
  const releasedAt = metadata.time ? Math.floor(new Date(metadata.time).getTime() / 1000) : now;

  try {
    await db.insert(packages).values({
      id: packageId,
      repo_id: MANUAL_REPO_ID,
      name: name,
      version: version,
      dist_url: distUrl,
      source_dist_url: null, // No source for manual uploads
      dist_reference: `manual-${version}`,
      description: metadata.description || null,
      license: metadata.license ? JSON.stringify(metadata.license) : null,
      package_type: metadata.type || 'library',
      homepage: metadata.homepage || null,
      released_at: releasedAt,
      readme_content: readmeContent,
      metadata: JSON.stringify(metadata),
      is_manual_upload: 1, // Mark as manual upload
      created_at: now,
    });

    logger.info('Created package record for manual upload', { name, version, packageId });

    // Invalidate cache so Composer sees the new version immediately
    const cache = c.get('cache');
    if (cache) {
      await Promise.all([
        cache.delete(`p2:${name}`).catch(() => {}),
        cache.delete(`p2:${name}:metadata`).catch(() => {}),
      ]);
      logger.debug('Invalidated cache for package', { name });
    }
  } catch (error) {
    logger.error('Failed to create package record', { name, version }, error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to create package record',
      },
      500
    );
  }

  return c.json(
    {
      message: 'Package uploaded successfully',
      package: {
        id: packageId,
        name: name,
        version: version,
        description: metadata.description || null,
      },
    },
    201
  );
}

/**
 * POST /packages/cleanup-numeric-versions
 * Temporary utility to fix versioning issues
 */
export async function cleanupNumericVersions(c: Context<PackagesRouteEnv>): Promise<Response> {
  // Stub implementation to satisfy export requirements
  // Real implementation would clean up numeric versions like x.y.z.0
  return c.json({ message: 'Cleanup not implemented in this adapter version' });
}

/**
 * DELETE /api/packages/:name/:version
 * Delete a specific package version
 * Removes: package record, artifact record, and stored files (archive, README, changelog)
 */
export async function deletePackageVersion(c: OpenAPIContext<PackagesRouteEnv>): Promise<Response> {
  const logger = getLogger();
  const { name: nameParam, version } = c.req.valid('param');
  const name = decodeURIComponent(nameParam);
  
  const db = c.get('database');
  const storage = c.get('storage');

  // Find the package version
  const [pkg] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.name, name), eq(packages.version, version)))
    .limit(1);

  if (!pkg) {
    return c.json(
      {
        error: 'Not Found',
        message: `Package ${name}@${version} not found`,
      },
      404
    );
  }

  let filesRemoved = 0;
  const storageType = pkg.repo_id === 'packagist' ? 'public' : 'private';

  // Find and delete artifact
  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.repo_id, pkg.repo_id),
        eq(artifacts.package_name, name),
        eq(artifacts.version, version)
      )
    )
    .limit(1);

  if (artifact) {
    // Delete archive file from storage
    try {
      await storage.delete(artifact.file_key);
      filesRemoved++;
      logger.info('Deleted package archive from storage', { name, version, key: artifact.file_key });
    } catch (error) {
      logger.warn('Failed to delete archive file', { 
        name, 
        version, 
        key: artifact.file_key,
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    // Delete artifact record
    try {
      await db.delete(artifacts).where(eq(artifacts.id, artifact.id));
    } catch (error) {
      logger.warn('Failed to delete artifact record', { 
        name, 
        version,
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // Delete README from storage (best effort)
  try {
    const readmeKey = buildReadmeStorageKey(storageType, pkg.repo_id, name, version);
    await storage.delete(readmeKey);
    filesRemoved++;
  } catch {
    // README might not exist, ignore error
  }

  // Delete CHANGELOG from storage (best effort)
  try {
    const changelogKey = buildChangelogStorageKey(storageType, pkg.repo_id, name, version);
    await storage.delete(changelogKey);
    filesRemoved++;
  } catch {
    // CHANGELOG might not exist, ignore error
  }

  // Delete package record
  try {
    await db.delete(packages).where(eq(packages.id, pkg.id));
    logger.info('Deleted package version', { name, version, packageId: pkg.id, filesRemoved });
  } catch (error) {
    logger.error('Failed to delete package record', { name, version }, error instanceof Error ? error : new Error(String(error)));
    return c.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to delete package record',
      },
      500
    );
  }

  return c.json({
    message: `Package ${name}@${version} deleted successfully`,
    deleted: {
      name,
      version,
      filesRemoved,
    },
  });
}
