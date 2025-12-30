/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { OpenAPIContext } from '../../routes/api/types';
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

export async function deleteArtifact(c: OpenAPIContext<ArtifactsRouteEnv>): Promise<Response> {
  const { id } = c.req.valid('param');
  const db = c.get('database');

  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);

  if (!artifact) {
    return c.json({ error: 'Not Found', message: 'Artifact not found' }, 404);
  }

  const storageKey = buildStorageKey('private', artifact.repo_id, artifact.package_name, artifact.version);
  await c.env.STORAGE.delete(storageKey);

  await db.delete(artifacts).where(eq(artifacts.id, id));

  return c.json({ message: 'Artifact deleted' });
}

export async function cleanupArtifacts(c: OpenAPIContext<ArtifactsRouteEnv, { retention_days?: number }>): Promise<Response> {
  const body = c.req.valid('json');
  const retentionDays = body.retention_days ?? 90;
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - retentionDays * 24 * 60 * 60;

  const db = c.get('database');

  const oldArtifacts = await db
    .select()
    .from(artifacts)
    .where(lt(artifacts.last_downloaded_at, cutoffTimestamp));

  let deletedCount = 0;

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
