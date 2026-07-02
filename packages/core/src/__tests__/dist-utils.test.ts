/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';
import { normalizeVersionToDisplay, findVersionInMetadata, distRoute } from '../routes/dist';
import { deriveVersionNormalized } from '../routes/composer';

vi.mock('../utils/logger', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../utils/analytics', () => ({
  getAnalytics: () => ({
    trackPackageDownload: vi.fn(),
  }),
}));

describe('normalizeVersionToDisplay', () => {
  describe('patch versions', () => {
    it('should convert patch version format: 103.0.7.0-patch8 → 103.0.7-p8', () => {
      expect(normalizeVersionToDisplay('103.0.7.0-patch8')).toBe('103.0.7-p8');
    });

    it('should convert patch version format: 1.2.3.0-patch1 → 1.2.3-p1', () => {
      expect(normalizeVersionToDisplay('1.2.3.0-patch1')).toBe('1.2.3-p1');
    });

    it('should convert patch version format: 100.4.7.0-patch5 → 100.4.7-p5', () => {
      expect(normalizeVersionToDisplay('100.4.7.0-patch5')).toBe('100.4.7-p5');
    });
  });

  describe('4-part versions without suffix', () => {
    it('should remove trailing .0: 1.2.0.0 → 1.2.0', () => {
      expect(normalizeVersionToDisplay('1.2.0.0')).toBe('1.2.0');
    });

    it('should remove trailing .0: 103.0.7.0 → 103.0.7', () => {
      expect(normalizeVersionToDisplay('103.0.7.0')).toBe('103.0.7');
    });

    it('should remove trailing .0: 2.4.8.0 → 2.4.8', () => {
      expect(normalizeVersionToDisplay('2.4.8.0')).toBe('2.4.8');
    });
  });

  describe('4-part versions with suffix', () => {
    it('should convert: 1.2.0.0-beta → 1.2.0-beta', () => {
      expect(normalizeVersionToDisplay('1.2.0.0-beta')).toBe('1.2.0-beta');
    });

    it('should convert: 1.2.0.0-alpha → 1.2.0-alpha', () => {
      expect(normalizeVersionToDisplay('1.2.0.0-alpha')).toBe('1.2.0-alpha');
    });

    it('should convert: 1.2.0.0-dev → 1.2.0-dev', () => {
      expect(normalizeVersionToDisplay('1.2.0.0-dev')).toBe('1.2.0-dev');
    });

    it('should convert: 1.2.0.0-RC1 → 1.2.0-RC1', () => {
      expect(normalizeVersionToDisplay('1.2.0.0-RC1')).toBe('1.2.0-RC1');
    });
  });

  describe('3-part versions (no change)', () => {
    it('should return unchanged: 1.2.0 → 1.2.0', () => {
      expect(normalizeVersionToDisplay('1.2.0')).toBe('1.2.0');
    });

    it('should return unchanged: 103.0.7 → 103.0.7', () => {
      expect(normalizeVersionToDisplay('103.0.7')).toBe('103.0.7');
    });

    it('should return unchanged: 2.4.8 → 2.4.8', () => {
      expect(normalizeVersionToDisplay('2.4.8')).toBe('2.4.8');
    });
  });

  describe('edge cases', () => {
    it('should handle versions with multiple suffixes: 1.2.0.0-beta.1 → 1.2.0-beta.1', () => {
      expect(normalizeVersionToDisplay('1.2.0.0-beta.1')).toBe('1.2.0-beta.1');
    });

    it('should handle versions that do not match any pattern', () => {
      expect(normalizeVersionToDisplay('v1.2.3')).toBe('v1.2.3');
      expect(normalizeVersionToDisplay('1.2')).toBe('1.2');
      expect(normalizeVersionToDisplay('dev-master')).toBe('dev-master');
    });

    it('should handle patch versions with different patch numbers', () => {
      expect(normalizeVersionToDisplay('1.0.0.0-patch1')).toBe('1.0.0-p1');
      expect(normalizeVersionToDisplay('1.0.0.0-patch10')).toBe('1.0.0-p10');
      expect(normalizeVersionToDisplay('1.0.0.0-patch99')).toBe('1.0.0-p99');
    });
  });

  describe('branch dev versions', () => {
    it('should convert Composer normalized branch versions back to display versions', () => {
      expect(normalizeVersionToDisplay('1.9999999.9999999.9999999-dev')).toBe('1.x-dev');
      expect(normalizeVersionToDisplay('2.2.9999999.9999999-dev')).toBe('2.2.x-dev');
      expect(normalizeVersionToDisplay('5.4.9999999.9999999-dev')).toBe('5.4.x-dev');
      expect(normalizeVersionToDisplay('4.9999999.9999999.9999999-dev')).toBe('4.x-dev');
    });

    it('should leave dev branch names unchanged', () => {
      expect(normalizeVersionToDisplay('dev-master')).toBe('dev-master');
    });
  });
});

