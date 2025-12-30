/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { OpenAPIContext } from '../../routes/api/types';
import type { DatabasePort } from '../../ports';
import { repositories, artifacts, packages } from '../../db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { updatePackagistMirroringRequestSchema } from '@package-broker/shared';

export interface StatsRouteEnv {
  Bindings: {
    DB: D1Database;
  };
  Variables: {
    database: DatabasePort;
  };
}

export interface SettingsRouteEnv {
  Bindings: {
    KV?: KVNamespace;
  };
}

const SETTINGS_PREFIX = 'settings:';
export const PACKAGIST_MIRRORING_KEY = `${SETTINGS_PREFIX}packagist_mirroring_enabled`;
export const PACKAGE_CACHING_KEY = `${SETTINGS_PREFIX}package_caching_enabled`;

function isKvAvailable(kv: KVNamespace | undefined): boolean {
  return kv !== undefined && kv !== null;
}

export async function getStats(c: OpenAPIContext<StatsRouteEnv>): Promise<Response> {
  const db = c.get('database');

  const [activeReposResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(repositories)
    .where(eq(repositories.status, 'active'));

  const activeRepos = activeReposResult?.count ?? 0;

  const [packagesResult] = await db.select({ count: sql<number>`count(*)` }).from(packages);
  const cachedPackages = packagesResult?.count ?? 0;

  const [downloadsResult] = await db
    .select({ total: sql<number>`sum(${artifacts.download_count})` })
    .from(artifacts);

  const totalDownloads = downloadsResult?.total ?? 0;

  return c.json({
    active_repos: activeRepos,
    cached_packages: cachedPackages,
    total_downloads: totalDownloads,
  });
}

export async function getPackageStats(c: OpenAPIContext<StatsRouteEnv>): Promise<Response> {
  const { name: nameParam, version } = c.req.valid('param');
  const name = decodeURIComponent(nameParam);
  const db = c.get('database');

  const [artifact] = await db
    .select({
      downloads: artifacts.download_count,
      last_downloaded: artifacts.last_downloaded_at
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.package_name, name),
        eq(artifacts.version, version)
      )
    )
    .limit(1);

  return c.json({
    downloads: artifact?.downloads || 0,
    last_downloaded: artifact?.last_downloaded || null
  });
}

export async function getSettings(c: OpenAPIContext<SettingsRouteEnv>): Promise<Response> {
  const kvAvailable = isKvAvailable(c.env.KV);
  const packagistMirroringEnabled = kvAvailable && c.env.KV
    ? await c.env.KV.get(PACKAGIST_MIRRORING_KEY)
    : null;
  const packageCachingEnabled = kvAvailable && c.env.KV
    ? await c.env.KV.get(PACKAGE_CACHING_KEY)
    : null;

  return c.json({
    kv_available: kvAvailable,
    packagist_mirroring_enabled: packagistMirroringEnabled === 'true',
    package_caching_enabled: packageCachingEnabled !== 'false',
  });
}

export async function updatePackagistMirroring(
  c: OpenAPIContext<SettingsRouteEnv, ReturnType<typeof updatePackagistMirroringRequestSchema.parse>>
): Promise<Response> {
  const body = c.req.valid('json');

  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'Bad Request', message: 'enabled must be a boolean' }, 400);
  }

  if (!isKvAvailable(c.env.KV) || !c.env.KV) {
    return c.json({ 
      error: 'Service Unavailable', 
      message: 'KV namespace is required for this setting. Please configure KV in your wrangler.toml.' 
    }, 503);
  }

  await c.env.KV.put(PACKAGIST_MIRRORING_KEY, String(body.enabled));

  return c.json({
    packagist_mirroring_enabled: body.enabled,
    message: body.enabled
      ? 'Public Packagist mirroring enabled'
      : 'Public Packagist mirroring disabled',
  });
}

export async function isPackagistMirroringEnabled(kv: KVNamespace | undefined): Promise<boolean> {
  if (!isKvAvailable(kv) || !kv) {
    return false;
  }
  const value = await kv.get(PACKAGIST_MIRRORING_KEY);
  return value === null || value === 'true';
}

export async function isPackageCachingEnabled(kv: KVNamespace | undefined): Promise<boolean> {
  if (!isKvAvailable(kv) || !kv) {
    return false;
  }
  const value = await kv.get(PACKAGE_CACHING_KEY);
  return value !== 'false';
}
