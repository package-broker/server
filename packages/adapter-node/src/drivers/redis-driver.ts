
import Redis from 'ioredis';
import type { CachePort, QueuePort } from '@package-broker/core';

export class RedisDriver implements CachePort, QueuePort {
    private redis: Redis;

    constructor(url: string) {
        this.redis = new Redis(url);
    }

    // CachePort implementation
    async get(key: string): Promise<string | null> {
        return this.redis.get(key);
    }

    async getJson<T>(key: string): Promise<T | null> {
        const value = await this.redis.get(key);
        if (!value) return null;
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    async put(key: string, value: string | ReadableStream | ArrayBuffer | FormData, options?: { expirationTtl?: number }): Promise<void> {
        let stringValue: string;

        if (typeof value === 'string') {
            stringValue = value;
        } else {
            // Fallback for complex types - stringify if object/generic, or warn
            try {
                stringValue = JSON.stringify(value);
            } catch {
                stringValue = String(value);
            }
        }

        if (options?.expirationTtl) {
            await this.redis.set(key, stringValue, 'EX', options.expirationTtl);
        } else {
            await this.redis.set(key, stringValue);
        }
    }

    async delete(key: string): Promise<void> {
        await this.redis.del(key);
    }

    // QueuePort implementation
    async send(message: any): Promise<void> {
        await this.redis.rpush('jobs_queue', JSON.stringify(message));
    }

    async sendBatch(messages: any[]): Promise<void> {
        if (messages.length === 0) return;
        const pipeline = this.redis.pipeline();
        for (const msg of messages) {
            pipeline.rpush('jobs_queue', JSON.stringify(msg));
        }
        await pipeline.exec();
    }
}