describe('deriveVersionNormalized', () => {
  it('should normalize numeric branch display versions like Composer', () => {
    expect(deriveVersionNormalized('1.x-dev')).toBe('1.9999999.9999999.9999999-dev');
    expect(deriveVersionNormalized('2.2.x-dev')).toBe('2.2.9999999.9999999-dev');
    expect(deriveVersionNormalized('5.4.x-dev')).toBe('5.4.9999999.9999999-dev');
    expect(deriveVersionNormalized('3.x-dev')).toBe('3.9999999.9999999.9999999-dev');
    expect(deriveVersionNormalized('1.24.x-dev')).toBe('1.24.9999999.9999999-dev');
    expect(deriveVersionNormalized('5.x-dev')).toBe('5.9999999.9999999.9999999-dev');
  });

  it('should leave literal dev branches unchanged', () => {
    expect(deriveVersionNormalized('dev-master')).toBe('dev-master');
    expect(deriveVersionNormalized('dev-main')).toBe('dev-main');
  });

  it('should preserve existing classical version normalization', () => {
    expect(deriveVersionNormalized('v1.2.3')).toBe('1.2.3.0');
    expect(deriveVersionNormalized('1.2')).toBe('1.2.0.0');
    expect(deriveVersionNormalized('1.2-dev')).toBe('1.2.0.0-dev');
    expect(deriveVersionNormalized('10.0-dev')).toBe('10.0.0.0-dev');
    expect(deriveVersionNormalized('103.0.7-p8')).toBe('103.0.7.0-patch8');
    expect(deriveVersionNormalized('2.2.1-beta')).toBe('2.2.1.0-beta');
  });
});

