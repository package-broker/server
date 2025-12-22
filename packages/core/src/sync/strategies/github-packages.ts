/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// GitHub Packages Composer Registry strategy

import type { SyncResult, ComposerPackage, ComposerPackagesJson } from '../types';
import { COMPOSER_USER_AGENT } from '@package-broker/shared';
import pRetry from 'p-retry';
import { getLogger } from '../../utils/logger';

/**
 * Sync via GitHub Packages Composer Registry (preferred strategy)
 * Single API call returns native Composer packages.json format
 */
export async function syncViaGitHubPackages(
  owner: string,
  token: string,
  targetPackages?: string[]
): Promise<SyncResult> {
  const url = `https://composer.pkg.github.com/${owner}/packages.json`;

  try {
    const response = await pRetry(
      () =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': COMPOSER_USER_AGENT,
          },
        }),
      { retries: 3 }
    );

    // GitHub Packages returns 404 if owner has no packages
    if (response.status === 404) {
      return { success: false, packages: [], error: 'no_packages_registry' };
    }

    if (response.status === 401 || response.status === 403) {
      return { success: false, packages: [], error: 'auth_failed' };
    }

    if (!response.ok) {
      return { success: false, packages: [], error: `http_${response.status}` };
    }

    const packagesJson: ComposerPackagesJson = await response.json();
    const packages = parseComposerPackagesJson(packagesJson, targetPackages);

    return { success: true, packages, strategy: 'github_packages' };
  } catch (error) {
    const logger = getLogger();
    logger.error('GitHub Packages sync error', { owner, url }, error instanceof Error ? error : new Error(String(error)));
    return { success: false, packages: [], error: 'network_error' };
  }
}

/**
 * Parse Composer packages.json structure
 */
function parseComposerPackagesJson(
  data: ComposerPackagesJson,
  filter?: string[]
): ComposerPackage[] {
  const packages: ComposerPackage[] = [];

  for (const [packageName, versions] of Object.entries(data.packages || {})) {
    // Apply filter if specified
    if (filter && !filter.includes(packageName)) {
      continue;
    }

    for (const [version, metadata] of Object.entries(versions)) {
      packages.push({
        name: packageName,
        version,
        dist: metadata.dist,
        require: metadata.require,
        'require-dev': metadata['require-dev'],
        description: metadata.description,
      });
    }
  }

  return packages;
}




