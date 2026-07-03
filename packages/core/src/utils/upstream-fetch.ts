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

/**
 * Allowed GitHub hostnames for security validation.
 * This prevents URL substring attacks like "github.com.evil.com"
 */
const ALLOWED_GITHUB_HOSTNAMES = ['github.com', 'www.github.com'];

/**
 * Safely check if a URL is a valid GitHub repository URL.
 * Uses proper URL parsing and hostname validation to prevent security issues.
 * 
 * @param url - The URL to validate
 * @returns true if the URL is a valid GitHub URL, false otherwise
 */
export function isGitHubUrl(url: string): boolean {
  try {
    // Handle URLs without scheme (e.g., "github.com/owner/repo")
    const urlWithScheme = url.startsWith('http://') || url.startsWith('https://') 
      ? url 
      : `https://${url}`;
    
    const parsed = new URL(urlWithScheme);
    return ALLOWED_GITHUB_HOSTNAMES.includes(parsed.hostname.toLowerCase());
  } catch {
    // If URL parsing fails, it's not a valid URL
    return false;
  }
}

/**
 * Safely check if a URL is a valid SSH git URL (git@host:path format).
 * Uses proper hostname validation to prevent security issues.
 * 
 * @param url - The SSH URL to validate (e.g., "git@github.com:owner/repo.git")
 * @returns true if the URL is a valid SSH git URL with allowed hostname, false otherwise
 */
export function isSshGitUrl(url: string): boolean {
  try {
    // Check for SSH format: git@host:path
    if (url.startsWith('git@')) {
      // Parse git@host:path format
      const match = url.match(/^git@([^:]+):(.+)$/);
      if (!match) {
        return false;
      }
      const [, hostname] = match;
      // Validate hostname against allowed list
      return ALLOWED_GITHUB_HOSTNAMES.includes(hostname.toLowerCase());
    }
    
    // Check for ssh:// format: ssh://git@host/path
    if (url.startsWith('ssh://')) {
      try {
        const parsed = new URL(url);
        // Extract hostname from ssh://git@host format
        const hostname = parsed.hostname || parsed.host.split('@').pop() || '';
        return ALLOWED_GITHUB_HOSTNAMES.includes(hostname.toLowerCase());
      } catch {
        return false;
      }
    }
    
    // If it's an HTTPS URL, validate it using isGitHubUrl
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return isGitHubUrl(url);
    }
    
    return false;
  } catch {
    return false;
  }
}

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

  if (baseUrl === 'https://repo.packagist.org') {
    return fetchFullPackageFromPackagist(packageName);
  }
  
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
  
  // Check if uses provider-includes (Composer 1 lazy loading)
  if (packagesJson['providers-url'] && packagesJson['provider-includes']) {
    return await fetchFromProviderIncludes(
      baseUrl,
      packagesJson,
      packageName,
      authHeaders
    );
  }

  // Check if uses "includes" format (Composer 1 bundled format - used by Mirasvit, etc.)
  if (packagesJson['includes']) {
    return await fetchFromIncludes(
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

export async function fetchFullPackageFromPackagist(
  packageName: string
): Promise<ProviderPackageResponse | null> {
  const response = await pRetry(
    () =>
      fetch(`https://packagist.org/packages/${packageName}.json`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': COMPOSER_USER_AGENT,
        },
      }),
    { retries: 2 }
  );

  if (!response.ok) {
    return null;
  }

  const packageData = await response.json() as {
    package?: {
      versions?: Record<string, ComposerPackage>;
    };
  };
  const versions = packageData.package?.versions;

  if (!versions || Object.keys(versions).length === 0) {
    return null;
  }

  return {
    packages: {
      [packageName]: versions,
    },
  };
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
 * Fetch package metadata using Composer 1 "includes" format.
 * 
 * This format bundles all packages into include files (used by Mirasvit, etc.).
 * The packages.json contains:
 * {
 *   "packages": [],
 *   "includes": {
 *     "path/to/include$hash.json": { "sha1": "..." }
 *   }
 * }
 * 
 * Each include file contains all packages bundled together.
 */
async function fetchFromIncludes(
  baseUrl: string,
  packagesJson: ComposerPackagesJson,
  packageName: string,
  authHeaders: HeadersInit
): Promise<ProviderPackageResponse | null> {
  const includes = packagesJson['includes']!;
  
  // Fetch each include file and look for the package
  for (const [includePath, { sha1 }] of Object.entries(includes)) {
    // Replace $hash placeholder with actual hash if present
    const resolvedPath = includePath.replace('$' + sha1, '$' + sha1);
    const includeUrl = `${baseUrl}/${resolvedPath}`;
    
    try {
      const response = await pRetry(
        () =>
          fetch(includeUrl, {
            headers: {
              ...authHeaders,
              Accept: 'application/json',
              'User-Agent': COMPOSER_USER_AGENT,
            },
          }),
        { retries: 2 }
      );
      
      if (!response.ok) {
        console.warn(`Failed to fetch include file ${includeUrl}: ${response.status}`);
        continue;
      }
      
      const includeData = await response.json() as { packages: Record<string, Record<string, ComposerPackage>> };
      
      // Check if this include file contains our package
      if (includeData.packages?.[packageName]) {
        return {
          packages: {
            [packageName]: includeData.packages[packageName],
          },
        };
      }
    } catch (error) {
      console.warn(`Error fetching include file ${includeUrl}:`, error);
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
/**
 * Extract owner and repository name from a GitHub URL (https or ssh form).
 * Linear scan equivalent of /github\.com[:\/]([^\/]+)\/([^\/.]+)/ without
 * the polynomial backtracking CodeQL flags on attacker-influenced input.
 * The repo name stops at the first '.' or '/' (drops the '.git' suffix).
 */
export function parseGitHubOwnerRepo(url: string): { owner: string; repoName: string } | null {
  const host = 'github.com';
  const hostIndex = url.indexOf(host);
  if (hostIndex === -1) {
    return null;
  }

  const separator = url[hostIndex + host.length];
  if (separator !== ':' && separator !== '/') {
    return null;
  }

  const rest = url.slice(hostIndex + host.length + 1);
  const slashIndex = rest.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  const owner = rest.slice(0, slashIndex);
  const afterOwner = rest.slice(slashIndex + 1);

  let end = 0;
  while (end < afterOwner.length && afterOwner[end] !== '/' && afterOwner[end] !== '.') {
    end++;
  }
  const repoName = afterOwner.slice(0, end);

  return repoName.length > 0 ? { owner, repoName } : null;
}

export async function fetchPackageFromGitHub(
  repo: UpstreamRepository,
  packageName: string,
  encryptionKey: string
): Promise<ProviderPackageResponse | null> {
  const logger = getLogger();

  // Parse GitHub URL (explicit scan - avoids regex backtracking on untrusted input)
  const parsed = parseGitHubOwnerRepo(repo.url);
  if (!parsed) {
    logger.warn('Invalid GitHub URL format', { url: repo.url });
    return null;
  }

  const { owner, repoName: cleanRepoName } = parsed;
  
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
    } catch (_error) {
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
  } catch (_error) {
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
