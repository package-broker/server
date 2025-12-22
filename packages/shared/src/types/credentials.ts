// Credential type definitions

import type { CredentialType, CredentialConfig } from './index';

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
  none: {
    label: 'No Authentication',
    fields: [],
  },
};

/**
 * Credential types allowed for each source type
 * Filters the credential dropdown based on what makes sense for the source
 */
export const CREDENTIALS_BY_SOURCE_TYPE: Record<string, CredentialType[]> = {
  composer: ['http_basic', 'bearer_token'],
  git: ['github_token', 'gitlab_token', 'bitbucket_app_password', 'bitbucket_api_token', 'bitbucket_api_key', 'bitbucket_server_pat'],
};

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
    case 'none': {
      break;
    }
  }

  return headers;
}

