import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rewriteComposerJson,
  estimateSavings,
  discoverFromSatis,
  discoverFromPrivatePackagist,
  type ComposerJson,
} from '../migrate';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('rewriteComposerJson', () => {
  it('should replace matching repository URL', () => {
    const input: ComposerJson = {
      name: 'acme/app',
      repositories: [
        { type: 'composer', url: 'https://satis.example.com' },
        { type: 'vcs', url: 'https://github.com/acme/lib' },
      ],
    };

    const result = rewriteComposerJson(
      input,
      'https://satis.example.com',
      'https://broker.example.com',
    );

    expect(result.repositories).toEqual([
      { type: 'composer', url: 'https://broker.example.com' },
      { type: 'vcs', url: 'https://github.com/acme/lib' },
    ]);
  });

  it('should handle trailing slashes', () => {
    const input: ComposerJson = {
      repositories: [
        { type: 'composer', url: 'https://satis.example.com/' },
      ],
    };

    const result = rewriteComposerJson(
      input,
      'https://satis.example.com',
      'https://broker.example.com/',
    );

    expect(result.repositories![0].url).toBe('https://broker.example.com');
  });

  it('should be case insensitive for URL matching', () => {
    const input: ComposerJson = {
      repositories: [
        { type: 'composer', url: 'https://Satis.Example.COM' },
      ],
    };

    const result = rewriteComposerJson(
      input,
      'https://satis.example.com',
      'https://broker.example.com',
    );

    expect(result.repositories![0].url).toBe('https://broker.example.com');
  });

  it('should not modify non-matching repositories', () => {
    const input: ComposerJson = {
      repositories: [
        { type: 'composer', url: 'https://other-registry.com' },
      ],
    };

    const result = rewriteComposerJson(
      input,
      'https://satis.example.com',
      'https://broker.example.com',
    );

    expect(result.repositories![0].url).toBe('https://other-registry.com');
  });

  it('should handle missing repositories array', () => {
    const input: ComposerJson = { name: 'acme/app' };

    const result = rewriteComposerJson(
      input,
      'https://satis.example.com',
      'https://broker.example.com',
    );

    expect(result.repositories).toBeUndefined();
  });
});

describe('estimateSavings', () => {
  it('should estimate Private Packagist costs by tier', () => {
    expect(estimateSavings('packagist', 3).monthly_cost).toBe(0);
    expect(estimateSavings('packagist', 8).monthly_cost).toBe(7);
    expect(estimateSavings('packagist', 30).monthly_cost).toBe(35);
    expect(estimateSavings('packagist', 100).monthly_cost).toBe(119);
    expect(estimateSavings('packagist', 200).monthly_cost).toBe(299);
  });

  it('should estimate Satis hosting costs', () => {
    const small = estimateSavings('satis', 20);
    expect(small.monthly_cost).toBe(10);

    const large = estimateSavings('satis', 100);
    expect(large.monthly_cost).toBe(20);
  });

  it('should calculate annual savings', () => {
    const result = estimateSavings('packagist', 100);
    expect(result.annual_cost).toBe(result.monthly_cost * 12);
    expect(result.annual_savings).toBe(result.annual_cost);
  });
});

describe('discoverFromSatis', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should discover packages from Satis packages.json', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          packages: {
            'acme/foo': { '1.0.0': {}, '2.0.0': {} },
            'acme/bar': { '1.0.0': {} },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const packages = await discoverFromSatis('https://satis.example.com');

    expect(packages).toHaveLength(2);
    expect(packages[0]).toEqual({ name: 'acme/foo', versions: ['1.0.0', '2.0.0'] });
    expect(packages[1]).toEqual({ name: 'acme/bar', versions: ['1.0.0'] });
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    await expect(discoverFromSatis('https://satis.example.com')).rejects.toThrow('HTTP 404');
  });
});

describe('discoverFromPrivatePackagist', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should discover packages with authentication', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          packages: {
            'acme/premium': { '3.0.0': {} },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const packages = await discoverFromPrivatePackagist(
      'https://repo.packagist.com/acme',
      'pp_token123',
    );

    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('acme/premium');

    // Verify auth header was sent
    const callHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders?.Authorization).toBe('Bearer pp_token123');
  });

  it('should throw on auth failure', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    await expect(
      discoverFromPrivatePackagist('https://repo.packagist.com/acme', 'bad-token'),
    ).rejects.toThrow('Authentication failed');
  });
});
