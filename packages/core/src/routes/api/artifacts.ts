// Artifacts API routes

import type { Context } from 'hono';
import type { DatabasePort } from '../../ports';
import { artifacts } from '../../db/schema';
import { eq, lt } from 'drizzle-orm';
import { buildStorageKey } from '../../storage/driver';
import type { StorageDriver } from '../../storage/driver';

export interface ArtifactsRouteEnv {
  Bindings: {
    DB: D1Database;
    STORAGE: StorageDriver;
  };
  Variables: {
    database: DatabasePort;
    storage: StorageDriver;
  };
}

/**
 * DELETE /api/artifacts/:id
 * Delete an artifact (from storage and database)
 */
export async function deleteArtifact(c: Context<ArtifactsRouteEnv>): Promise<Response> {
  const id = c.req.param('id');
  const db = c.get('database');

  // Get artifact to find storage key
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);

  if (!artifact) {
    return c.json({ error: 'Not Found', message: 'Artifact not found' }, 404);
  }

  // Delete from storage
  const storageKey = buildStorageKey('private', artifact.repo_id, artifact.package_name, artifact.version);
  await c.env.STORAGE.delete(storageKey);

  // Delete from database
  await db.delete(artifacts).where(eq(artifacts.id, id));

  return c.json({ message: 'Artifact deleted' });
}

/**
 * POST /api/artifacts/cleanup
 * Clean up old artifacts (on-demand cleanup)
 * Deletes artifacts where last_downloaded_at is older than retention_days
 */
export async function cleanupArtifacts(c: Context<ArtifactsRouteEnv>): Promise<Response> {
  const body = await c.req.json();
  const retentionDays = body.retention_days ?? 90; // Default 90 days
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - retentionDays * 24 * 60 * 60;

  const db = c.get('database');

  // Find old artifacts
  const oldArtifacts = await db
    .select()
    .from(artifacts)
    .where(lt(artifacts.last_downloaded_at, cutoffTimestamp));

  let deletedCount = 0;

  // Delete each artifact from storage and database
  for (const artifact of oldArtifacts) {
    const storageKey = buildStorageKey('private', artifact.repo_id, artifact.package_name, artifact.version);

    try {
      await c.env.STORAGE.delete(storageKey);
      await db.delete(artifacts).where(eq(artifacts.id, artifact.id));
      deletedCount++;
    } catch (error) {
      console.error(`Error deleting artifact ${artifact.id}:`, error);
    }
  }

  return c.json({
    message: 'Cleanup completed',
    deleted_count: deletedCount,
  });
}
