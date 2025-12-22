// Packages API routes

import type { Context } from 'hono';
import type { DatabasePort } from '../../ports';
import { packages, artifacts, repositories } from '../../db/schema';
import { eq, like, and } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import type { StorageDriver } from '../../storage/driver';
import { buildStorageKey, buildReadmeStorageKey, buildChangelogStorageKey } from '../../storage/driver';
import { downloadFromSource } from '../../utils/download';
import { decryptCredentials } from '../../utils/encryption';
import { nanoid } from 'nanoid';
import { COMPOSER_USER_AGENT } from '@package-broker/shared';
import { isPackagistMirroringEnabled } from './settings';
import { getLogger } from '../../utils/logger';

export interface PackagesRouteEnv {
  Bindings: {
    DB: D1Database;
    KV: KVNamespace;
    ENCRYPTION_KEY: string;
  };
  Variables: {
    database: DatabasePort;
    storage: StorageDriver;
  };
}

/**
 * GET /api/packages
 * List all packages (with optional search)
 */
export async function listPackages(c: Context<PackagesRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const search = c.req.query('search');

  let allPackages;
  if (search) {
    allPackages = await db
      .select()
      .from(packages)
      .where(like(packages.name, `%${search}%`))
      .orderBy(packages.name);
  } else {
    allPackages = await db.select().from(packages).orderBy(packages.name);
  }

  return c.json(allPackages);
}

/**
 * GET /api/packages/:name
 * Get a single package with all versions
 */
export async function getPackage(c: Context<PackagesRouteEnv>): Promise<Response> {
  const nameParam = c.req.param('name');
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
export async function getPackageReadme(c: Context<PackagesRouteEnv>): Promise<Response> {
  const nameParam = c.req.param('name');
  const version = c.req.param('version');
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

      // Create artifact record
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
        });
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
export async function getPackageChangelog(c: Context<PackagesRouteEnv>): Promise<Response> {
  const nameParam = c.req.param('name');
  const version = c.req.param('version');
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

      // Create artifact record
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
        });
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
    // Handle other Composer repositories
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, body.repository_id))
      .limit(1);

    if (!repo) {
      return c.json({ error: 'Not Found', message: 'Repository not found' }, 404);
    }

    if (repo.vcs_type !== 'composer') {
      return c.json({ error: 'Bad Request', message: 'Only Composer repositories can be used for manual package addition' }, 400);
    }

    if (repo.status !== 'active') {
      return c.json({ error: 'Bad Request', message: 'Repository is not active' }, 400);
    }

    // TODO: Implement manual package addition for other composer repositories
    // This requires fetching the package metadata from the source repository
    // which is more complex than just fetching from Packagist
    return c.json({ error: 'Not Implemented', message: 'Manual package addition is currently only supported for Packagist' }, 501);
  }

  return c.json({ results });
}
