export const mockStats = {
  active_repos: 5,
  cached_packages: 42,
  total_downloads: 1337,
};

export const mockPackages = [
  // Package with many versions (to test 5-version limit)
  ...Array.from({ length: 30 }, (_, i) => ({
    id: `pkg-${i}`,
    name: 'amasty/base',
    version: `1.${i}.0`,
    dist_url: `/dist/repo1/amasty/base/1.${i}.0.zip`,
    released_at: Math.floor(Date.now() / 1000) - i * 86400,
    created_at: Math.floor(Date.now() / 1000) - i * 86400,
  })),
  // Single version package
  {
    id: 'pkg-other-1',
    name: 'vendor/single',
    version: '2.0.0',
    dist_url: '/dist/repo1/vendor/single/2.0.0.zip',
    released_at: Math.floor(Date.now() / 1000),
    created_at: Math.floor(Date.now() / 1000),
  },
];

export const mockRepositories = [
  {
    id: 'repo1',
    url: 'https://github.com/example/repo',
    vcs_type: 'git',
    status: 'active',
    last_synced_at: Math.floor(Date.now() / 1000),
    created_at: Math.floor(Date.now() / 1000),
  },
];

export const mockTokens = [
  {
    id: 'token1',
    description: 'CI/CD Token',
    rate_limit_max: 1000,
    created_at: Math.floor(Date.now() / 1000),
    last_used_at: Math.floor(Date.now() / 1000),
  },
];
