// Combined GitHub sync with two-tier strategy

import type { SyncResult } from './types';
import { syncViaGitHubPackages } from './strategies/github-packages';
import { syncViaGitHubApi } from './strategies/github-api';

export interface GitHubRepositoryConfig {
  owner: string;
  repo?: string;
  token: string;
  branch?: string;
  composerJsonPath?: string;
}

/**
 * Sync GitHub repository using two-tier strategy:
 * 1. Primary: Try GitHub Packages Composer Registry (single API call)
 * 2. Fallback: Use GitHub Repository API (tree enumeration)
 */
export async function syncGitHubRepository(
  config: GitHubRepositoryConfig
): Promise<SyncResult> {
  const { owner, repo, token, composerJsonPath } = config;

  // Strategy 1: Try GitHub Packages first (if owner-level sync)
  if (!repo) {
    const packagesResult = await syncViaGitHubPackages(owner, token);
    if (packagesResult.success) {
      return {
        success: true,
        packages: packagesResult.packages,
        strategy: 'github_packages',
      };
    }
    // If Packages failed, return error (no repo to fall back to)
    return packagesResult;
  }

  // Strategy 2: Fall back to Repository API
  const apiResult = await syncViaGitHubApi(
    owner,
    repo,
    token,
    config.branch || 'main',
    composerJsonPath || '**/composer.json'
  );

  if (apiResult.success) {
    return {
      success: true,
      packages: apiResult.packages,
      strategy: 'github_api',
    };
  }

  return {
    success: false,
    packages: [],
    error: apiResult.error,
  };
}




