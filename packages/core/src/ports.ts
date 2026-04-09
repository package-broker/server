// Core ports (interfaces) for external infrastructure
// adhering to Hexagonal Architecture (Ports & Adapters)

import type { Database } from './db/index';
import type { Job } from './jobs/processor';

/**
 * Database Port
 * Represents the database connection/ORM instance.
 * Currently just aliasing the Drizzle type, but allows for future abstraction.
 */
export type DatabasePort = Database;

/**
 * Database Adapter Interface
 * Abstract interface for database adapters (SQLite, PostgreSQL, etc.)
 * Follows Port-Adapter pattern for database-agnostic operations
 */
export interface DatabaseAdapter {
    connect(): Promise<DatabasePort>;
    migrate(migrationsPath: string): Promise<void>;
    close(): Promise<void>;
    isHealthy(): Promise<boolean>;
}

/**
 * Cache Port
 * Abstract interface for caching (KV, Redis, Memory)
 */
export interface CachePort {
    get(key: string): Promise<string | null>;
    getJson<T>(key: string): Promise<T | null>;
    put(
        key: string,
        value: string | ReadableStream | ArrayBuffer | ArrayBufferView,
        options?: { expirationTtl?: number }
    ): Promise<void>;
    delete(key: string): Promise<void>;
}

/**
 * Queue Port
 * Abstract interface for job queues (Cloudflare Queues, BullMQ, SQS)
 */
export interface QueuePort {
    send(message: Job): Promise<void>;
    sendBatch(messages: Job[]): Promise<void>;
}

export interface SessionStorePort {
    getSession<T>(token: string): Promise<T | null>;
    setSession<T>(token: string, data: T, ttlSeconds: number): Promise<void>;
    deleteSession(token: string): Promise<void>;
}

export interface RateLimiterPort {
    checkAndIncrement(key: string, maxPerHour: number): Promise<{ allowed: boolean; remaining: number }>;
}

export interface VcsProviderPort {
    name: string;
    discoverPackages(org: string, token: string, filter?: string): Promise<DiscoveredPackage[]>;
    fetchPackageMetadata(repoUrl: string, token: string): Promise<PackageMetadata | null>;
    verifyCredentials(url: string, credentialType: string, credentials: string): Promise<boolean>;
}

export interface DiscoveredPackage {
    name: string;
    versions: string[];
    source: string;
}

export interface PackageMetadata {
    name: string;
    description?: string;
    versions: Record<string, unknown>;
}

export interface AnalyticsPort {
    track(event: string, properties?: Record<string, any>): void;
}

export type { StorageDriver as StoragePort } from './storage/driver';
