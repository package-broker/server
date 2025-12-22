import { describe, it, expect } from 'vitest';
import { buildStorageKey, buildReadmeStorageKey, parseStorageKey } from '../storage/driver';

describe('Storage Key Utilities', () => {
  describe('buildStorageKey', () => {
    it('should build a private artifact key', () => {
      const key = buildStorageKey('private', 'repo123', 'vendor/package', '1.0.0');
      expect(key).toBe('private/repo123/vendor/package/1.0.0.zip');
    });

    it('should build a public mirror key', () => {
      const key = buildStorageKey('public', 'packagist', 'symfony/console', '6.4.0');
      expect(key).toBe('public/packagist/symfony/console/6.4.0.zip');
    });

    it('should handle package names with slashes', () => {
      const key = buildStorageKey('private', 'repo', 'vendor/sub/package', '2.0.0');
      expect(key).toBe('private/repo/vendor/sub/package/2.0.0.zip');
    });
  });

  describe('buildReadmeStorageKey', () => {
    it('should build a private README key', () => {
      const key = buildReadmeStorageKey('private', 'repo123', 'vendor/package', '1.0.0');
      expect(key).toBe('private/repo123/vendor/package/1.0.0.readme.md');
    });

    it('should build a public README key', () => {
      const key = buildReadmeStorageKey('public', 'packagist', 'symfony/console', '6.4.0');
      expect(key).toBe('public/packagist/symfony/console/6.4.0.readme.md');
    });

    it('should handle package names with slashes', () => {
      const key = buildReadmeStorageKey('private', 'repo', 'vendor/sub/package', '2.0.0');
      expect(key).toBe('private/repo/vendor/sub/package/2.0.0.readme.md');
    });
  });

  describe('parseStorageKey', () => {
    it('should parse a valid storage key', () => {
      const parsed = parseStorageKey('private/repo123/vendor/package/1.0.0.zip');
      expect(parsed).toEqual({
        type: 'private',
        repoId: 'repo123',
        packageName: 'vendor/package',
        version: '1.0.0',
      });
    });

    it('should return null for invalid key', () => {
      const parsed = parseStorageKey('invalid-key');
      expect(parsed).toBeNull();
    });
  });
});




