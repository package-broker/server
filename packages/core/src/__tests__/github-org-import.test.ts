/* PACKAGE.broker - Copyright (C) 2025 Łukasz Bajsarowicz - Licensed under AGPL-3.0 */

import { describe, it, expect, vi } from 'vitest';
import { GitHubOrgImporter } from '../services/GitHubOrgImporter';

describe('GitHubOrgImporter', () => {
  it('should discover packages from GitHub Packages registry', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        packages: {
          'vendor/package-a': { '1.0.0': { dist: { url: 'https://example.com' } } },
          'vendor/package-b': { '2.0.0': { dist: { url: 'https://example.com' } } },
        },
      }),
    });

    const importer = new GitHubOrgImporter('test-org', 'ghp_test', mockFetch as typeof fetch);
    const result = await importer.discover();

    expect(result.packages).toHaveLength(2);
    expect(result.packages[0].name).toBe('vendor/package-a');
    expect(result.packages[1].name).toBe('vendor/package-b');
    expect(result.errors).toHaveLength(0);
  });

  it('should support dry-run mode', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        packages: {
          'vendor/package-a': { '1.0.0': { dist: { url: 'https://example.com' } } },
        },
      }),
    });

    const importer = new GitHubOrgImporter('test-org', 'ghp_test', mockFetch as typeof fetch);
    const result = await importer.discover({ dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.packages).toHaveLength(1);
  });

  it('should filter packages by name', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        packages: {
          'vendor/package-a': { '1.0.0': {} },
          'other/package-b': { '2.0.0': {} },
        },
      }),
    });

    const importer = new GitHubOrgImporter('test-org', 'ghp_test', mockFetch as typeof fetch);
    const result = await importer.discover({ filter: 'vendor' });

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('vendor/package-a');
  });

  it('should handle API errors gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const importer = new GitHubOrgImporter('test-org', 'ghp_test', mockFetch as typeof fetch);
    const result = await importer.discover();

    expect(result.packages).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('403');
  });

  it('should handle network errors gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const importer = new GitHubOrgImporter('test-org', 'ghp_test', mockFetch as typeof fetch);
    const result = await importer.discover();

    expect(result.packages).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Network error');
  });
});
