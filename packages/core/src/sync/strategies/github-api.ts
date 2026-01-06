/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * GitHub Repository API strategy for syncing packages from GitHub repositories.
 * 
 * Supports both authenticated and unauthenticated access:
 * - Authenticated (token): 5,000 requests/hour rate limit
 * - Unauthenticated (public repos): 60 requests/hour rate limit
 * 
 * This is designed to be extended for webhook integration (Issue #31).
 */

import type { SyncResult, ComposerPackage, GitHubTreeResponse, GitHubTreeItem } from '../types';
import micromatch from 'micromatch';
import semver from 'semver';
import pRetry from 'p-retry';
import { getLogger } from '../../utils/logger';

const GITHUB_API_BASE = 'https://api.github.com';
const USER_AGENT = 'PackageBroker/1.0';

/**
 * Rate limit info from GitHub API response headers
 */
export interface GitHubRateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  used: number;
}

/**
 * Build GitHub API headers with optional authentication
 * 
 * @param token - GitHub Personal Access Token (null for public repos)
 * @param accept - Accept header value (defaults to JSON)
 */
function buildGitHubHeaders(token: string | null, accept: string = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Extract rate limit info from GitHub API response
 */
function extractRateLimitInfo(response: Response): GitHubRateLimitInfo {
  return {
    limit: parseInt(response.headers.get('X-RateLimit-Limit') || '60', 10),
    remaining: parseInt(response.headers.get('X-RateLimit-Remaining') || '60', 10),
    reset: parseInt(response.headers.get('X-RateLimit-Reset') || '0', 10),
    used: parseInt(response.headers.get('X-RateLimit-Used') || '0', 10),
  };
}

/**
 * Check if rate limit is approaching and log warning
 */
function checkRateLimit(rateLimit: GitHubRateLimitInfo, context: { owner: string; repo: string }): void {
  const logger = getLogger();
  
  if (rateLimit.remaining < 10) {
    const resetDate = new Date(rateLimit.reset * 1000);
    logger.warn('GitHub API rate limit approaching', {
      ...context,
      remaining: rateLimit.remaining,
      limit: rateLimit.limit,
      resetsAt: resetDate.toISOString(),
    });
  }
}

/**
 * Sync via GitHub Repository API
 * 
 * Fetches package metadata from a GitHub repository by:
 * 1. Fetching the repository tree
 * 2. Finding composer.json files
 * 3. Parsing package metadata
 * 4. Fetching version info from tags
 * 
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name  
 * @param token - GitHub token (null for public repos)
 * @param branch - Branch to sync from (default: 'main')
 * @param composerJsonPath - Glob pattern for composer.json files
 */
export async function syncViaGitHubApi(
  owner: string,
  repo: string,
  token: string | null,
  branch: string = 'main',
  composerJsonPath: string = '**/composer.json'
): Promise<SyncResult> {
  const logger = getLogger();
  const headers = buildGitHubHeaders(token);
  const context = { owner, repo, isPublic: !token };

  try {
    // Step 1: Get repository tree
    const treeResponse = await pRetry(
      () => fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        { headers }
      ),
      { retries: 3 }
    );

    // Check rate limits
    const rateLimit = extractRateLimitInfo(treeResponse);
    checkRateLimit(rateLimit, { owner, repo });

    // Handle error responses
    if (treeResponse.status === 401 || treeResponse.status === 403) {
      // For public repos without token, 403 might mean rate limited
      if (!token && treeResponse.status === 403) {
        return { success: false, packages: [], error: 'rate_limited' };
      }
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
      logger.warn('Repository has >100k files, tree truncated', context);
    }

    // Step 2: Find composer.json files using glob pattern
    const composerFiles = findComposerJsonFiles(treeData.tree, composerJsonPath);

    if (composerFiles.length === 0) {
      return { success: false, packages: [], error: 'no_composer_json_found' };
    }

    // Step 3: Fetch and parse each composer.json
    const basePackages = await fetchComposerJsonFiles(
      owner,
      repo,
      branch,
      composerFiles,
      treeData.sha,
      token
    );

    if (basePackages.length === 0) {
      return { success: false, packages: [], error: 'no_valid_composer_json' };
    }

    // Step 4: Get versions from tags and create versioned packages
    const packages = await createVersionedPackages(owner, repo, basePackages, token);

    logger.info('GitHub API sync completed', {
      ...context,
      packageCount: packages.length,
      composerFilesFound: composerFiles.length,
    });

    return { success: true, packages, strategy: 'github_api' };
  } catch (error) {
    logger.error('GitHub API sync error', context, error instanceof Error ? error : new Error(String(error)));
    return { success: false, packages: [], error: 'network_error' };
  }
}

