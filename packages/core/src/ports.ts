// Core ports (interfaces) for external infrastructure
// adhering to Hexagonal Architecture (Ports & Adapters)

import type { Database } from './db/index';

/**
 * Database Port
 * Represents the database connection/ORM instance.
 * Currently just aliasing the Drizzle type, but allows for future abstraction.
 */
export type DatabasePort = Database;

/**
 * Cache Port
 * Abstract interface for caching (KV, Redis, Memory)
 */
export interface CachePort {
    get(key: string): Promise<string | null>;
    get<T>(key: string, type: 'json'): Promise<T | null>;
    put(key: string, value: string | ReadableStream | ArrayBuffer | FormData, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
}

/**
 * Queue Port
 * Abstract interface for job queues (Cloudflare Queues, BullMQ, SQS)
 */
export interface QueuePort {
    send(message: any): Promise<void>;
    sendBatch(messages: any[]): Promise<void>;
}

export interface AnalyticsPort {
    track(event: string, properties?: Record<string, any>): void;
}
