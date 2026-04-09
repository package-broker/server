/* PACKAGE.broker - Copyright (C) 2025 Łukasz Bajsarowicz - Licensed under AGPL-3.0 */

import { COMPOSER_USER_AGENT } from '@package-broker/shared';

export interface DiscoveredPackage {
  name: string;
  versions: string[];
  source: 'github_packages' | 'github_api';
}

export interface DiscoveryResult {
  packages: DiscoveredPackage[];
  dry_run: boolean;
  errors: string[];
}

export class GitHubOrgImporter {
  private readonly org: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;

  constructor(org: string, token: string, fetchFn: typeof fetch = fetch) {
    this.org = org;
    this.token = token;
    this.fetchFn = fetchFn;
  }

  async discover(options?: { dryRun?: boolean; filter?: string }): Promise<DiscoveryResult> {
    const errors: string[] = [];
    const packages: DiscoveredPackage[] = [];

    const url = `https://composer.pkg.github.com/${encodeURIComponent(this.org)}/packages.json`;

    try {
      const response = await this.fetchFn(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'User-Agent': COMPOSER_USER_AGENT,
        },
      });

      if (response.ok) {
        const data = await response.json() as { packages?: Record<string, Record<string, unknown>> };

        for (const [name, versions] of Object.entries(data.packages || {})) {
          if (options?.filter && !name.toLowerCase().includes(options.filter.toLowerCase())) {
            continue;
          }

          packages.push({
            name,
            versions: Object.keys(versions),
            source: 'github_packages',
          });
        }
      } else {
        errors.push(`GitHub Packages registry returned ${response.status}`);
      }
    } catch (err) {
      errors.push(`Failed to fetch GitHub Packages: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      packages,
      dry_run: options?.dryRun ?? false,
      errors,
    };
  }
}
