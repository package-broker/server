/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildP2Response } from '../routes/composer';
import type { packages } from '../db/schema';

// Mock logger
vi.mock('../utils/logger', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// Helper to create mock package record
function createMockPackage(
  name: string,
  version: string,
  metadata: any,
  overrides: Partial<typeof packages.$inferSelect> = {}
): typeof packages.$inferSelect {
  return {
    id: 'test-id',
    repo_id: 'test-repo',
    name,
    version,
    dist_url: 'https://proxy.example.com/dist/test-repo/vendor/package/1.0.0.zip',
    source_dist_url: metadata.dist?.url || 'https://example.com/package.zip',
    dist_reference: metadata.dist?.reference || 'abc123',
    description: metadata.description || null,
    license: metadata.license ? JSON.stringify(metadata.license) : null,
    package_type: metadata.type || null,
    homepage: metadata.homepage || null,
    released_at: metadata.time ? Math.floor(new Date(metadata.time).getTime() / 1000) : null,
    readme_content: null,
    metadata: JSON.stringify(metadata), // Store complete metadata
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe('Composer p2 Response Generation', () => {
  describe('buildP2Response', () => {
    it('should generate response with required fields', () => {
      const packageName = 'vendor/package';
      const mockPackages = [
        createMockPackage(packageName, '1.0.0', {
          name: packageName,
          version: '1.0.0',
          dist: {
            type: 'zip',
            url: 'https://example.com/package.zip',
            reference: 'abc123',
          },
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const version = result.packages[packageName].find(v => v.version === '1.0.0');

      expect(version).toBeDefined();
      expect(version!.name).toBe(packageName);
      expect(version!.version).toBe('1.0.0');
      expect(version!.dist).toBeDefined();
      expect(version!.dist.type).toBe('zip');
      // buildP2Response uses the proxy URL (dist_url) which is set in createMockPackage
      expect(version!.dist.url).toContain('https://proxy.example.com/dist/');
      expect(version!.dist.reference).toBe('abc123');
    });

    it('should include autoload field when present in metadata', () => {
      const packageName = 'vendor/package';
      const mockPackages = [
        createMockPackage(packageName, '1.0.0', {
          name: packageName,
          version: '1.0.0',
          dist: { type: 'zip', url: 'https://example.com/package.zip' },
          autoload: {
            'psr-4': {
              'Vendor\\Package\\': 'src/',
            },
          },
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const version = result.packages[packageName].find(v => v.version === '1.0.0');

      expect(version!.autoload).toBeDefined();
      expect(version!.autoload).toEqual({
        'psr-4': {
          'Vendor\\Package\\': 'src/',
        },
      });
    });

    it('should omit autoload if it is not an object', () => {
      const packageName = 'vendor/package';
      const mockPackages = [
        createMockPackage(packageName, '1.0.0', {
          name: packageName,
          version: '1.0.0',
          dist: { type: 'zip', url: 'https://example.com/package.zip' },
          autoload: 'invalid-string', // Invalid type
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const version = result.packages[packageName].find(v => v.version === '1.0.0');

      expect(version!.autoload).toBeUndefined();
    });

    it('should include require and require-dev fields', () => {
      const packageName = 'vendor/package';
      const mockPackages = [
        createMockPackage(packageName, '1.0.0', {
          name: packageName,
          version: '1.0.0',
          dist: { type: 'zip', url: 'https://example.com/package.zip' },
          require: {
            'php': '>=8.0',
            'symfony/console': '^6.0',
          },
          'require-dev': {
            'phpunit/phpunit': '^10.0',
          },
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const version = result.packages[packageName].find(v => v.version === '1.0.0');

      expect(version!.require).toEqual({
        'php': '>=8.0',
        'symfony/console': '^6.0',
      });
      expect(version!['require-dev']).toEqual({
        'phpunit/phpunit': '^10.0',
      });
    });

    it('should preserve optional fields from metadata', () => {
      const packageName = 'vendor/package';
      const mockPackages = [
        createMockPackage(packageName, '1.0.0', {
          name: packageName,
          version: '1.0.0',
          dist: {
            type: 'zip',
            url: 'https://example.com/package.zip',
            reference: 'abc123',
            shasum: 'def456',
          },
          time: '2025-01-01T00:00:00+00:00',
          description: 'Test package',
          license: 'MIT',
          type: 'library',
          homepage: 'https://example.com',
          source: {
            type: 'git',
            url: 'https://github.com/vendor/package.git',
            reference: 'abc123',
          },
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const version = result.packages[packageName].find(v => v.version === '1.0.0');

      expect(version!.time).toBe('2025-01-01T00:00:00.000Z');
      expect(version!.description).toBe('Test package');
      expect(version!.license).toBe('MIT');
      expect(version!.type).toBe('library');
      expect(version!.homepage).toBe('https://example.com');
      expect(version!.source).toEqual({
        type: 'git',
        url: 'https://github.com/vendor/package.git',
        reference: 'abc123',
      });
      expect(version!.dist.shasum).toBe('def456');
    });

    it('should handle multiple versions', () => {
      const packageName = 'vendor/package';
      const mockPackages = [
        createMockPackage(packageName, '1.0.0', {
          name: packageName,
          version: '1.0.0',
          dist: { type: 'zip', url: 'https://example.com/package-1.0.0.zip' },
        }),
        createMockPackage(packageName, '2.0.0', {
          name: packageName,
          version: '2.0.0',
          dist: { type: 'zip', url: 'https://example.com/package-2.0.0.zip' },
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const v1 = result.packages[packageName].find(v => v.version === '1.0.0');
      const v2 = result.packages[packageName].find(v => v.version === '2.0.0');

      expect(v1).toBeDefined();
      expect(v2).toBeDefined();
      expect(v1!.version).toBe('1.0.0');
      expect(v2!.version).toBe('2.0.0');
    });

    it('should handle empty metadata gracefully', () => {
      const packageName = 'vendor/package';
      const mockPackages = [
        createMockPackage(packageName, '1.0.0', {}, {
          metadata: null, // No metadata stored
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const version = result.packages[packageName].find(v => v.version === '1.0.0');

      expect(version).toBeDefined();
      expect(version!.name).toBe(packageName);
      expect(version!.version).toBe('1.0.0');
      expect(version!.dist).toBeDefined();
    });

    it('should handle invalid JSON in metadata gracefully', () => {
      const packageName = 'vendor/package';
      const mockPackages = [
        createMockPackage(packageName, '1.0.0', {}, {
          metadata: 'invalid-json{', // Invalid JSON
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const version = result.packages[packageName].find(v => v.version === '1.0.0');

      // Should still generate response with basic fields
      expect(version).toBeDefined();
      expect(version!.name).toBe(packageName);
      expect(version!.version).toBe('1.0.0');
    });

    it('should handle real-world Packagist format', () => {
      const packageName = 'magento/magento-coding-standard';
      const mockPackages = [
        createMockPackage(packageName, '3', {
          version: '3',
          version_normalized: '3.0.0.0',
          source: {
            url: 'https://github.com/magento/magento-coding-standard.git',
            type: 'git',
            reference: '73a7b7f3c00b02242f45f706571430735586f608',
          },
          dist: {
            url: 'https://api.github.com/repos/magento/magento-coding-standard/zipball/73a7b7f3c00b02242f45f706571430735586f608',
            type: 'zip',
            shasum: '',
            reference: '73a7b7f3c00b02242f45f706571430735586f608',
          },
          time: '2019-06-18T21:01:42+00:00',
          'notification-url': null,
        }),
      ];

      const result = buildP2Response(packageName, mockPackages);
      const version = result.packages[packageName].find(v => v.version === '3');

      expect(version).toBeDefined();
      expect(version!.name).toBe(packageName);
      expect(version!.version).toBe('3');
      expect(version!.dist).toBeDefined();
      expect(version!.dist.type).toBe('zip');
      expect(version!.time).toBe('2019-06-18T21:01:42.000Z');
    });
  });
});
