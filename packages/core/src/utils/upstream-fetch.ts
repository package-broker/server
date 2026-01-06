/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * Utility for fetching package metadata from upstream repositories.
 * 
 * Supports:
 * - Composer repositories (Satis, Private Packagist, etc.)
 * - GitHub repositories (public and private)
 * 
 * Designed to be extended for webhook integration (Issue #31).
 */

import { buildAuthHeaders, type CredentialType, COMPOSER_USER_AGENT } from '@package-broker/shared';
import type { ComposerPackagesJson, ProviderFile, ProviderPackageResponse, ComposerPackage } from '../sync/types';

// HeadersInit type for node environments
type HeadersInit = Record<string, string> | [string, string][] | Headers;
import { decryptCredentials } from './encryption';
import { getLogger } from './logger';
import pRetry from 'p-retry';
import semver from 'semver';

const GITHUB_API_BASE = 'https://api.github.com';

export interface UpstreamRepository {
  id: string;
  url: string;
  vcs_type: string;
  credential_type: string;
  auth_credentials: string;
  package_filter?: string | null;
}

/**
 * Fetch package metadata from an upstream Composer repository
 * Supports both direct packages.json and provider-includes/providers-lazy-url
 */
export async function fetchPackageFromUpstream(
  repo: UpstreamRepository,
  packageName: string,
  encryptionKey: string
): Promise<ProviderPackageResponse | null> {
  const credentialsJson = JSON.parse(
    await decryptCredentials(repo.auth_credentials, encryptionKey)
  );
  
  const authHeaders = buildAuthHeaders(
    repo.credential_type as CredentialType,
    credentialsJson
  );
  
  const baseUrl = repo.url.replace(/\/$/, '');
  
  // First, get packages.json to understand repository structure
  const packagesJsonUrl = `${baseUrl}/packages.json`;
  const packagesRes = await pRetry(
    () =>
      fetch(packagesJsonUrl, {
        headers: {
          ...authHeaders,
          Accept: 'application/json',
          'User-Agent': COMPOSER_USER_AGENT,
        },
      }),
    { retries: 2 }
  );
  
  if (!packagesRes.ok) {
    return null;
  }
  
  const packagesJson: ComposerPackagesJson = await packagesRes.json();
  
  // Check if uses providers-lazy-url (Composer 2 - preferred)
  if (packagesJson['providers-lazy-url']) {
    const lazyUrl = packagesJson['providers-lazy-url']
      .replace('%package%', packageName);
    const res = await pRetry(
      () =>
        fetch(`${baseUrl}${lazyUrl}`, {
          headers: {
            ...authHeaders,
            Accept: 'application/json',
            'User-Agent': COMPOSER_USER_AGENT,
          },
        }),
      { retries: 2 }
    );
    
    if (res.ok) {
      return await res.json();
    }
    return null;
  }
  
  // Check if uses provider-includes (Composer 1)
  if (packagesJson['providers-url'] && packagesJson['provider-includes']) {
    return await fetchFromProviderIncludes(
      baseUrl,
      packagesJson,
      packageName,
      authHeaders
    );
  }
  
  // Direct packages - look in packages.json
  if (packagesJson.packages?.[packageName]) {
    return {
      packages: {
        [packageName]: packagesJson.packages[packageName],
      },
    };
  }
  
  return null;
}

/**
 * Fetch package metadata using provider-includes pattern
 */
async function fetchFromProviderIncludes(
  baseUrl: string,
  packagesJson: ComposerPackagesJson,
  packageName: string,
  authHeaders: HeadersInit
): Promise<ProviderPackageResponse | null> {
  const providersUrl = packagesJson['providers-url']!;
  const providerIncludes = packagesJson['provider-includes']!;
  
  // Find which provider file contains this package
  for (const [providerPath, { sha256 }] of Object.entries(providerIncludes)) {
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
        continue;
      }
      
      const providerData: ProviderFile = await response.json();
      
      // Check if this provider file contains our package
      if (providerData.providers?.[packageName]) {
        const packageHash = providerData.providers[packageName].sha256;
        
        // Fetch package metadata using providers-url
        const packageUrl = `${baseUrl}${providersUrl
          .replace('%package%', packageName)
          .replace('%hash%', packageHash)}`;
        
        const packageRes = await pRetry(
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
        
        if (packageRes.ok) {
          return await packageRes.json();
        }
      }
    } catch (error) {
      console.warn(`Error fetching provider file ${providerUrl}:`, error);
      continue;
    }
  }
  
  return null;
}

/**
 * Fetch package metadata from a GitHub repository.
 * 
 * This function:
 * 1. Parses the GitHub URL to extract owner/repo
 * 2. Fetches composer.json from the repository
 * 3. Checks if the package name matches
 * 4. Fetches all tags to build version list
 * 5. Returns Composer-compatible package response
 * 
 * @param repo - Repository configuration
 * @param packageName - Package name to fetch (e.g., "weltpixel/magento2-weltpixel-social-login")
 * @param encryptionKey - Key for decrypting credentials
 */
