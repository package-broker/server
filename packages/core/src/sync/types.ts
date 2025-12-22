// Sync types

export interface ComposerPackage {
  name: string;
  version: string;
  time?: string; // ISO 8601 from upstream
  description?: string;
  license?: string | string[];
  type?: string;
  homepage?: string;
  dist?: {
    type: string;
    url: string;
    reference?: string;
  };
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
  autoload?: object;
  readme?: string;
}

export interface SyncResult {
  success: boolean;
  packages: ComposerPackage[];
  strategy?: string;
  error?: string;
}

export interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

export interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export interface ComposerPackagesJson {
  packages: Record<string, Record<string, ComposerPackage>>;
  'providers-url'?: string;
  'provider-includes'?: Record<string, { sha256: string }>;
  'providers-lazy-url'?: string;
  'metadata-url'?: string;
}

/**
 * Provider file structure (from provider-includes)
 * Contains package names and their SHA256 hashes for lazy loading
 */
export interface ProviderFile {
  providers: Record<string, { sha256: string }>;
}

/**
 * Package metadata fetched via providers-url
 * Same structure as packages.json but for a single package
 */
export interface ProviderPackageResponse {
  packages: Record<string, Record<string, ComposerPackage>>;
}