/**
 * Find composer.json files using glob pattern matching
 */
function findComposerJsonFiles(tree: GitHubTreeItem[], globPattern: string): GitHubTreeItem[] {
  const blobPaths = tree
    .filter((item) => item.type === 'blob')
    .map((item) => item.path);

  const matchedPaths = micromatch(blobPaths, globPattern);

  return tree.filter((item) => matchedPaths.includes(item.path));
}

/**
 * Fetch and parse composer.json files from GitHub
 */
async function fetchComposerJsonFiles(
  owner: string,
  repo: string,
  branch: string,
  files: GitHubTreeItem[],
  treeSha: string,
  token: string | null
): Promise<ComposerPackage[]> {
  const headers = buildGitHubHeaders(token, 'application/vnd.github.raw+json');
  const packages: ComposerPackage[] = [];

  for (const file of files) {
    try {
      const contentResponse = await pRetry(
        () => fetch(
          `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`,
          { headers }
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
        license?: string | string[];
        type?: string;
        homepage?: string;
      };

      if (composerJson.name) {
        packages.push({
          name: composerJson.name,
          version: composerJson.version || `dev-${branch}`,
          require: composerJson.require,
          'require-dev': composerJson['require-dev'],
          description: composerJson.description,
          license: composerJson.license,
          type: composerJson.type,
          homepage: composerJson.homepage,
          dist: {
            type: 'zip',
            url: `${GITHUB_API_BASE}/repos/${owner}/${repo}/zipball/${branch}`,
            reference: treeSha,
          },
        });
      }
    } catch (error) {
      const logger = getLogger();
      logger.warn('Failed to fetch composer.json', { owner, repo, file: file.path });
    }
  }

  return packages;
}

/**
 * Get versions from repository tags
 */
async function getVersionsFromTags(
  owner: string,
  repo: string,
  token: string | null
): Promise<Map<string, string>> {
  const headers = buildGitHubHeaders(token);
  const logger = getLogger();

  try {
    const response = await pRetry(
      () => fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/tags`, { headers }),
      { retries: 2 }
    );

    // Check rate limits
    const rateLimit = extractRateLimitInfo(response);
    checkRateLimit(rateLimit, { owner, repo });

    if (!response.ok) {
      if (response.status === 403 && rateLimit.remaining === 0) {
        logger.warn('Rate limited when fetching tags', { owner, repo });
      }
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
    logger.error('Error fetching tags', { owner, repo }, error instanceof Error ? error : new Error(String(error)));
    return new Map();
  }
}

/**
 * Create versioned packages from base packages and tags
 */
async function createVersionedPackages(
  owner: string,
  repo: string,
  basePackages: ComposerPackage[],
  token: string | null
): Promise<ComposerPackage[]> {
  const versions = await getVersionsFromTags(owner, repo, token);
  const packages: ComposerPackage[] = [...basePackages];

  // Add versioned packages from tags
  for (const [version, sha] of versions) {
    for (const basePkg of basePackages) {
      packages.push({
        ...basePkg,
        version,
        dist: {
          type: 'zip',
          url: `${GITHUB_API_BASE}/repos/${owner}/${repo}/zipball/${version}`,
          reference: sha,
        },
      });
    }
  }

  return packages;
}
