import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubProvider } from '../vcs/github-provider';
import { GitLabProvider } from '../vcs/gitlab-provider';
import { BitbucketProvider } from '../vcs/bitbucket-provider';
import {
  VcsProviderRegistry,
  resetVcsProviderRegistry,
  getVcsProviderRegistry,
} from '../vcs/registry';
import { registerBuiltinVcsProviders } from '../vcs';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock pRetry to just call the function directly
vi.mock('p-retry', () => ({
  default: (fn: () => Promise<unknown>) => fn(),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('VcsProviderRegistry', () => {
  let registry: VcsProviderRegistry;

  beforeEach(() => {
    registry = new VcsProviderRegistry();
  });

  it('should register and resolve providers', () => {
    const github = new GitHubProvider();
    registry.register(github);

    expect(registry.getProviderNames()).toEqual(['github']);
    expect(registry.resolve('https://github.com/acme/repo')).toBe(github);
  });

  it('should not duplicate providers', () => {
    registry.register(new GitHubProvider());
    registry.register(new GitHubProvider());

    expect(registry.getProviderNames()).toEqual(['github']);
  });

  it('should return null for unmatched URLs', () => {
    registry.register(new GitHubProvider());

    expect(registry.resolve('https://sourceforge.net/acme/repo')).toBeNull();
  });

  it('should resolve the correct provider by URL', () => {
    registry.register(new GitHubProvider());
    registry.register(new GitLabProvider());
    registry.register(new BitbucketProvider());

    const github = registry.resolve('https://github.com/acme/repo');
    expect(github?.name).toBe('github');

    const gitlab = registry.resolve('https://gitlab.com/acme/repo');
    expect(gitlab?.name).toBe('gitlab');

    const bitbucket = registry.resolve('https://bitbucket.org/acme/repo');
    expect(bitbucket?.name).toBe('bitbucket');
  });
});

describe('registerBuiltinVcsProviders', () => {
  beforeEach(() => {
    resetVcsProviderRegistry();
  });

  afterEach(() => {
    resetVcsProviderRegistry();
  });

  it('should register all three built-in providers', () => {
    registerBuiltinVcsProviders();
    const registry = getVcsProviderRegistry();

    expect(registry.getProviderNames()).toContain('github');
    expect(registry.getProviderNames()).toContain('gitlab');
    expect(registry.getProviderNames()).toContain('bitbucket');
  });

  it('should be idempotent', () => {
    registerBuiltinVcsProviders();
    registerBuiltinVcsProviders();
    const registry = getVcsProviderRegistry();

    expect(registry.getProviderNames()).toHaveLength(3);
  });
});

describe('GitHubProvider', () => {
  const provider = new GitHubProvider();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should match GitHub URLs', () => {
    expect(provider.matchesUrl('https://github.com/acme/repo')).toBe(true);
    expect(provider.matchesUrl('https://github.com/acme/repo.git')).toBe(true);
    expect(provider.matchesUrl('git@github.com:acme/repo.git')).toBe(true);
    expect(provider.matchesUrl('https://gitlab.com/acme/repo')).toBe(false);
  });

  it('should discover packages from GitHub Packages registry', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        packages: {
          'acme/foo': { '1.0.0': {}, '2.0.0': {} },
          'acme/bar': { '1.0.0': {} },
        },
      }),
    );

    const packages = await provider.discoverPackages('acme', 'ghp_token123');

    expect(packages).toHaveLength(2);
    expect(packages[0]).toEqual({
      name: 'acme/foo',
      versions: ['1.0.0', '2.0.0'],
      source: 'github_packages',
    });
  });

  it('should filter discovered packages', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        packages: {
          'acme/foo': { '1.0.0': {} },
          'acme/bar': { '1.0.0': {} },
        },
      }),
    );

    const packages = await provider.discoverPackages('acme', 'ghp_token123', 'foo');

    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('acme/foo');
  });

  it('should verify credentials against GitHub API', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ login: 'testuser' }));

    const valid = await provider.verifyCredentials(
      'https://github.com/acme/repo',
      'github_token',
      JSON.stringify({ token: 'ghp_valid' }),
    );

    expect(valid).toBe(true);
  });

  it('should reject invalid credential types', async () => {
    const valid = await provider.verifyCredentials(
      'https://github.com/acme/repo',
      'gitlab_token',
      JSON.stringify({ token: 'glpat-xxx' }),
    );

    expect(valid).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('GitLabProvider', () => {
  const provider = new GitLabProvider();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should match gitlab.com URLs only', () => {
    expect(provider.matchesUrl('https://gitlab.com/acme/repo')).toBe(true);
    expect(provider.matchesUrl('https://gitlab.example.com/acme/repo')).toBe(false);
    expect(provider.matchesUrl('https://github.com/acme/repo')).toBe(false);
  });

  it('should resolve gitlab.com URLs via registry', () => {
    const reg = new VcsProviderRegistry();
    reg.register(provider);
    expect(reg.resolve('https://gitlab.com/acme/repo')?.name).toBe('gitlab');
    expect(reg.resolve('https://gitlab.com/acme/subgroup/repo')?.name).toBe('gitlab');
  });

  it('should discover packages from GitLab group registry', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { name: 'acme/foo', version: '1.0.0' },
        { name: 'acme/foo', version: '2.0.0' },
        { name: 'acme/bar', version: '1.0.0' },
      ]),
    );

    const packages = await provider.discoverPackages('acme', 'glpat-token123');

    expect(packages).toHaveLength(2);
    expect(packages[0]).toEqual({
      name: 'acme/foo',
      versions: ['1.0.0', '2.0.0'],
      source: 'gitlab_packages',
    });
  });

  it('should sync a GitLab repository', async () => {
    // Project info
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 123,
        name: 'repo',
        description: 'Test repo',
        web_url: 'https://gitlab.com/acme/repo',
        default_branch: 'main',
      }),
    );

    // composer.json
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        name: 'acme/repo',
        description: 'A test package',
        type: 'library',
      }),
    );

    // Tags
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { name: 'v1.0.0', commit: { id: 'abc123' } },
        { name: 'v2.0.0', commit: { id: 'def456' } },
      ]),
    );

    const result = await provider.syncRepository(
      'https://gitlab.com/acme/repo',
      { token: 'glpat-xxx' },
      'gitlab_token',
    );

    expect(result.success).toBe(true);
    expect(result.strategy).toBe('gitlab_api');
    // dev-main + 2 tags
    expect(result.packages).toHaveLength(3);
    expect(result.packages[0].version).toBe('dev-main');
    expect(result.packages[1].version).toBe('1.0.0');
    expect(result.packages[2].version).toBe('2.0.0');
  });

  it('should return auth_failed on 401', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

    const result = await provider.syncRepository(
      'https://gitlab.com/acme/repo',
      { token: 'bad-token' },
      'gitlab_token',
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('auth_failed');
  });

  it('should verify credentials', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ username: 'test' }));

    const valid = await provider.verifyCredentials(
      'https://gitlab.com/acme/repo',
      'gitlab_token',
      JSON.stringify({ token: 'glpat-valid' }),
    );

    expect(valid).toBe(true);
  });
});