describe('findVersionInMetadata', () => {
  const createMockVersion = (version: string, versionNormalized?: string) => ({
    version,
    metadata: {
      version_normalized: versionNormalized || deriveVersionNormalized(version),
      dist: { url: 'https://example.com/package.zip', type: 'zip' },
    },
  });

  describe('Strategy 1: Exact match (versionFromUrl === metadataVersion)', () => {
    it('should match exact version', () => {
      const versions = [createMockVersion('1.2.3')];
      const result = findVersionInMetadata('1.2.3', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3');
    });

    it('should not match different version', () => {
      const versions = [createMockVersion('1.2.3')];
      const result = findVersionInMetadata('1.2.4', '1.2.4', versions);
      expect(result).toBeNull();
    });
  });

  describe('Strategy 2: Display version match (displayVersion === metadataVersion)', () => {
    it('should match when displayVersion equals metadataVersion', () => {
      const versions = [createMockVersion('1.2.3')];
      const result = findVersionInMetadata('1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3');
    });

    it('should not match when both displayVersion and versionFromUrl differ', () => {
      const versions = [createMockVersion('1.2.3')];
      const result = findVersionInMetadata('1.2.4.0', '1.2.4', versions);
      expect(result).toBeNull();
    });
  });

  describe('Strategy 3: Normalized match (versionFromUrl === metadata.version_normalized)', () => {
    it('should match when versionFromUrl equals version_normalized', () => {
      const versions = [createMockVersion('1.2.3', '1.2.3.0')];
      const result = findVersionInMetadata('1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3');
    });

    it('should not match when normalized versions differ', () => {
      const versions = [createMockVersion('1.2.3', '1.2.3.0')];
      const result = findVersionInMetadata('1.2.4.0', '1.2.4', versions);
      expect(result).toBeNull();
    });
  });

  describe('Strategy 4: Derived normalized match (versionFromUrl === deriveVersionNormalized(metadataVersion))', () => {
    it('should match when versionFromUrl equals derived normalized', () => {
      const versions = [createMockVersion('1.2.3')];
      const normalized = deriveVersionNormalized('1.2.3');
      expect(normalized).toBe('1.2.3.0');
      const result = findVersionInMetadata('1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3');
    });

    it('should match patch versions', () => {
      const versions = [createMockVersion('103.0.7-p8')];
      const result = findVersionInMetadata('103.0.7.0-patch8', '103.0.7-p8', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('103.0.7-p8');
    });
  });

  describe('Strategy 5: Display version without v (displayVersion === metadataVersionNoV)', () => {
    it('should match when displayVersion equals metadataVersion after removing v', () => {
      const versions = [createMockVersion('v1.2.3')];
      const result = findVersionInMetadata('v1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('v1.2.3');
    });

    it('should match when both have v prefix removed', () => {
      const versions = [createMockVersion('v1.2.3')];
      const result = findVersionInMetadata('1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('v1.2.3');
    });
  });

  describe('Strategy 6: Normalized without v (versionFromUrlNoV === metadataVersionNoVNormalized)', () => {
    it('should match normalized versions after removing v prefix', () => {
      const versions = [createMockVersion('v1.2.3')];
      const result = findVersionInMetadata('v1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('v1.2.3');
    });

    it('should match when both normalized versions match after removing v', () => {
      const versions = [createMockVersion('v1.2.3')];
      const result = findVersionInMetadata('1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('v1.2.3');
    });
  });

  describe('Strategy 7: Display version with derived normalized (displayVersion === deriveVersionNormalized(metadataVersion))', () => {
    it('should match when displayVersion equals derived normalized of metadata version', () => {
      const versions = [createMockVersion('1.2.3')];
      const result = findVersionInMetadata('1.2.3.0', '1.2.3.0', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3');
    });

    it('should not match when all strategies fail', () => {
      const versions = [createMockVersion('1.2.3')];
      const result = findVersionInMetadata('2.0.0.0', '2.0.0', versions);
      expect(result).toBeNull();
    });
  });

  describe('Strategy 8: Reverse normalized (deriveVersionNormalized(displayVersion) === metadata.version_normalized)', () => {
    it('should match when derived normalized of displayVersion equals metadata normalized', () => {
      const versions = [createMockVersion('1.2.3', '1.2.3.0')];
      const result = findVersionInMetadata('1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3');
    });

    it('should match patch versions in reverse', () => {
      const versions = [createMockVersion('103.0.7-p8', '103.0.7.0-patch8')];
      const result = findVersionInMetadata('103.0.7.0-patch8', '103.0.7-p8', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('103.0.7-p8');
    });
  });

  describe('Edge cases and negative scenarios', () => {
    it('should return null when no versions match', () => {
      const versions = [createMockVersion('1.2.3')];
      const result = findVersionInMetadata('2.0.0', '2.0.0', versions);
      expect(result).toBeNull();
    });

    it('should handle empty versions array', () => {
      const versions: Array<{ version: string; metadata: any }> = [];
      const result = findVersionInMetadata('1.2.3', '1.2.3', versions);
      expect(result).toBeNull();
    });

    it('should handle multiple versions and match the first one', () => {
      const versions = [
        createMockVersion('1.2.3'),
        createMockVersion('1.2.4'),
        createMockVersion('1.2.5'),
      ];
      const result = findVersionInMetadata('1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3');
    });

    it('should handle versions with missing version_normalized field', () => {
      const versions = [
        {
          version: '1.2.3',
          metadata: {
            dist: { url: 'https://example.com/package.zip', type: 'zip' },
          },
        },
      ];
      const result = findVersionInMetadata('1.2.3.0', '1.2.3', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3');
    });

    it('should handle complex version formats', () => {
      const versions = [createMockVersion('1.2.3-beta.1')];
      const result = findVersionInMetadata('1.2.3.0-beta.1', '1.2.3-beta.1', versions);
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.2.3-beta.1');
    });

    it('should match minified metadata branch versions without version_normalized', () => {
      const versions = [
        {
          version: '1.x-dev',
          metadata: { dist: { url: 'https://example.com/1x.zip', type: 'zip' } },
        },
        {
          version: 'v1.29.0',
          metadata: { dist: { url: 'https://example.com/v129.zip', type: 'zip' } },
        },
      ];
      const result = findVersionInMetadata(
        '1.9999999.9999999.9999999-dev',
        '1.x-dev',
        versions
      );
      expect(result).not.toBeNull();
      expect(result?.version).toBe('1.x-dev');
    });

    it('should match minified metadata minor branch versions without version_normalized', () => {
      const versions = [
        {
          version: '2.2.x-dev',
          metadata: { dist: { url: 'https://example.com/22x.zip', type: 'zip' } },
        },
      ];
      const result = findVersionInMetadata(
        '2.2.9999999.9999999-dev',
        '2.2.x-dev',
        versions
      );
      expect(result).not.toBeNull();
      expect(result?.version).toBe('2.2.x-dev');
    });

    it('should not match an unrelated normalized branch version', () => {
      const versions = [
        {
          version: '1.x-dev',
          metadata: { dist: { url: 'https://example.com/1x.zip', type: 'zip' } },
        },
      ];
      const result = findVersionInMetadata(
        '9.9999999.9999999.9999999-dev',
        '9.x-dev',
        versions
      );
      expect(result).toBeNull();
    });
  });
});

describe('distRoute mirror branch version resolution', () => {
  it('should resolve a normalized mirror URL version to a stored pretty branch version', async () => {
    const artifact = {
      id: 'artifact-1',
      repo_id: 'repo-1',
      package_name: 'symfony/polyfill-ctype',
      version: '1.x-dev',
      file_key: 'private/repo-1/symfony/polyfill-ctype/1.x-dev.zip',
      size: 11,
      download_count: 0,
      created_at: 1_700_000_000,
      last_downloaded_at: null,
    };
    const packageRow = {
      id: 'pkg-1',
      repo_id: 'repo-1',
      name: 'symfony/polyfill-ctype',
      version: '1.x-dev',
      dist_url: 'https://broker.example/dist/repo-1/symfony/polyfill-ctype/1.x-dev.zip',
      source_dist_url: 'https://example.com/source.zip',
      dist_reference: 'abc123',
      description: null,
      license: null,
      package_type: null,
      homepage: null,
      released_at: null,
      readme_content: null,
      metadata: JSON.stringify({ dist: { type: 'zip' } }),
      is_manual_upload: 0,
      created_at: 1_700_000_000,
    };
    const selectResults = [
      [],
      [{ repo_id: 'repo-1', version: '1.x-dev' }],
      [artifact],
      [packageRow],
    ];
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
        })),
      })),
    }));
    const update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    }));
    const storageGet = vi.fn(() => Promise.resolve(new Response('zip-content').body));
    const context = {
      req: {
        param: (key: string) => {
          if (key === 'vendor') return 'symfony';
          if (key === 'package') return 'polyfill-ctype';
          if (key === 'version') return '1.9999999.9999999.9999999-dev.zip';
          return undefined;
        },
        header: () => undefined,
        url: 'https://broker.example/dist/m/symfony/polyfill-ctype/1.9999999.9999999.9999999-dev.zip',
      },
      env: {
        ENCRYPTION_KEY: 'test-key',
        KV: {},
      },
      var: {
        storage: {
          get: storageGet,
          put: vi.fn(),
          delete: vi.fn(),
          exists: vi.fn(),
        },
      },
      executionCtx: {
        waitUntil: vi.fn(),
      },
      get: (key: string) => {
        if (key === 'database') {
          return { select, update };
        }
        if (key === 'requestId') {
          return 'request-1';
        }
        return undefined;
      },
      json: vi.fn((data: unknown, status: number) => new Response(JSON.stringify(data), { status })),
    } as unknown as Context;

    const response = await distRoute(context);

    expect(response.status).toBe(200);
    expect(storageGet).toHaveBeenCalledWith('private/repo-1/symfony/polyfill-ctype/1.x-dev.zip');
    expect(select).toHaveBeenCalledTimes(4);
  });
});
