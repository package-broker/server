
import type { CachePort } from '../ports';

/**
 * In-memory cache driver
 * Useful for development and testing, or for local deployments without Redis
 */
export class MemoryCacheDriver implements CachePort {
  private cache = new Map<string, { value: any; expiresAt?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.cache.get(key);
    if (!item) return null;

    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    if (typeof item.value === 'string') {
      return item.value;
    }
    return JSON.stringify(item.value);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);
    if (!item) return null;

    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    if (typeof item.value === 'string') {
        try {
            return JSON.parse(item.value);
        } catch {
            return null;
        }
    }
    return item.value as T;
  }

  // Overload signature implementation to match interface
  async put(key: string, value: string | ReadableStream | ArrayBuffer | FormData, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + (options.expirationTtl * 1000) : undefined;
    
    // For simplicity in memory driver, we convert everything to string or store as is if it's simple
    // Note: ReadableStream support in memory driver is limited/not implemented for full compatibility,
    // usually we'd want to read it. For now assuming string or basic objects.
    
    let storedValue: any = value;
    
    if (value instanceof ReadableStream || value instanceof ArrayBuffer || value instanceof FormData) {
        // In a real memory implementation we might want to buffer this, 
        // but for CachePort usage in this app, it's mostly strings/JSON.
        console.warn('MemoryCacheDriver: complex types (Stream/Buffer/FormData) are not fully supported, storing as reference.');
    }

    this.cache.set(key, { value: storedValue, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }
}
