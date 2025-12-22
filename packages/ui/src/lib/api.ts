// API client for admin endpoints

const API_BASE = '/api';
const STORAGE_KEY = 'composer_proxy_admin_token';

export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(STORAGE_KEY);
  }
  return null;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  // Add auth header if token exists
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// Check if authentication is required (returns true if admin users exist)
export async function checkAuthRequired(): Promise<{ authRequired: boolean; setupRequired: boolean }> {
  try {
    const response = await fetch(`${API_BASE}/auth/check`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json() as { authRequired?: boolean; setupRequired?: boolean };
    return {
      authRequired: data.authRequired ?? true,
      setupRequired: data.setupRequired ?? false
    };
  } catch {
    return { authRequired: true, setupRequired: false }; // Assume standard flow if check fails
  }
}

export async function setupAdmin(data: { email: string; password: string }) {
  return fetchApi<{ message: string; user: { id: string; email: string } }>('/setup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Stats
export async function getStats() {
  return fetchApi<{
    active_repos: number;
    cached_packages: number;
    total_downloads: number;
  }>('/stats');
}

// Repositories
export interface Repository {
  id: string;
  url: string;
  vcs_type: string;
  credential_type: string;
  composer_json_path: string | null;
  package_filter: string | null;
  status: 'pending' | 'active' | 'error' | 'syncing';
  error_message: string | null;
  last_synced_at: number | null;
  created_at: number;
}

export async function getRepositories() {
  return fetchApi<Repository[]>('/repositories');
}

export async function createRepository(data: {
  url: string;
  vcs_type: string;
  credential_type: string;
  auth_credentials: Record<string, string>;
  composer_json_path?: string;
  package_filter?: string;
}) {
  return fetchApi<Repository>('/repositories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateRepository(id: string, data: {
  url?: string;
  vcs_type?: string;
  credential_type?: string;
  auth_credentials?: Record<string, string>;
  composer_json_path?: string;
  package_filter?: string;
}) {
  return fetchApi<Repository>(`/repositories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteRepository(id: string) {
  return fetchApi<{ message: string }>(`/repositories/${id}`, {
    method: 'DELETE',
  });
}

export async function syncRepository(id: string) {
  return fetchApi<{ message: string; status: string }>(`/repositories/${id}/sync`, {
    method: 'POST',
  });
}

// Tokens
export interface Token {
  id: string;
  description: string;
  permissions: 'readonly' | 'write';
  rate_limit_max: number | null;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
}

export interface CreatedToken extends Token {
  token: string;
}

export async function getTokens() {
  return fetchApi<Token[]>('/tokens');
}

export async function createToken(data: {
  description: string;
  permissions?: 'readonly' | 'write';
  rate_limit_max?: number | null;
  expires_at?: number;
}) {
  return fetchApi<CreatedToken>('/tokens', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateToken(id: string, data: {
  description?: string;
  rate_limit_max?: number | null;
}) {
  return fetchApi<Token>(`/tokens/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteToken(id: string) {
  return fetchApi<{ message: string }>(`/tokens/${id}`, {
    method: 'DELETE',
  });
}

// Packages
export interface Package {
  id: string;
  name: string;
  version: string;
  dist_url: string;
  description: string | null;
  license: string | null; // JSON string
  package_type: string | null;
  homepage: string | null;
  released_at: number | null;
  readme_content: string | null;
  created_at: number;
}

export async function getPackages(search?: string) {
  const params = search ? `?search=${encodeURIComponent(search)}` : '';
  return fetchApi<Package[]>(`/packages${params}`);
}

export async function getPackage(name: string) {
  return fetchApi<{ name: string; versions: Package[] }>(`/packages/${encodeURIComponent(name)}`);
}

export async function getPackageReadme(name: string, version: string): Promise<string | null> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'text/markdown',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_BASE}/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}/readme`,
    { headers }
  );

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

export async function getPackageChangelog(name: string, version: string): Promise<string | null> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'text/markdown',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_BASE}/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}/changelog`,
    { headers }
  );

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

export interface PackageStats {
  version: string;
  downloads: number;
  lastDownloadedAt: number | null;
}

export async function getPackageStats(name: string, version: string): Promise<PackageStats> {
  return fetchApi<PackageStats>(`/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}/stats`);
}

// Settings
export interface Settings {
  kv_available: boolean;
  packagist_mirroring_enabled: boolean;
}

export async function getSettings() {
  return fetchApi<Settings>('/settings');
}

export async function updatePackagistMirroring(enabled: boolean) {
  return fetchApi<Settings & { message: string }>('/settings/packagist-mirroring', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

// Add packages from mirror
export interface AddPackagesFromMirrorResult {
  package: string;
  success: boolean;
  versions?: number;
  error?: string;
}

export interface AddPackagesFromMirrorResponse {
  message: string;
  results: AddPackagesFromMirrorResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    total_versions: number;
  };
}

export async function addPackagesFromMirror(
  repositoryId: string,
  packageNames: string[]
): Promise<AddPackagesFromMirrorResponse> {
  return fetchApi<AddPackagesFromMirrorResponse>('/packages/add-from-mirror', {
    method: 'POST',
    body: JSON.stringify({
      repository_id: repositoryId,
      package_names: packageNames,
    }),
  });
}

// Users
export interface User {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
  status: string;
  created_at: number;
  last_login_at: number | null;
}

export async function getUsers() {
  return fetchApi<{ users: User[] }>('/users').then(data => data.users);
}

export async function createUser(data: { email: string; role?: 'admin' | 'viewer'; password?: string }) {
  return fetchApi<{ message: string; user: User }>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id: string) {
  return fetchApi<{ message: string }>(`/users/${id}`, {
    method: 'DELETE',
  });
}
// 2FA
export interface Setup2FAResponse {
  secret: string;
  qrCode: string;
}

export async function setup2FA() {
  return fetchApi<Setup2FAResponse>('/auth/2fa/setup', {
    method: 'POST',
  });
}

export async function enable2FA(secret: string, code: string) {
  return fetchApi<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
    method: 'POST',
    body: JSON.stringify({ secret, code }),
  });
}

export async function disable2FA() {
  return fetchApi<{ message: string }>('/auth/2fa/disable', {
    method: 'POST',
  });
}

export async function acceptInvite(token: string, password: string) {
  return fetchApi<{ message: string; user: { email: string } }>('/auth/invite/accept', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}
