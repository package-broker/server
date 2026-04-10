/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { VcsProviderPort, DiscoveredPackage, PackageMetadata } from '../ports';
import type { SyncResult } from '../sync/types';
import { syncGitHubRepository } from '../sync/github-sync';
import { COMPOSER_USER_AGENT } from '@package-broker/shared';
import pRetry from 'p-retry';

const GITHUB_URL_PATTERN = /github\.com[:/]([^/]+)\/([^/.]+)/;

export class GitHubProvider implements VcsProviderPort {
  readonly name = 'github';

  async discoverPackages(org: string, token: string, filter?: string): Promise<DiscoveredPackage[]> {
    const url = `https://composer.pkg.github.com/${encodeURIComponent(org)}/packages.json`;

    const response = await pRetry(
      () =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': COMPOSER_USER_AGENT,
          },
        }),
      { retries: 3 },
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      packages?: Record<string, Record<string, unknown>>;
    };

    const packages: DiscoveredPackage[] = [];
    for (const [name, versions] of Object.entries(data.packages || {})) {
      if (filter && !name.toLowerCase().includes(filter.toLowerCase())) {
        continue;
      }
      packages.push({ name, versions: Object.keys(versions), source: 'github_packages' });
    }

    return packages;
  }

  async fetchPackageMetadata(repoUrl: string, token: string): Promise<PackageMetadata | null> {
    const match = repoUrl.match(GITHUB_URL_PATTERN);
    if (!match) return null;

    const [, owner, repo] = match;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'PackageBroker/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await pRetry(
      () =>
        fetch(`https://api.github.com/repos/${owner}/${repo}/contents/composer.json`, {
          headers,
        }),
      { retries: 2 },
    );

    if (!response.ok) return null;

    const composerJson = (await response.json()) as {
      name?: string;
      description?: string;
      version?: string;
    };

    if (!composerJson.name) return null;

    return {
      name: composerJson.name,
      description: composerJson.description,
      versions: {},
    };
  }

  async verifyCredentials(url: string, credentialType: string, credentials: string): Promise<boolean> {
    if (credentialType !== 'github_token' && credentialType !== 'none') {
      return false;
    }

    const parsed = this.parseCredentials(credentials);
    const token = parsed.token || '';

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'PackageBroker/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const match = url.match(GITHUB_URL_PATTERN);
      const apiUrl = match
        ? `https://api.github.com/repos/${match[1]}/${match[2]}`
        : 'https://api.github.com/user';

      const response = await fetch(apiUrl, { headers });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sync a GitHub repository using the existing strategy-based sync.
   * This bridges the VcsProviderPort interface with the current sync implementation.
   */
  async syncRepository(
    url: string,
    credentials: Record<string, string>,
    credentialType: string,
    composerJsonPath?: string,
  ): Promise<SyncResult> {
    const match = url.match(GITHUB_URL_PATTERN);
    if (!match) {
      return { success: false, packages: [], error: 'invalid_github_url' };
    }

    const [, owner, repo] = match;
    const token =
      credentialType === 'none' ? null : credentials.token || credentials.password || '';

    return syncGitHubRepository({
      owner,
      repo: repo.replace('.git', ''),
      token,
      composerJsonPath,
    });
  }

  matchesUrl(url: string): boolean {
    return GITHUB_URL_PATTERN.test(url);
  }

  private parseCredentials(credentials: string): Record<string, string> {
    try {
      return JSON.parse(credentials);
    } catch {
      return { token: credentials };
    }
  }
}
