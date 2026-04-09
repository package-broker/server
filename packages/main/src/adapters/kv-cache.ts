import type { CachePort } from '@package-broker/core';

/**
 * Cloudflare KV cache driver
 * Wraps KVNamespace to implement CachePort interface
 */
export class KVCacheDriver implements CachePort {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    return this.kv.get(key, 'json');
  }

  async put(
    key: string,
    value: string | ReadableStream | ArrayBuffer | ArrayBufferView,
    options?: { expirationTtl?: number }
  ): Promise<void> {
    await this.kv.put(key, value, options);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}
