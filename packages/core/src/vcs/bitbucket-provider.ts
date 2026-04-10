/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { VcsProviderPort, DiscoveredPackage, PackageMetadata } from '../ports';
import type { SyncResult, ComposerPackage } from '../sync/types';
import { COMPOSER_USER_AGENT } from '@package-broker/shared';
import pRetry from 'p-retry';
import { getLogger } from '../utils/logger';
import semver from 'semver';

const BITBUCKET_CLOUD_PATTERN = /bitbucket\.org\/([^/]+)\/([^/.]+)/;

interface BitbucketTag {
  name: string;
  target: { hash: string; date?: string };
}

interface BitbucketPaginatedResponse<T> {
  values: T[];
  next?: string;
  page?: number;
  size?: number;
}

interface BitbucketRepository {
  slug: string;
  full_name: string;
  description: string;
  mainbranch?: { name: string };
  links: { html: { href: string } };
}

export class BitbucketProvider implements VcsProviderPort {
  readonly name = 'bitbucket';

  async discoverPackages(org: string, token: string, filter?: string): Promise<DiscoveredPackage[]> {
    const logger = getLogger();
    const packages: DiscoveredPackage[] = [];

    try {
      // List repositories in the workspace
      const repos = await this.listWorkspaceRepos(org, token);

      for (const repo of repos) {
        // Check if repo has a composer.json
        const composerJson = await this.fetchComposerJson(org, repo.slug, token);
        if (!composerJson?.name) continue;

        if (filter && !composerJson.name.toLowerCase().includes(filter.toLowerCase())) {
          continue;
        }

        // Get tags as versions
        const tags = await this.fetchTags(org, repo.slug, { token });
        const versions = tags
          .map((tag: BitbucketTag) => semver.clean(tag.name) || tag.name)
          .filter((v: string) => semver.valid(v));

        packages.push({
          name: composerJson.name,
          versions,
          source: 'bitbucket_api',
        });
      }
    } catch (err) {
      logger.error(
        'Bitbucket package discovery error',
        { org },
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    return packages;
  }

  async fetchPackageMetadata(repoUrl: string, token: string): Promise<PackageMetadata | null> {
    const match = repoUrl.match(BITBUCKET_CLOUD_PATTERN);
    if (!match) return null;

    const [, workspace, repoSlug] = match;
    const composerJson = await this.fetchComposerJson(workspace, repoSlug, token);

    if (!composerJson?.name) return null;

    return {
      name: composerJson.name,
      description: composerJson.description,
      versions: {},
    };
  }

  async verifyCredentials(url: string, credentialType: string, credentials: string): Promise<boolean> {
    const validTypes = [
      'bitbucket_app_password',
      'bitbucket_api_token',
      'bitbucket_api_key',
      'bitbucket_server_pat',
      'none',
    ];
    if (!validTypes.includes(credentialType)) {
      return false;
    }

    const parsed = this.parseCredentials(credentials);
    const headers = this.buildHeaders(credentialType, parsed);

    try {
      const response = await fetch('https://api.bitbucket.org/2.0/user', { headers });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sync a Bitbucket repository by fetching composer.json and discovering versions via tags.
   */
  async syncRepository(
    url: string,
    credentials: Record<string, string>,
    credentialType: string,
    composerJsonPath?: string,
  ): Promise<SyncResult> {
    const logger = getLogger();
    const match = url.match(BITBUCKET_CLOUD_PATTERN);

    if (!match) {
      return { success: false, packages: [], error: 'invalid_bitbucket_url' };
    }

    const [, workspace, repoSlug] = match;
    const headers = this.buildHeaders(credentialType, credentials);

    try {
      // Get repo info for default branch
      const repoResponse = await pRetry(
        () =>
          fetch(`https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`, {
            headers,
          }),
        { retries: 2 },
      );

      if (!repoResponse.ok) {
        if (repoResponse.status === 401 || repoResponse.status === 403) {
          return { success: false, packages: [], error: 'auth_failed' };
        }
        if (repoResponse.status === 404) {
          return { success: false, packages: [], error: 'repo_not_found' };
        }
        return { success: false, packages: [], error: `bitbucket_api_${repoResponse.status}` };
      }

      const repoInfo = (await repoResponse.json()) as BitbucketRepository;
      const defaultBranch = repoInfo.mainbranch?.name || 'main';

      // Fetch composer.json
      const composerPath = composerJsonPath || 'composer.json';
      const composerResponse = await pRetry(
        () =>
          fetch(
            `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/src/${encodeURIComponent(defaultBranch)}/${encodeURIComponent(composerPath)}`,
            { headers },
          ),
        { retries: 2 },
      );

      if (!composerResponse.ok) {
        return { success: false, packages: [], error: 'no_composer_json_found' };
      }

      const composerJson = (await composerResponse.json()) as {
        name?: string;
        version?: string;
        description?: string;
        license?: string | string[];
        type?: string;
        homepage?: string;
        require?: Record<string, string>;
        'require-dev'?: Record<string, string>;
      };

      if (!composerJson.name) {
        return { success: false, packages: [], error: 'no_valid_composer_json' };
      }

      // Fetch tags for version discovery
      const tags = await this.fetchTags(workspace, repoSlug, credentials, credentialType);

      const packages: ComposerPackage[] = [];

      // Dev branch package
      packages.push({
        name: composerJson.name,
        version: `dev-${defaultBranch}`,
        description: composerJson.description,
        license: composerJson.license,
        type: composerJson.type,
        homepage: composerJson.homepage || repoInfo.links.html.href,
        require: composerJson.require,
        'require-dev': composerJson['require-dev'],
        dist: {
          type: 'zip',
          url: `https://bitbucket.org/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/get/${encodeURIComponent(defaultBranch)}.zip`,
          reference: defaultBranch,
        },
      });

      // Tagged version packages
      for (const tag of tags) {
        const version = semver.clean(tag.name) || tag.name;
        if (!semver.valid(version)) continue;

        packages.push({
          name: composerJson.name,
          version,
          description: composerJson.description,
          license: composerJson.license,
          type: composerJson.type,
          homepage: composerJson.homepage || repoInfo.links.html.href,
          require: composerJson.require,
          'require-dev': composerJson['require-dev'],
          dist: {
            type: 'zip',
            url: `https://bitbucket.org/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/get/${encodeURIComponent(tag.name)}.zip`,
            reference: tag.target.hash,
          },
          time: tag.target.date,
        });
      }

      logger.info('Bitbucket sync completed', {
        workspace,
        repo: repoSlug,
        packageCount: packages.length,
        tagCount: tags.length,
      });

      return { success: true, packages, strategy: 'bitbucket_api' };
    } catch (err) {
      logger.error(
        'Bitbucket sync error',
        { workspace, repo: repoSlug },
        err instanceof Error ? err : new Error(String(err)),
      );
      return { success: false, packages: [], error: 'network_error' };
    }
  }

  matchesUrl(url: string): boolean {
    return BITBUCKET_CLOUD_PATTERN.test(url);
  }

  private async listWorkspaceRepos(
    workspace: string,
    token: string,
  ): Promise<BitbucketRepository[]> {
    const headers = this.buildHeaders('bitbucket_app_password', { token });
    const response = await pRetry(
      () =>
        fetch(
          `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}?pagelen=100`,
          { headers },
        ),
      { retries: 2 },
    );

    if (!response.ok) return [];

    const data = (await response.json()) as BitbucketPaginatedResponse<BitbucketRepository>;
    return data.values;
  }

  private async fetchComposerJson(
    workspace: string,
    repoSlug: string,
    token: string,
    credentialType: string = 'bitbucket_app_password',
  ): Promise<{ name?: string; description?: string } | null> {
    const headers = this.buildHeaders(credentialType, { token });

    try {
      const response = await pRetry(
        () =>
          fetch(
            `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/src/HEAD/composer.json`,
            { headers },
          ),
        { retries: 2 },
      );

      if (!response.ok) return null;

      return (await response.json()) as { name?: string; description?: string };
    } catch {
      return null;
    }
  }

  private async fetchTags(
    workspace: string,
    repoSlug: string,
    credentials: Record<string, string>,
    credentialType: string = 'bitbucket_app_password',
  ): Promise<BitbucketTag[]> {
    const headers = this.buildHeaders(credentialType, credentials);

    try {
      const response = await pRetry(
        () =>
          fetch(
            `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/tags?pagelen=100`,
            { headers },
          ),
        { retries: 2 },
      );

      if (!response.ok) return [];

      const data = (await response.json()) as BitbucketPaginatedResponse<BitbucketTag>;
      return data.values;
    } catch {
      return [];
    }
  }

  private buildHeaders(
    credentialType: string,
    credentials: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': COMPOSER_USER_AGENT,
    };

    switch (credentialType) {
      case 'bitbucket_app_password': {
        const username = credentials.username || '';
        const password = credentials.password || credentials.token || '';
        if (username && password) {
          headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
        }
        break;
      }
      case 'bitbucket_api_token':
      case 'bitbucket_server_pat': {
        const token = credentials.token || '';
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        break;
      }
      case 'bitbucket_api_key': {
        const key = credentials.key || '';
        if (key) {
          headers['Authorization'] = `Basic ${btoa(`${key}:`)}`;
        }
        break;
      }
      case 'none':
        break;
    }

    return headers;
  }

  private parseCredentials(credentials: string): Record<string, string> {
    try {
      return JSON.parse(credentials);
    } catch {
      return { token: credentials };
    }
  }
}
