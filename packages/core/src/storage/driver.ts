// Storage driver interface

/**
 * Storage driver interface for R2/S3-compatible storage
 */
export interface StorageDriver {
  /**
   * Get a file from storage
   * @param key - Storage key (e.g., "repo/{repo_id}/dist/{package}/{version}.zip")
   * @returns ReadableStream of file content, or null if not found
   */
  get(key: string): Promise<ReadableStream | null>;

  /**
   * Put a file into storage
   * @param key - Storage key
   * @param data - ReadableStream, ArrayBuffer, or Uint8Array of file content
   */
  put(key: string, data: ReadableStream | ArrayBuffer | Uint8Array): Promise<void>;

  /**
   * Delete a file from storage
   * @param key - Storage key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists in storage
   * @param key - Storage key
   * @returns true if file exists, false otherwise
   */
  exists(key: string): Promise<boolean>;
}

/**
 * Storage key naming conventions:
 * - Private repos: `repo/{repo_id}/dist/{package}/{version}.zip`
 * - Public Packagist: `public/p2/{package}/{version}.zip`
 * - Metadata: `repo/{repo_id}/packages.json` (in KV, not R2)
 */
export function buildStorageKey(
  type: 'private' | 'public',
  repoId: string,
  packageName: string,
  version: string
): string {
  if (type === 'public') {
    return `public/${repoId}/${packageName}/${version}.zip`;
  }
  return `private/${repoId}/${packageName}/${version}.zip`;
}

/**
 * Build storage key for README.md file
 * @param type - Storage type ('private' or 'public')
 * @param repoId - Repository ID
 * @param packageName - Package name (e.g., 'vendor/package')
 * @param version - Package version
 * @returns Storage key for README file
 */
export function buildReadmeStorageKey(
  type: 'private' | 'public',
  repoId: string,
  packageName: string,
  version: string
): string {
  if (type === 'public') {
    return `public/${repoId}/${packageName}/${version}.readme.md`;
  }
  return `private/${repoId}/${packageName}/${version}.readme.md`;
}

/**
 * Build storage key for CHANGELOG.md file
 * @param type - Storage type ('private' or 'public')
 * @param repoId - Repository ID
 * @param packageName - Package name (e.g., 'vendor/package')
 * @param version - Package version
 * @returns Storage key for CHANGELOG file
 */
export function buildChangelogStorageKey(
  type: 'private' | 'public',
  repoId: string,
  packageName: string,
  version: string
): string {
  if (type === 'public') {
    return `public/${repoId}/${packageName}/${version}.changelog.md`;
  }
  return `private/${repoId}/${packageName}/${version}.changelog.md`;
}

/**
 * Parse a storage key back into its components
 * @param key - Storage key string
 * @returns Parsed components or null if invalid
 */
export function parseStorageKey(
  key: string
): { type: 'private' | 'public'; repoId: string; packageName: string; version: string } | null {
  const match = key.match(/^(private|public)\/([^/]+)\/(.+)\/([^/]+)\.zip$/);
  if (!match) return null;

  const [, type, repoId, packageName, version] = match;
  return {
    type: type as 'private' | 'public',
    repoId,
    packageName,
    version,
  };
}

