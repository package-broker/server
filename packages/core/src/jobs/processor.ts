/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Job Processor - abstraction for sync/async job execution
// Automatically falls back to synchronous execution when Queues are unavailable

import { createDatabase } from '../db';
import { tokens, artifacts, repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import { syncRepository, type SyncEnv, type SyncOptions } from '../sync/repository-sync';
import { getLogger } from '../utils/logger';

/**
 * Job types that can be processed
 */
export type Job =
  | {
      type: 'update_token_last_used';
      tokenId: string;
      timestamp: number;
    }
  | {
      type: 'update_artifact_download';
      artifactId: string;
      timestamp: number;
    }
  | {
      type: 'sync_repository';
      repoId: string;
    };

/**
 * Environment bindings required for job processing
 */
export interface JobEnv {
  DB: D1Database;
  KV?: KVNamespace; // Optional - only needed for some features
  QUEUE?: Queue;
  ENCRYPTION_KEY: string;
}

/**
 * Job Processor interface - can be implemented for Queue or Sync execution
 */
export interface JobProcessor {
  /**
   * Enqueue a job for processing
   * May execute immediately (sync) or queue for later (async)
   */
  enqueue(job: Job): Promise<void>;

  /**
   * Enqueue multiple jobs for processing
   * May execute in parallel (sync) or queue for later (async)
   */
  enqueueAll(jobs: Job[]): Promise<void>;
}

/**
 * Create the appropriate job processor based on environment
 * If QUEUE is available, uses QueueJobProcessor (async)
 * Otherwise, uses SyncJobProcessor (immediate execution)
 */
export function createJobProcessor(
  env: JobEnv,
  options?: { syncOptions?: SyncOptions }
): JobProcessor {
  if (env.QUEUE && typeof env.QUEUE.send === 'function') {
    return new QueueJobProcessor(env.QUEUE);
  }
  return new SyncJobProcessor(env, options?.syncOptions);
}

/**
 * Queue-based job processor - sends jobs to Cloudflare Queue
 * Jobs are processed asynchronously by queue consumers
 */
class QueueJobProcessor implements JobProcessor {
  constructor(private queue: Queue) {}

  async enqueue(job: Job): Promise<void> {
    await this.queue.send(job);
  }

  async enqueueAll(jobs: Job[]): Promise<void> {
    // Queue supports batch sending
    for (const job of jobs) {
      await this.queue.send(job);
    }
  }
}

/**
 * Synchronous job processor - executes jobs immediately
 * Used when Queues are not available (free tier / local dev)
 */
class SyncJobProcessor implements JobProcessor {
  constructor(
    private env: JobEnv,
    private syncOptions?: SyncOptions
  ) {}

  async enqueue(job: Job): Promise<void> {
    await this.processJob(job);
  }

  async enqueueAll(jobs: Job[]): Promise<void> {
    // Process jobs in parallel for better performance
    await Promise.all(jobs.map((job) => this.processJob(job)));
  }

  private async processJob(job: Job): Promise<void> {
    const db = createDatabase(this.env.DB);
    const logger = getLogger();

    try {
      switch (job.type) {
        case 'update_token_last_used':
          await db
            .update(tokens)
            .set({ last_used_at: job.timestamp })
            .where(eq(tokens.id, job.tokenId));
          break;

        case 'update_artifact_download':
          // Increment download count and update last_downloaded_at
          const [artifact] = await db
            .select()
            .from(artifacts)
            .where(eq(artifacts.id, job.artifactId))
            .limit(1);

          if (artifact) {
            await db
              .update(artifacts)
              .set({
                download_count: (artifact.download_count || 0) + 1,
                last_downloaded_at: job.timestamp,
              })
              .where(eq(artifacts.id, job.artifactId));
          }
          break;

        case 'sync_repository':
          if (!this.syncOptions) {
            logger.warn('SyncJobProcessor: syncOptions not provided, skipping sync', { repoId: job.repoId });
            return;
          }

          const syncEnv: SyncEnv = {
            DB: this.env.DB,
            KV: this.env.KV,
            QUEUE: this.env.QUEUE,
            ENCRYPTION_KEY: this.env.ENCRYPTION_KEY,
          };

          const result = await syncRepository(job.repoId, syncEnv, this.syncOptions);

          if (!result.success) {
            logger.error('Sync failed for repo', { repoId: job.repoId, error: result.error });
          } else {
            logger.info('Sync successful for repo', { repoId: job.repoId, packageCount: result.packages.length });
          }
          break;

        default:
          logger.warn('Unknown job type', { jobType: (job as any).type });
      }
    } catch (error) {
      logger.error('Job processing error', { jobType: job.type }, error instanceof Error ? error : new Error(String(error)));
      // Don't throw - we want to continue processing other jobs
    }
  }
}