export async function fetchPackageFromGitHub(
  repo: UpstreamRepository,
  packageName: string,
  encryptionKey: string
): Promise<ProviderPackageResponse | null> {
  const logger = getLogger();
  
  // Parse GitHub URL
  const urlMatch = repo.url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!urlMatch) {
    logger.warn('Invalid GitHub URL format', { url: repo.url });
    return null;
  }
  
  const [, owner, repoName] = urlMatch;
  const cleanRepoName = repoName.replace('.git', '');
  
  // Get token (null for public repos with 'none' credential type)
  let token: string | null = null;
  if (repo.credential_type !== 'none') {
    const credentialsJson = JSON.parse(
      await decryptCredentials(repo.auth_credentials, encryptionKey)
    );
    token = credentialsJson.token || credentialsJson.password || null;
  }
  
  // Fetch composer.json from default branch
  const composerJson = await fetchGitHubComposerJson(owner, cleanRepoName, token);
  if (!composerJson) {
    logger.debug('No composer.json found in GitHub repo', { owner, repo: cleanRepoName });
    return null;
  }
  
  // Check if package name matches
  if (composerJson.name !== packageName) {
    logger.debug('Package name mismatch', { 
      expected: packageName, 
      found: composerJson.name,
      repo: `${owner}/${cleanRepoName}`
    });
    return null;
  }
  
  // Fetch tags to build version list
  const versions = await fetchGitHubTags(owner, cleanRepoName, token);
  
  // Build package versions
  const packageVersions: Record<string, ComposerPackage> = {};
  
  // Add dev-main/dev-master version
  const defaultBranch = 'main'; // TODO: Could fetch this from repo API
  packageVersions[`dev-${defaultBranch}`] = {
    name: composerJson.name,
    version: `dev-${defaultBranch}`,
    description: composerJson.description,
    license: composerJson.license,
    type: composerJson.type,
    homepage: composerJson.homepage,
    require: composerJson.require,
    'require-dev': composerJson['require-dev'],
    dist: {
      type: 'zip',
      url: `${GITHUB_API_BASE}/repos/${owner}/${cleanRepoName}/zipball/${defaultBranch}`,
      reference: defaultBranch,
    },
  };
  
  // Add tagged versions
  for (const [version, sha] of versions) {
    packageVersions[version] = {
      name: composerJson.name,
      version,
      description: composerJson.description,
      license: composerJson.license,
      type: composerJson.type,
      homepage: composerJson.homepage,
      require: composerJson.require,
      'require-dev': composerJson['require-dev'],
      dist: {
        type: 'zip',
        url: `${GITHUB_API_BASE}/repos/${owner}/${cleanRepoName}/zipball/${version}`,
        reference: sha,
      },
    };
  }
  
  logger.info('Fetched package from GitHub', {
    packageName,
    repo: `${owner}/${cleanRepoName}`,
    versionCount: Object.keys(packageVersions).length,
    isPublic: !token,
  });
  
  return {
    packages: {
      [packageName]: packageVersions,
    },
  };
}

/**
 * Fetch composer.json from a GitHub repository's default branch
 */
async function fetchGitHubComposerJson(
  owner: string,
  repo: string,
  token: string | null
): Promise<ComposerPackage | null> {
  const headers = buildGitHubHeaders(token, 'application/vnd.github.raw+json');
  
  // Try main branch first, then master
  for (const branch of ['main', 'master']) {
    try {
      const response = await pRetry(
        () => fetch(
          `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/composer.json?ref=${branch}`,
          { headers }
        ),
        { retries: 2 }
      );
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // Continue to next branch
    }
  }
  
  return null;
}

/**
 * Fetch tags from a GitHub repository
 */
async function fetchGitHubTags(
  owner: string,
  repo: string,
  token: string | null
): Promise<Map<string, string>> {
  const headers = buildGitHubHeaders(token);
  const versions = new Map<string, string>();
  
  try {
    const response = await pRetry(
      () => fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/tags?per_page=100`, { headers }),
      { retries: 2 }
    );
    
    if (!response.ok) {
      return versions;
    }
    
    const tags: Array<{ name: string; commit: { sha: string } }> = await response.json();
    
    for (const tag of tags) {
      // Parse tag name as semver (e.g., "v1.2.3" → "1.2.3")
      const version = semver.clean(tag.name) || tag.name;
      if (semver.valid(version)) {
        versions.set(version, tag.commit.sha);
      }
    }
  } catch (error) {
    const logger = getLogger();
    logger.warn('Error fetching GitHub tags', { owner, repo });
  }
  
  return versions;
}

/**
 * Build GitHub API headers with optional authentication
 */
function buildGitHubHeaders(
  token: string | null, 
  accept: string = 'application/vnd.github+json'
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'PackageBroker/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}
