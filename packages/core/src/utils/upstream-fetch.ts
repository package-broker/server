/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Utility for fetching package metadata from upstream Composer repositories

import { buildAuthHeaders, type CredentialType, COMPOSER_USER_AGENT } from '@package-broker/shared';
import type { ComposerPackagesJson, ProviderFile, ProviderPackageResponse } from '../sync/types';
import { decryptCredentials } from './encryption';
import pRetry from 'p-retry';

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


