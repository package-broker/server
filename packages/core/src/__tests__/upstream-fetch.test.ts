import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPackageFromUpstream } from '../utils/upstream-fetch';

vi.mock('../utils/encryption', () => ({
  decryptCredentials: vi.fn().mockResolvedValue('{}'),
}));

describe('fetchPackageFromUpstream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches full package metadata for Packagist packages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        package: {
          versions: {
            'v6.4.31': {
              name: 'symfony/console',
              version: 'v6.4.31',
              autoload: {
                'psr-4': {
                  'Symfony\\Component\\Console\\': '',
                },
              },
              require: {
                php: '>=8.1',
              },
              dist: {
                type: 'zip',
                url: 'https://api.github.com/repos/symfony/console/zipball/ref',
              },
            },
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPackageFromUpstream(
      {
        id: 'packagist',
        url: 'https://repo.packagist.org',
        vcs_type: 'composer',
        credential_type: 'none',
        auth_credentials: '{}',
      },
      'symfony/console',
      'key'
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://packagist.org/packages/symfony/console.json',
      expect.any(Object)
    );
    expect(result?.packages['symfony/console']['v6.4.31'].autoload).toEqual({
      'psr-4': {
        'Symfony\\Component\\Console\\': '',
      },
    });
  });
});
