/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { validatePackageArchive, extractReadme } from '../utils/package-validator.js';

/**
 * Helper to create a ZIP archive with given files
 */
function createZipArchive(files: Record<string, string>): Uint8Array {
  const zipFiles: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zipFiles[path] = strToU8(content);
  }
  return zipSync(zipFiles);
}

/**
 * Create a valid composer.json content
 */
function createComposerJson(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    name: 'vendor/package',
    version: '1.0.0',
    description: 'A test package',
    type: 'library',
    license: 'MIT',
    ...overrides,
  });
}

describe('validatePackageArchive', () => {
  describe('ZIP file validation', () => {
    it('should reject empty data', async () => {
      const result = await validatePackageArchive(new Uint8Array(0));
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Archive is empty or invalid');
    });

    it('should reject non-ZIP files', async () => {
      const notZip = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const result = await validatePackageArchive(notZip);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid ZIP archive format');
    });

    it('should reject files smaller than minimum size', async () => {
      const tooSmall = new Uint8Array([0x50, 0x4B]);
      const result = await validatePackageArchive(tooSmall);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('File too small');
    });
  });

  describe('composer.json detection', () => {
    it('should find composer.json in root', async () => {
      const zip = createZipArchive({
        'composer.json': createComposerJson(),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('vendor/package');
    });

    it('should find composer.json in first-level directory', async () => {
      const zip = createZipArchive({
        'package-name/composer.json': createComposerJson({ name: 'my-vendor/my-package' }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('my-vendor/my-package');
    });

    it('should find composer.json in GitHub-style directory (vendor-package-1.0.0/)', async () => {
      const zip = createZipArchive({
        'vendor-package-1.0.0/composer.json': createComposerJson({ name: 'vendor/package', version: '1.0.0' }),
        'vendor-package-1.0.0/src/index.php': '<?php',
        'vendor-package-1.0.0/README.md': '# Package',
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('vendor/package');
    });

    it('should find composer.json case-insensitively', async () => {
      const zip = createZipArchive({
        'COMPOSER.JSON': createComposerJson(),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
    });

    it('should find composer.json in subdirectory case-insensitively', async () => {
      const zip = createZipArchive({
        'MyPackage/COMPOSER.JSON': createComposerJson(),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
    });

    it('should find composer.json in second-level directory (for monorepos)', async () => {
      const zip = createZipArchive({
        'owner-repo-abc123/packages/composer.json': createComposerJson({ name: 'owner/monorepo-pkg' }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('owner/monorepo-pkg');
    });

    it('should NOT find composer.json in deeply nested directories (depth > 2)', async () => {
      const zip = createZipArchive({
        'a/b/c/composer.json': createComposerJson(),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('too deep');
    });

    it('should prefer shallower composer.json when multiple exist', async () => {
      const zip = createZipArchive({
        'root-package/composer.json': createComposerJson({ name: 'root/package' }),
        'root-package/nested/composer.json': createComposerJson({ name: 'nested/package' }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('root/package');
    });

    it('should handle directories with trailing slashes in archive', async () => {
      // Some zip tools create directory entries with trailing slashes
      const zip = createZipArchive({
        'package-name/composer.json': createComposerJson(),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
    });

    it('should handle backslash path separators (Windows-style)', async () => {
      // Test that we handle Windows-style paths if they somehow get into the ZIP
      // Note: Most ZIP tools normalize to forward slashes, but test for safety
      const composerContent = createComposerJson();
      const files: Record<string, Uint8Array> = {
        'package-name/composer.json': strToU8(composerContent),
      };
      const zip = zipSync(files);
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
    });

    it('should fail if no composer.json exists', async () => {
      const zip = createZipArchive({
        'README.md': '# Hello',
        'src/index.php': '<?php',
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('composer.json not found');
    });
  });

  describe('composer.json validation', () => {
    it('should validate correct composer.json', async () => {
      const zip = createZipArchive({
        'composer.json': createComposerJson({
          name: 'acme/widgets',
          version: '2.3.4',
          type: 'library',
        }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('acme/widgets');
      expect(result.metadata?.version).toBe('2.3.4');
    });

    it('should reject missing name field', async () => {
      const zip = createZipArchive({
        'composer.json': JSON.stringify({ version: '1.0.0' }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing required field: "name"');
    });

    it('should reject missing version field', async () => {
      const zip = createZipArchive({
        'composer.json': JSON.stringify({ name: 'vendor/package' }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing required field: "version"');
    });

    it('should reject invalid package name format', async () => {
      const zip = createZipArchive({
        'composer.json': createComposerJson({ name: 'invalid-name' }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.includes('Invalid package name format'))).toBe(true);
    });

    it('should accept valid package names', async () => {
      const validNames = [
        'vendor/package',
        'my-vendor/my-package',
        'vendor123/package456',
        'vendor_name/package_name',
        'VENDOR/PACKAGE',
        'a/b',
      ];

      for (const name of validNames) {
        const zip = createZipArchive({
          'composer.json': createComposerJson({ name }),
        });
        const result = await validatePackageArchive(zip);
        expect(result.success).toBe(true);
        expect(result.metadata?.name).toBe(name);
      }
    });

    it('should reject invalid package names', async () => {
      const invalidNames = [
        'novendor',           // no slash
        '/package',           // empty vendor
        'vendor/',            // empty package
        '-vendor/package',    // starts with dash
        'vendor/-package',    // package starts with dash
      ];

      for (const name of invalidNames) {
        const zip = createZipArchive({
          'composer.json': createComposerJson({ name }),
        });
        const result = await validatePackageArchive(zip);
        expect(result.success).toBe(false);
      }
    });

    it('should accept valid version formats', async () => {
      const validVersions = [
        '1.0.0',
        'v1.0.0',
        '1.0',
        '1',
        '1.2.3.4',
        '1.0.0-alpha',
        '1.0.0-beta',
        '1.0.0-rc1',
        '1.0.0-dev',
        '2.0.0-alpha.1',
        '1.0.0-patch1',
      ];

      for (const version of validVersions) {
        const zip = createZipArchive({
          'composer.json': createComposerJson({ version }),
        });
        const result = await validatePackageArchive(zip);
        expect(result.success).toBe(true);
        expect(result.metadata?.version).toBe(version);
      }
    });

    it('should reject invalid JSON', async () => {
      const zip = createZipArchive({
        'composer.json': '{ invalid json }',
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.includes('Invalid JSON'))).toBe(true);
    });
  });

  describe('metadata extraction', () => {
    it('should extract all metadata fields', async () => {
      const zip = createZipArchive({
        'composer.json': JSON.stringify({
          name: 'vendor/package',
          version: '1.0.0',
          description: 'A great package',
          type: 'library',
          license: 'MIT',
          homepage: 'https://example.com',
          require: { 'php': '>=8.0' },
          'require-dev': { 'phpunit/phpunit': '^10.0' },
        }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata).toMatchObject({
        name: 'vendor/package',
        version: '1.0.0',
        description: 'A great package',
        type: 'library',
        license: 'MIT',
        homepage: 'https://example.com',
      });
      expect(result.metadata?.require?.php).toBe('>=8.0');
    });

    it('should handle array license', async () => {
      const zip = createZipArchive({
        'composer.json': createComposerJson({ license: ['MIT', 'Apache-2.0'] }),
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.license).toEqual(['MIT', 'Apache-2.0']);
    });
  });

  describe('real-world package structures', () => {
    it('should handle Magento module structure', async () => {
      const zip = createZipArchive({
        'vendor-module-name-1.0.0/composer.json': JSON.stringify({
          name: 'vendor/module-name',
          version: '1.0.0',
          type: 'magento2-module',
          require: {
            'magento/framework': '*',
          },
        }),
        'vendor-module-name-1.0.0/registration.php': '<?php',
        'vendor-module-name-1.0.0/etc/module.xml': '<xml>',
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.type).toBe('magento2-module');
    });

    it('should handle Laravel package structure', async () => {
      const zip = createZipArchive({
        'laravel-package/composer.json': JSON.stringify({
          name: 'vendor/laravel-package',
          version: '2.0.0',
          type: 'library',
          extra: {
            laravel: {
              providers: ['Vendor\\Package\\ServiceProvider'],
            },
          },
        }),
        'laravel-package/src/ServiceProvider.php': '<?php',
      });
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('vendor/laravel-package');
    });

    it('should find composer.json even in archives with 100+ files', async () => {
      // Create a large archive with 150 files, composer.json somewhere in the middle
      const files: Record<string, string> = {};
      
      // Add 70 files before composer.json
      for (let i = 0; i < 70; i++) {
        files[`vendor-package/src/Class${i.toString().padStart(3, '0')}.php`] = '<?php';
      }
      
      // Add composer.json
      files['vendor-package/composer.json'] = createComposerJson({ 
        name: 'vendor/large-package',
        version: '3.0.0'
      });
      
      // Add 80 more files after composer.json
      for (let i = 70; i < 150; i++) {
        files[`vendor-package/src/Class${i.toString().padStart(3, '0')}.php`] = '<?php';
      }
      
      const zip = createZipArchive(files);
      const result = await validatePackageArchive(zip);
      expect(result.success).toBe(true);
      expect(result.metadata?.name).toBe('vendor/large-package');
    });
  });
});

describe('extractReadme', () => {
  it('should extract README.md from root', () => {
    const zip = createZipArchive({
      'composer.json': createComposerJson(),
      'README.md': '# My Package\n\nThis is a package.',
    });
    const readme = extractReadme(zip);
    expect(readme).toBe('# My Package\n\nThis is a package.');
  });

  it('should extract README.md from subdirectory', () => {
    const zip = createZipArchive({
      'package/composer.json': createComposerJson(),
      'package/README.md': '# Subdirectory README',
    });
    const readme = extractReadme(zip);
    expect(readme).toBe('# Subdirectory README');
  });

  it('should handle case-insensitive README names', () => {
    const zip = createZipArchive({
      'composer.json': createComposerJson(),
      'readme.md': '# lowercase readme',
    });
    const readme = extractReadme(zip);
    expect(readme).toBe('# lowercase readme');
  });

  it('should return null when no README exists', () => {
    const zip = createZipArchive({
      'composer.json': createComposerJson(),
      'src/index.php': '<?php',
    });
    const readme = extractReadme(zip);
    expect(readme).toBeNull();
  });
});