describe('BitbucketProvider', () => {
  const provider = new BitbucketProvider();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should match Bitbucket URLs', () => {
    expect(provider.matchesUrl('https://bitbucket.org/acme/repo')).toBe(true);
    expect(provider.matchesUrl('https://github.com/acme/repo')).toBe(false);
    expect(provider.matchesUrl('https://gitlab.com/acme/repo')).toBe(false);
  });

  it('should sync a Bitbucket repository', async () => {
    // Repo info
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        slug: 'repo',
        full_name: 'acme/repo',
        description: 'Test repo',
        mainbranch: { name: 'main' },
        links: { html: { href: 'https://bitbucket.org/acme/repo' } },
      }),
    );

    // composer.json
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        name: 'acme/repo',
        description: 'A Bitbucket package',
        type: 'library',
      }),
    );

    // Tags
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        values: [
          { name: 'v1.0.0', target: { hash: 'aaa111', date: '2025-01-01T00:00:00Z' } },
          { name: 'v1.1.0', target: { hash: 'bbb222', date: '2025-06-01T00:00:00Z' } },
        ],
      }),
    );

    const result = await provider.syncRepository(
      'https://bitbucket.org/acme/repo',
      { username: 'user', password: 'app-pass' },
      'bitbucket_app_password',
    );

    expect(result.success).toBe(true);
    expect(result.strategy).toBe('bitbucket_api');
    // dev-main + 2 tags
    expect(result.packages).toHaveLength(3);
    expect(result.packages[0].version).toBe('dev-main');
    expect(result.packages[1].version).toBe('1.0.0');
    expect(result.packages[2].version).toBe('1.1.0');
  });

  it('should return auth_failed on 401', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));

    const result = await provider.syncRepository(
      'https://bitbucket.org/acme/repo',
      { username: 'user', password: 'bad' },
      'bitbucket_app_password',
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('auth_failed');
  });

  it('should return invalid URL error', async () => {
    const result = await provider.syncRepository(
      'https://example.com/acme/repo',
      { token: 'xxx' },
      'bitbucket_api_token',
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_bitbucket_url');
  });

  it('should verify credentials', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ username: 'test' }));

    const valid = await provider.verifyCredentials(
      'https://bitbucket.org/acme/repo',
      'bitbucket_app_password',
      JSON.stringify({ username: 'user', password: 'app-pass' }),
    );

    expect(valid).toBe(true);
  });

  it('should reject invalid credential types', async () => {
    const valid = await provider.verifyCredentials(
      'https://bitbucket.org/acme/repo',
      'github_token',
      JSON.stringify({ token: 'ghp_xxx' }),
    );

    expect(valid).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
