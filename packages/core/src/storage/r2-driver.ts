// Cloudflare R2 storage driver

import type { StorageDriver } from './driver';

export interface R2DriverConfig {
  bucket: R2Bucket;
}

/**
 * R2 storage driver implementation
 */
export class R2Driver implements StorageDriver {
  constructor(private config: R2DriverConfig) {}

  async get(key: string): Promise<ReadableStream | null> {
    const object = await this.config.bucket.get(key);
    if (!object) {
      return null;
    }
    return object.body;
  }

  async put(key: string, data: ReadableStream | ArrayBuffer | Uint8Array): Promise<void> {
    await this.config.bucket.put(key, data);
  }

  async delete(key: string): Promise<void> {
    await this.config.bucket.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const object = await this.config.bucket.head(key);
    return object !== null;
  }
}

