/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// GitHub Repository API strategy (fallback)

import type { SyncResult, ComposerPackage, GitHubTreeResponse, GitHubTreeItem } from '../types';
import micromatch from 'micromatch';
import semver from 'semver';
import pRetry from 'p-retry';
import { getLogger } from '../../utils/logger';

/**
 * Sync via GitHub Repository API (fallback when Packages Registry unavailable)
 */
export async function syncViaGitHubApi(
  owner: string,
  repo: string,
  token: string,
  branch: string = 'main',
  composerJsonPath: string = '**/composer.json'
): Promise<SyncResult> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CloudflareComposerProxy/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // Step 1: Get repository tree
    const treeResponse = await pRetry(
      () =>
        fetch(
          `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
          { headers }
        ),
      { retries: 3 }
    );

    if (treeResponse.status === 401 || treeResponse.status === 403) {
      return { success: false, packages: [], error: 'auth_failed' };
    }

    if (treeResponse.status === 404) {
      return { success: false, packages: [], error: 'repo_not_found' };
    }

    if (!treeResponse.ok) {
      return { success: false, packages: [], error: `tree_fetch_failed_${treeResponse.status}` };
    }

    const treeData: GitHubTreeResponse = await treeResponse.json();

    // Handle truncated repos (>100k files)
    if (treeData.truncated) {
      const logger = getLogger();
      logger.warn('Repository has >100k files, tree truncated', { owner, repo });
      // Could implement directory-by-directory traversal here
    }

    // Step 2: Find composer.json files using glob pattern
    const composerFiles = findComposerJsonFiles(treeData.tree, composerJsonPath);

    if (composerFiles.length === 0) {
      return { success: false, packages: [], error: 'no_composer_json_found' };
    }

    // Step 3: Fetch each composer.json
    const packages: ComposerPackage[] = [];

    for (const file of composerFiles) {
      const contentResponse = await pRetry(
        () =>
          fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`,
            {
              headers: {
                ...headers,
                Accept: 'application/vnd.github.raw+json',
              },
            }
          ),
        { retries: 2 }
      );

      if (!contentResponse.ok) continue;

      const composerJson = await contentResponse.json() as {
        name?: string;
        version?: string;
        require?: Record<string, string>;
        'require-dev'?: Record<string, string>;
        description?: string;
      };

      // Step 4: Parse package info
      if (composerJson.name) {
        packages.push({
          name: composerJson.name,
          version: composerJson.version || `dev-${branch}`,
          require: composerJson.require,
          'require-dev': composerJson['require-dev'],
          description: composerJson.description,
          dist: {
            type: 'zip',
            url: `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
            reference: treeData.sha,
          },
        });
      }
    }

    // Step 5: Get versions from tags
    const versions = await getVersionsFromTags(owner, repo, token);

    // Add versioned packages from tags
    for (const [version, sha] of versions) {
      for (const pkg of packages) {
        if (semver.valid(version)) {
          packages.push({
            ...pkg,
            version,
            dist: {
              type: 'zip',
              url: `https://api.github.com/repos/${owner}/${repo}/zipball/${version}`,
              reference: sha,
            },
          });
        }
      }
    }

    return { success: true, packages, strategy: 'github_api' };
  } catch (error) {
    const logger = getLogger();
    logger.error('GitHub API sync error', { owner, repo }, error instanceof Error ? error : new Error(String(error)));
    return { success: false, packages: [], error: 'network_error' };
  }
}

/**
 * Find composer.json files using glob pattern matching
 */
function findComposerJsonFiles(tree: GitHubTreeItem[], globPattern: string): GitHubTreeItem[] {
  const blobPaths = tree.filter((item) => item.type === 'blob').map((item) => item.path);

  const matchedPaths = micromatch(blobPaths, globPattern);

  return tree.filter((item) => matchedPaths.includes(item.path));
}

/**
 * Get versions from repository tags
 */
async function getVersionsFromTags(
  owner: string,
  repo: string,
  token: string
): Promise<Map<string, string>> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CloudflareComposerProxy/1.0',
  };

  try {
    const response = await pRetry(
      () => fetch(`https://api.github.com/repos/${owner}/${repo}/tags`, { headers }),
      { retries: 2 }
    );

    if (!response.ok) {
      return new Map();
    }

    const tags: Array<{ name: string; commit: { sha: string } }> = await response.json();
    const versions = new Map<string, string>();

    for (const tag of tags) {
      // Parse tag name as semver (e.g., "v1.2.3" → "1.2.3")
      const version = semver.clean(tag.name) || tag.name;
      if (semver.valid(version)) {
        versions.set(version, tag.commit.sha);
      }
    }

    return versions;
  } catch (error) {
    const logger = getLogger();
    logger.error('Error fetching tags', { owner, repo }, error instanceof Error ? error : new Error(String(error)));
    return new Map();
  }
}

