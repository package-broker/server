/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { buildAuthHeaders, type CredentialType, COMPOSER_USER_AGENT } from '@package-broker/shared';
import pRetry from 'p-retry';

/**
 * Download artifact from source repository with authentication
 * @param sourceUrl - Original source repository URL for the artifact
 * @param credentialType - Type of authentication
 * @param credentials - Authentication credentials
 * @returns Response stream from the source repository
 */
export async function downloadFromSource(
  sourceUrl: string,
  credentialType: CredentialType,
  credentials: Record<string, string>
): Promise<Response> {
  // Build auth headers based on credential type
  const authHeaders = buildAuthHeaders(credentialType, credentials);

  // Download with retry logic
  const response = await pRetry(
    () =>
      fetch(sourceUrl, {
        headers: {
          ...authHeaders,
          Accept: 'application/zip, application/octet-stream, */*',
          'User-Agent': COMPOSER_USER_AGENT,
        },
      }),
    { retries: 3 }
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error('Authentication failed when downloading from source repository');
  }

  if (!response.ok) {
    throw new Error(`Failed to download artifact: HTTP ${response.status}`);
  }

  return response;
}
