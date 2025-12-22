/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Queue consumer for async database updates

import { createD1Database } from '../db';
import { tokens, artifacts, repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { QueueMessage } from './types';
import { getLogger } from '../utils/logger';

export interface QueueConsumerEnv {
  DB: D1Database;
}

/**
 * Process queue messages for async database updates
 * Optimized for free tier: batch operations where possible
 */
export async function processQueueMessage(
  message: QueueMessage,
  env: QueueConsumerEnv
): Promise<void> {
  const db = createD1Database(env.DB);

  switch (message.type) {
    case 'update_token_last_used': {
      await db
        .update(tokens)
        .set({ last_used_at: message.timestamp })
        .where(eq(tokens.id, message.tokenId));
      break;
    }

    case 'update_artifact_download': {
      // Update download_count and last_downloaded_at
      // First, get current count
      const [artifact] = await db
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, message.artifactId))
        .limit(1);

      if (artifact) {
        await db
          .update(artifacts)
          .set({
            download_count: (artifact.download_count ?? 0) + 1,
            last_downloaded_at: message.timestamp,
          })
          .where(eq(artifacts.id, message.artifactId));
      }
      break;
    }

    case 'update_repository_sync': {
      await db
        .update(repositories)
        .set({
          status: message.status,
          error_message: message.errorMessage || null,
          last_synced_at: message.timestamp,
        })
        .where(eq(repositories.id, message.repoId));
      break;
    }

    default: {
      const logger = getLogger();
      logger.warn('Unknown queue message type', { messageType: (message as any).type });
    }
  }
}

/**
 * Queue consumer worker entry point
 * This will be called by Cloudflare Queue when messages are available
 */
export default {
  async queue(batch: MessageBatch<QueueMessage>, env: QueueConsumerEnv): Promise<void> {
    // Process messages in batch (optimize for free tier)
    const promises = batch.messages.map((msg) => {
      try {
        return processQueueMessage(msg.body, env);
      } catch (error) {
        const logger = getLogger();
        logger.error('Error processing queue message', { messageType: msg.body.type }, error instanceof Error ? error : new Error(String(error)));
        // Don't retry on error - log and continue
        return Promise.resolve();
      }
    });

    await Promise.all(promises);
  },
};




