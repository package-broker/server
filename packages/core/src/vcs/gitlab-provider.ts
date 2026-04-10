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

// Only match gitlab.com — self-hosted instances are not supported to prevent SSRF.
// Self-hosted GitLab support would require an explicit allowlist.
const GITLAB_URL_PATTERN = /gitlab\.com[:/]([^/]+(?:\/[^/]+)*)\/([^/.]+)/;

interface GitLabTag {
  name: string;
  commit: { id: string };
}

interface GitLabProject {
  id: number;
  name: string;
  description: string | null;
  web_url: string;
  default_branch: string;
}

export class GitLabProvider implements VcsProviderPort {
  readonly name = 'gitlab';

  async discoverPackages(org: string, token: string, filter?: string): Promise<DiscoveredPackage[]> {
    const logger = getLogger();
    const packages: DiscoveredPackage[] = [];

    // GitLab Groups have a Composer package registry
    const url = `https://gitlab.com/api/v4/groups/${encodeURIComponent(org)}/packages?package_type=composer&per_page=100`;

    try {
      const response = await pRetry(
        () =>
          fetch(url, {
            headers: this.buildHeaders(token),
          }),
        { retries: 3 },
      );

      if (!response.ok) {
        logger.warn('GitLab package discovery failed', { org, status: response.status });
        return [];
      }

      const data = (await response.json()) as Array<{
        name: string;
        version: string;
      }>;

      // Group versions by package name
      const packageMap = new Map<string, string[]>();
      for (const pkg of data) {
        if (filter && !pkg.name.toLowerCase().includes(filter.toLowerCase())) {
          continue;
        }
        const versions = packageMap.get(pkg.name) || [];
        versions.push(pkg.version);
        packageMap.set(pkg.name, versions);
      }

      for (const [name, versions] of packageMap) {
        packages.push({ name, versions, source: 'gitlab_packages' });
      }
    } catch (err) {
      logger.error(
        'GitLab package discovery error',
        { org },
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    return packages;
  }

  async fetchPackageMetadata(repoUrl: string, token: string): Promise<PackageMetadata | null> {
    const { host, projectPath } = this.parseUrl(repoUrl);
    if (!projectPath) return null;

    const apiBase = `https://${host}/api/v4`;
    const encodedPath = encodeURIComponent(projectPath);

    const headers = this.buildHeaders(token);

    try {
      // Fetch project to get default branch (don't assume 'main')
      const projectResponse = await pRetry(
        () => fetch(`${apiBase}/projects/${encodedPath}`, { headers }),
        { retries: 2 },
      );
      const defaultBranch = projectResponse.ok
        ? ((await projectResponse.json()) as GitLabProject).default_branch || 'main'
        : 'main';

      const response = await pRetry(
        () =>
          fetch(`${apiBase}/projects/${encodedPath}/repository/files/composer.json/raw?ref=${encodeURIComponent(defaultBranch)}`, {
            headers,
          }),
        { retries: 2 },
      );

      if (!response.ok) return null;

      const composerJson = (await response.json()) as {
        name?: string;
        description?: string;
      };

      if (!composerJson.name) return null;

      return {
        name: composerJson.name,
        description: composerJson.description,
        versions: {},
      };
    } catch {
      return null;
    }
  }

  async verifyCredentials(url: string, credentialType: string, credentials: string): Promise<boolean> {
    if (credentialType !== 'gitlab_token' && credentialType !== 'none') {
      return false;
    }

    const parsed = this.parseCredentials(credentials);
    const token = parsed.token || '';
    const { host } = this.parseUrl(url);

    try {
      const response = await fetch(`https://${host}/api/v4/user`, {
        headers: this.buildHeaders(token),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sync a GitLab repository by fetching composer.json from the repo and tags for versions.
   */
  async syncRepository(
    url: string,
    credentials: Record<string, string>,
    credentialType: string,
    composerJsonPath?: string,
  ): Promise<SyncResult> {
    const logger = getLogger();
    const { host, projectPath } = this.parseUrl(url);

    if (!projectPath) {
      return { success: false, packages: [], error: 'invalid_gitlab_url' };
    }

    const token = credentialType === 'none' ? '' : credentials.token || '';
    const apiBase = `https://${host}/api/v4`;
    const encodedPath = encodeURIComponent(projectPath);
    const headers = this.buildHeaders(token);

    try {
      // Get project info for default branch
      const projectResponse = await pRetry(
        () => fetch(`${apiBase}/projects/${encodedPath}`, { headers }),
        { retries: 2 },
      );

      if (!projectResponse.ok) {
        if (projectResponse.status === 401 || projectResponse.status === 403) {
          return { success: false, packages: [], error: 'auth_failed' };
        }
        if (projectResponse.status === 404) {
          return { success: false, packages: [], error: 'repo_not_found' };
        }
        return { success: false, packages: [], error: `gitlab_api_${projectResponse.status}` };
      }

      const project = (await projectResponse.json()) as GitLabProject;
      const defaultBranch = project.default_branch || 'main';

      // Fetch composer.json from default branch
      const composerPath = composerJsonPath || 'composer.json';
      const composerResponse = await pRetry(
        () =>
          fetch(
            `${apiBase}/projects/${encodedPath}/repository/files/${encodeURIComponent(composerPath)}/raw?ref=${encodeURIComponent(defaultBranch)}`,
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
      const tagsResponse = await pRetry(
        () =>
          fetch(`${apiBase}/projects/${encodedPath}/repository/tags?per_page=100`, { headers }),
        { retries: 2 },
      );

      const tags: GitLabTag[] = tagsResponse.ok ? ((await tagsResponse.json()) as GitLabTag[]) : [];

      // Build packages from tags
      const packages: ComposerPackage[] = [];

      // Dev branch package
      packages.push({
        name: composerJson.name,
        version: `dev-${defaultBranch}`,
        description: composerJson.description,
        license: composerJson.license,
        type: composerJson.type,
        homepage: composerJson.homepage || project.web_url,
        require: composerJson.require,
        'require-dev': composerJson['require-dev'],
        dist: {
          type: 'zip',
          url: `${apiBase}/projects/${encodedPath}/repository/archive.zip?sha=${encodeURIComponent(defaultBranch)}`,
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
          homepage: composerJson.homepage || project.web_url,
          require: composerJson.require,
          'require-dev': composerJson['require-dev'],
          dist: {
            type: 'zip',
            url: `${apiBase}/projects/${encodedPath}/repository/archive.zip?sha=${encodeURIComponent(tag.name)}`,
            reference: tag.commit.id,
          },
        });
      }

      logger.info('GitLab sync completed', {
        project: projectPath,
        packageCount: packages.length,
        tagCount: tags.length,
      });

      return { success: true, packages, strategy: 'gitlab_api' };
    } catch (err) {
      logger.error(
        'GitLab sync error',
        { project: projectPath },
        err instanceof Error ? err : new Error(String(err)),
      );
      return { success: false, packages: [], error: 'network_error' };
    }
  }

  matchesUrl(url: string): boolean {
    return GITLAB_URL_PATTERN.test(url);
  }

  private parseUrl(url: string): { host: string; projectPath: string | null } {
    const gitlabMatch = url.match(GITLAB_URL_PATTERN);
    if (gitlabMatch) {
      return { host: 'gitlab.com', projectPath: `${gitlabMatch[1]}/${gitlabMatch[2]}` };
    }

    return { host: 'gitlab.com', projectPath: null };
  }

  private buildHeaders(token: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': COMPOSER_USER_AGENT,
    };
    if (token) {
      headers['PRIVATE-TOKEN'] = token;
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
