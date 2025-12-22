// Stats API route

import type { Context } from 'hono';
import type { DatabasePort } from '../../ports';
import { repositories, artifacts, packages } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';

export interface StatsRouteEnv {
  Bindings: {
    DB: D1Database;
  };
  Variables: {
    database: DatabasePort;
  };
}

/**
 * GET /api/stats
 * Get dashboard statistics
 */
export async function getStats(c: Context<StatsRouteEnv>): Promise<Response> {
  const db = c.get('database');

  // Active repositories count
  const [activeReposResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(repositories)
    .where(eq(repositories.status, 'active'));

  const activeRepos = activeReposResult?.count ?? 0;

  // Total cached packages count
  const [packagesResult] = await db.select({ count: sql<number>`count(*)` }).from(packages);
  const cachedPackages = packagesResult?.count ?? 0;

  // Total downloads (sum of download_count from artifacts)
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
