// S3-compatible storage driver

import { AwsClient } from 'aws4fetch';
import type { StorageDriver } from './driver';

export interface S3DriverConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * S3-compatible storage driver implementation
 */
export class S3Driver implements StorageDriver {
  private client: AwsClient;

  constructor(private config: S3DriverConfig) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: 's3',
    });
  }

  private getUrl(key: string): string {
    // Handle endpoint with or without bucket
    const endpoint = this.config.endpoint.replace(/\/$/, '');
    return `${endpoint}/${this.config.bucket}/${key}`;
  }

  async get(key: string): Promise<ReadableStream | null> {
    const url = this.getUrl(key);
    const response = await this.client.fetch(url, {
      method: 'GET',
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`S3 GET failed: ${response.status} ${response.statusText}`);
    }

    return response.body;
  }

  async put(key: string, data: ReadableStream | ArrayBuffer | Uint8Array): Promise<void> {
    const url = this.getUrl(key);
    const response = await this.client.fetch(url, {
      method: 'PUT',
      body: data,
      headers: {
        'Content-Type': 'application/zip',
      },
    });

    if (!response.ok) {
      throw new Error(`S3 PUT failed: ${response.status} ${response.statusText}`);
    }
  }

  async delete(key: string): Promise<void> {
    const url = this.getUrl(key);
    const response = await this.client.fetch(url, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 DELETE failed: ${response.status} ${response.statusText}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const url = this.getUrl(key);
    const response = await this.client.fetch(url, {
      method: 'HEAD',
    });

    return response.ok;
  }
}

