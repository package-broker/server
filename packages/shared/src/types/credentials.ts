// Credential type definitions

import type { CredentialType, CredentialConfig } from './index.js';

// HeadersInit type for environments without standard lib types
type HeadersInit = Record<string, string> | [string, string][] | Headers;

/**
 * Credential field definitions for each credential type
 */
export const CREDENTIAL_FIELD_DEFINITIONS: Record<
  CredentialType,
  { label: string; fields: Array<{ name: string; label: string; type: 'text' | 'password' }> }
> = {
  http_basic: {
    label: 'HTTP Basic (Username/Password)',
    fields: [
      { name: 'username', label: 'Username', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
  },
  github_token: {
    label: 'GitHub Token',
    fields: [{ name: 'token', label: 'Personal Access Token', type: 'password' }],
  },
  gitlab_token: {
    label: 'GitLab Token',
    fields: [{ name: 'token', label: 'Personal/Project Access Token', type: 'password' }],
  },
  bitbucket_app_password: {
    label: 'Bitbucket App Password',
    fields: [
      { name: 'username', label: 'Username', type: 'text' },
      { name: 'password', label: 'App Password', type: 'password' },
    ],
  },
  bitbucket_api_token: {
    label: 'Bitbucket API Token',
    fields: [{ name: 'token', label: 'Token', type: 'password' }],
  },
  bitbucket_api_key: {
    label: 'Bitbucket API Key',
    fields: [{ name: 'key', label: 'API Key', type: 'password' }],
  },
  bitbucket_server_pat: {
    label: 'Bitbucket Server PAT',
    fields: [{ name: 'token', label: 'Personal Access Token', type: 'password' }],
  },
  bearer_token: {
    label: 'Bearer Token',
    fields: [{ name: 'token', label: 'Token', type: 'password' }],
  },
  ssh_key: {
    label: 'SSH Key',
    fields: [
      { name: 'private_key', label: 'Private Key', type: 'password' },
      { name: 'passphrase', label: 'Passphrase (optional)', type: 'password' },
    ],
  },
  none: {
    label: 'No Authentication',
    fields: [],
  },
};

/**
 * Base credential types allowed for each source type (without environment-specific types)
 * Filters the credential dropdown based on what makes sense for the source
 * 
 * Note: 'none' is allowed for public repositories (e.g., open-source GitHub repos)
 * that don't require authentication. These repos sync on-demand when packages are requested.
 */
const BASE_CREDENTIALS_BY_SOURCE_TYPE: Record<string, CredentialType[]> = {
  composer: ['http_basic', 'bearer_token', 'none'],
  git: ['github_token', 'gitlab_token', 'bitbucket_app_password', 'bitbucket_api_token', 'bitbucket_api_key', 'bitbucket_server_pat', 'none'],
};

/**
 * Get credential types allowed for each source type, including environment-specific types
 * SSH key support is only available in Node.js environments (not Cloudflare Workers)
 * 
 * This function should be called at runtime to get the correct list based on environment.
 * For UI usage, use the API endpoint to check SSH support availability.
 */
export function getCredentialsBySourceType(includeSsh: boolean = false): Record<string, CredentialType[]> {
  const credentials = { ...BASE_CREDENTIALS_BY_SOURCE_TYPE };
  
  if (includeSsh) {
    // Add SSH key to git credentials if supported
    if (credentials.git && !credentials.git.includes('ssh_key')) {
      credentials.git = [...credentials.git, 'ssh_key'];
    }
  }
  
  return credentials;
}

/**
 * Credential types allowed for each source type
 * @deprecated Use getCredentialsBySourceType() for environment-aware credential lists
 * This constant is kept for backward compatibility but doesn't include SSH
 */
export const CREDENTIALS_BY_SOURCE_TYPE: Record<string, CredentialType[]> = BASE_CREDENTIALS_BY_SOURCE_TYPE;

/**
 * Build authentication headers from credential config
 */
export function buildAuthHeaders(
  credentialType: CredentialType,
  fields: Record<string, string>
): HeadersInit {
  const headers: HeadersInit = {};

  switch (credentialType) {
    case 'http_basic': {
      const username = fields.username || '';
      const password = fields.password || '';
      const credentials = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${credentials}`;
      break;
    }
    case 'github_token':
    case 'gitlab_token':
    case 'bitbucket_api_token':
    case 'bitbucket_server_pat':
    case 'bearer_token': {
      headers['Authorization'] = `Bearer ${fields.token || fields.password || fields.key || ''}`;
      break;
    }
    case 'bitbucket_app_password': {
      // Bitbucket App Password uses Basic Auth with username:password
      const username = fields.username || '';
      const password = fields.password || '';
      const credentials = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${credentials}`;
      break;
    }
    case 'bitbucket_api_key': {
      // Bitbucket API Key uses Basic Auth
      const username = fields.username || fields.key || '';
      const password = fields.password || '';
      const credentials = btoa(`${username}:${password}`);
      headers['Authorization'] = `Basic ${credentials}`;
      break;
    }
    case 'ssh_key': {
      // SSH keys are handled separately in git sync, not via HTTP headers
      break;
    }
    case 'none': {
      break;
    }
  }

  return headers;
}

