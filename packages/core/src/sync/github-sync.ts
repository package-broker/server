/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * Combined GitHub sync orchestrator with strategy selection.
 * 
 * Supports:
 * - Authenticated sync via GitHub Packages Registry (single API call)
 * - Authenticated sync via GitHub Repository API (tree enumeration)
 * - Unauthenticated sync for public repositories (token = null)
 * 
 * Designed to be extended for webhook integration (Issue #31).
 */

import type { SyncResult } from './types';
import { syncViaGitHubPackages } from './strategies/github-packages';
import { syncViaGitHubApi } from './strategies/github-api';

export interface GitHubRepositoryConfig {
  owner: string;
  repo?: string;
  /** GitHub token - null for public repositories (no auth) */
  token: string | null;
  branch?: string;
  composerJsonPath?: string;
}

/**
 * Sync GitHub repository using strategy selection:
 * 
 * For authenticated requests (token provided):
 * 1. Primary: Try GitHub Packages Composer Registry (single API call)
 * 2. Fallback: Use GitHub Repository API (tree enumeration)
 * 
 * For public repositories (token = null):
 * - Use GitHub Repository API directly (no Packages Registry access)
 */
export async function syncGitHubRepository(
  config: GitHubRepositoryConfig
): Promise<SyncResult> {
  const { owner, repo, token, composerJsonPath } = config;

  // For authenticated owner-level sync, try GitHub Packages first
  if (!repo && token) {
    const packagesResult = await syncViaGitHubPackages(owner, token);
    if (packagesResult.success) {
      return {
        success: true,
        packages: packagesResult.packages,
        strategy: 'github_packages',
      };
    }
    // If Packages failed and no specific repo, return error
    return packagesResult;
  }

  // Owner-level sync without token is not supported
  if (!repo) {
    return {
      success: false,
      packages: [],
      error: 'repo_required_for_public_sync',
    };
  }

  // Use Repository API (works for both authenticated and public repos)
  const apiResult = await syncViaGitHubApi(
    owner,
    repo,
    token, // null for public repos
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
