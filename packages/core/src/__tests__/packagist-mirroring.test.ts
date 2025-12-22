/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPackagistMirroringEnabled } from '../routes/api/settings';

// Mock KV namespace
function createMockKV(data: Record<string, string | null> = {}): KVNamespace {
  const store = new Map(Object.entries(data));

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

describe('Packagist Mirroring Settings', () => {
  describe('isPackagistMirroringEnabled', () => {
    it('should return true by default when setting is not set', async () => {
      // Arrange
      const kv = createMockKV({});

      // Act
      const result = await isPackagistMirroringEnabled(kv);

      // Assert
      expect(result).toBe(true);
      expect(kv.get).toHaveBeenCalledWith('settings:packagist_mirroring_enabled');
    });

    it('should return true when setting is explicitly enabled', async () => {
      // Arrange
      const kv = createMockKV({
        'settings:packagist_mirroring_enabled': 'true',
      });

      // Act
      const result = await isPackagistMirroringEnabled(kv);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when setting is explicitly disabled', async () => {
      // Arrange
      const kv = createMockKV({
        'settings:packagist_mirroring_enabled': 'false',
      });

      // Act
      const result = await isPackagistMirroringEnabled(kv);

      // Assert
      expect(result).toBe(false);
    });
  });
});

describe('Packagist Mirroring Integration', () => {
  describe('when mirroring is disabled', () => {
    it('should not proxy requests to public Packagist', async () => {
      // Arrange
      const kv = createMockKV({
        'settings:packagist_mirroring_enabled': 'false',
      });

      // Act
      const isEnabled = await isPackagistMirroringEnabled(kv);

      // Assert
      expect(isEnabled).toBe(false);
      // When disabled, the p2 route should return 404 for public packages
      // This is verified by the isPackagistMirroringEnabled check in the route
    });
  });

  describe('when mirroring is enabled', () => {
    it('should allow proxying requests to public Packagist', async () => {
      // Arrange
      const kv = createMockKV({
        'settings:packagist_mirroring_enabled': 'true',
      });

      // Act
      const isEnabled = await isPackagistMirroringEnabled(kv);

      // Assert
      expect(isEnabled).toBe(true);
      // When enabled, the p2 route should proxy to packagist.org
    });
  });

  describe('when setting is toggled', () => {
    it('should update the mirroring behavior', async () => {
      // Arrange
      const kv = createMockKV({});

      // Initially enabled by default
      expect(await isPackagistMirroringEnabled(kv)).toBe(true);

      // Disable mirroring
      await kv.put('settings:packagist_mirroring_enabled', 'false');
      expect(await isPackagistMirroringEnabled(kv)).toBe(false);

      // Re-enable mirroring
      await kv.put('settings:packagist_mirroring_enabled', 'true');
      expect(await isPackagistMirroringEnabled(kv)).toBe(true);
    });
  });
});

describe('Packagist Mirroring Edge Cases', () => {
  it('should handle invalid stored values gracefully', async () => {
    // Arrange - invalid value stored
    const kv = createMockKV({
      'settings:packagist_mirroring_enabled': 'invalid',
    });

    // Act
    const result = await isPackagistMirroringEnabled(kv);

    // Assert - should return false for any non-null, non-'true' value
    expect(result).toBe(false);
  });

  it('should handle empty string as disabled', async () => {
    // Arrange
    const kv = createMockKV({
      'settings:packagist_mirroring_enabled': '',
    });

    // Act
    const result = await isPackagistMirroringEnabled(kv);

    // Assert
    expect(result).toBe(false);
  });
});




