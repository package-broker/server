/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Composer repository sync strategy

import type { SyncResult, ComposerPackage, ComposerPackagesJson, ProviderFile, ProviderPackageResponse } from '../types';
import { buildAuthHeaders, type CredentialType, COMPOSER_USER_AGENT } from '@package-broker/shared';
import pRetry from 'p-retry';
import { getLogger } from '../../utils/logger';

/**
 * Sync from Composer repository (e.g., Satis, Packagist, third-party)
 * @param url - Repository base URL
 * @param credentialType - Type of authentication
 * @param credentials - Authentication credentials
 * @param packageFilter - Optional comma-separated list of packages to sync (required for provider-includes repos)
 */
export async function syncComposerRepository(
  url: string,
  credentialType: CredentialType,
  credentials: Record<string, string>,
  packageFilter?: string
): Promise<SyncResult> {
  // Build auth headers based on credential type
  const authHeaders = buildAuthHeaders(credentialType, credentials);

  // Normalize URL
  const baseUrl = url.replace(/\/$/, '');
  const packagesUrl = `${baseUrl}/packages.json`;

  try {
    const response = await pRetry(
      () =>
        fetch(packagesUrl, {
          headers: {
            ...authHeaders,
            Accept: 'application/json',
            'User-Agent': COMPOSER_USER_AGENT,
          },
        }),
      { retries: 3 }
    );

    if (response.status === 401 || response.status === 403) {
      return { success: false, packages: [], error: 'auth_failed' };
    }

    if (response.status === 404) {
      return { success: false, packages: [], error: 'packages_json_not_found' };
    }

    if (!response.ok) {
      return { success: false, packages: [], error: `http_${response.status}` };
    }

    const packagesJson: ComposerPackagesJson = await response.json();
    
    // Check if repository uses provider-includes (lazy loading)
    if (packagesJson['providers-url'] && packagesJson['provider-includes']) {
      // Large repository with lazy loading
      return await syncWithProviderIncludes(
        baseUrl,
        packagesJson,
        authHeaders,
        packageFilter
      );
    }

    // Direct packages - parse all
    const packages = parseComposerPackagesJson(packagesJson, baseUrl);

    return { success: true, packages, strategy: 'composer_repo' };
  } catch (error) {
    const logger = getLogger();
    logger.error('Composer repository sync error', { url }, error instanceof Error ? error : new Error(String(error)));
    return { success: false, packages: [], error: 'network_error' };
  }
}

/**
 * Sync packages from a repository using provider-includes (lazy loading)
 * This is used by large repositories like Magento Marketplace
 */
async function syncWithProviderIncludes(
  baseUrl: string,
  packagesJson: ComposerPackagesJson,
  authHeaders: HeadersInit,
  packageFilter?: string
): Promise<SyncResult> {
  const providersUrl = packagesJson['providers-url']!;
  const providerIncludes = packagesJson['provider-includes']!;

  // Parse package filter
  const targetPackages = packageFilter
    ? packageFilter.split(',').map(p => p.trim()).filter(p => p.length > 0)
    : [];

  // If no filter provided, we'll sync all packages from provider files
  const syncAllPackages = targetPackages.length === 0;

  // Step 1: Fetch all provider files to build package-to-hash mapping
  const packageHashes = new Map<string, string>();

  for (const [providerPath, { sha256 }] of Object.entries(providerIncludes)) {
    // Replace %hash% placeholder with actual hash
    const providerUrl = `${baseUrl}/${providerPath.replace('%hash%', sha256)}`;

    try {
      const response = await pRetry(
        () =>
          fetch(providerUrl, {
            headers: {
              ...authHeaders,
              Accept: 'application/json',
              'User-Agent': COMPOSER_USER_AGENT,
            },
          }),
        { retries: 2 }
      );

      if (!response.ok) {
        const logger = getLogger();
        logger.warn('Failed to fetch provider file', { providerUrl, status: response.status });
        continue;
      }

      const providerData: ProviderFile = await response.json();

      // Extract package hashes - all packages if no filter, or only filtered packages
      for (const [pkgName, { sha256: pkgHash }] of Object.entries(providerData.providers || {})) {
        if (syncAllPackages || targetPackages.includes(pkgName)) {
          packageHashes.set(pkgName, pkgHash);
        }
      }
    } catch (error) {
      const logger = getLogger();
      logger.warn('Error fetching provider file', { providerUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Log sync strategy
  const logger = getLogger();
  if (syncAllPackages) {
    logger.info('Syncing all packages from provider-includes', { packageCount: packageHashes.size });
  } else {
    logger.info('Syncing filtered packages via provider-includes', { targetCount: targetPackages.length });
    // Check if we found all requested packages (only when filtering)
    const missingPackages = targetPackages.filter(pkg => !packageHashes.has(pkg));
    if (missingPackages.length > 0) {
      logger.warn('Some packages not found in provider files', { missingPackages });
    }
  }

  if (packageHashes.size === 0) {
    return {
      success: false,
      packages: [],
      error: 'no_packages_found',
    };
  }

  // Step 2: Fetch metadata for each package using providers-url
  const allPackages: ComposerPackage[] = [];

  for (const [packageName, packageHash] of packageHashes) {
    // Build package URL from providers-url template
    // Format: /p/%package%$%hash%.json
    const packageUrl = `${baseUrl}${providersUrl
      .replace('%package%', packageName)
      .replace('%hash%', packageHash)}`;

    try {
      const response = await pRetry(
        () =>
          fetch(packageUrl, {
            headers: {
              ...authHeaders,
              Accept: 'application/json',
              'User-Agent': COMPOSER_USER_AGENT,
            },
          }),
        { retries: 2 }
      );

      if (!response.ok) {
        const logger = getLogger();
        logger.warn('Failed to fetch package metadata', { packageUrl, status: response.status });
        continue;
      }

      const packageData: ProviderPackageResponse = await response.json();
      
      // Parse package versions - handle both array format (Packagist p2) and object format (traditional repos)
      const packageVersions = packageData.packages?.[packageName] || {};
      
      // Normalize versions to handle both array and object formats
      const versionsArray = Array.isArray(packageVersions)
        ? packageVersions.map((metadata) => ({ version: metadata.version || String(metadata), metadata }))
        : Object.entries(packageVersions).map(([key, val]) => ({
            version: (val as any)?.version || key,
            metadata: val,
          }));
      
      for (const { version, metadata } of versionsArray) {
        // Transform dist URL to absolute URL
        let distUrl = resolveDistUrl(baseUrl, metadata.dist?.url, packageName, version);

        allPackages.push({
          name: packageName,
          version,
          time: metadata.time,
          description: metadata.description,
          license: metadata.license,
          type: metadata.type,
          homepage: metadata.homepage,
          dist: distUrl
            ? {
                type: metadata.dist?.type || 'zip',
                url: distUrl,
                reference: metadata.dist?.reference,
              }
            : undefined,
          require: metadata.require,
          'require-dev': metadata['require-dev'],
        });
      }

      const logger = getLogger();
      logger.info('Fetched package versions', { packageName, versionCount: Object.keys(packageVersions).length });
    } catch (error) {
      const logger = getLogger();
      logger.warn('Error fetching package', { packageName, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (allPackages.length === 0) {
    return {
      success: false,
      packages: [],
      error: 'no_package_versions_found',
    };
  }

  return {
    success: true,
    packages: allPackages,
    strategy: 'composer_repo_providers',
  };
}

/**
 * Resolve dist URL to an absolute URL
 * Handles: absolute URLs, protocol-relative URLs, relative paths, and constructs fallback archive URLs
 */
function resolveDistUrl(
  baseUrl: string,
  rawUrl: string | undefined,
  packageName: string,
  version: string
): string | undefined {
  // If we have a valid absolute URL, use it
  if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
    return rawUrl;
  }

  // Handle protocol-relative URLs (//example.com/path)
  if (rawUrl && rawUrl.startsWith('//')) {
    return `https:${rawUrl}`;
  }

  // Handle relative URLs starting with /
  if (rawUrl && rawUrl.startsWith('/')) {
    // Remove trailing slash from baseUrl to avoid double slashes
    return `${baseUrl}${rawUrl}`;
  }

  // Handle other relative URLs
  if (rawUrl && rawUrl.length > 0) {
    return `${baseUrl}/${rawUrl}`;
  }

  // No dist URL provided - try to construct archive URL for Magento Marketplace format
  // Format: /archives/vendor/package/vendor-package-version.zip
  if (baseUrl.includes('repo.magento.com')) {
    const [vendor, pkg] = packageName.split('/');
    if (vendor && pkg) {
      // Magento archive format: /archives/vendor/package/vendor-package-version.zip
      // Version format may need adjustment (remove 'v' prefix if present, handle dev versions)
      const cleanVersion = version.replace(/^v/, '');
      return `${baseUrl}/archives/${vendor}/${pkg}/${vendor}-${pkg}-${cleanVersion}.zip`;
    }
  }

  // No URL could be constructed
  const logger = getLogger();
  logger.warn('No dist URL available', { packageName, version, baseUrl });
  return undefined;
}

/**
 * Parse Composer packages.json and transform dist URLs if needed
 */
function parseComposerPackagesJson(
  data: ComposerPackagesJson,
  baseUrl: string
): ComposerPackage[] {
  const packages: ComposerPackage[] = [];

  for (const [packageName, versions] of Object.entries(data.packages || {})) {
    // Normalize versions to handle both array format (Packagist p2) and object format (traditional repos)
    const versionsArray = Array.isArray(versions)
      ? versions.map((metadata) => ({ version: metadata.version || String(metadata), metadata }))
      : Object.entries(versions).map(([key, val]) => ({
          version: (val as any)?.version || key,
          metadata: val,
        }));
    
    for (const { version, metadata } of versionsArray) {
      // Transform dist URL to absolute URL
      const distUrl = resolveDistUrl(baseUrl, metadata.dist?.url, packageName, version);

      packages.push({
        name: packageName,
        version,
        time: metadata.time,
        description: metadata.description,
        license: metadata.license,
        type: metadata.type,
        homepage: metadata.homepage,
        dist: distUrl
          ? {
              type: metadata.dist?.type || 'zip',
              url: distUrl,
              reference: metadata.dist?.reference,
            }
          : undefined,
        require: metadata.require,
        'require-dev': metadata['require-dev'],
      });
    }
  }

  return packages;
}
