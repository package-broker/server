/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Tenant-scoped Composer routes
// Serves packages.json, p2, and dist endpoints filtered by tenant's authorized package patterns
// Routes: /org/:orgSlug/t/:tenantSlug/packages.json etc.
//
// These routes act as authorization gates: they resolve the org/tenant, verify the token
// is authorized, check the package against tenant patterns, then delegate to the main
// composer/dist handlers (in-process, no HTTP fetch) for the actual response.

import type { Context } from 'hono';
import type { DatabasePort } from '../../ports';
import { organizations, tenants, tenantPackages, packages, tokens, repositories } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { matchesPackageFilter } from '../../utils/package-filter';
import { type AuthContext } from '../../middleware/auth';
import { p2PackageRoute, distLockfileRoute } from './composer.handlers';

interface TenantComposerEnv {
  Bindings: {
    DB: D1Database;
    KV?: KVNamespace;
    ENCRYPTION_KEY: string;
  };
  Variables: {
    database: DatabasePort;
    requestId?: string;
    auth?: AuthContext;
  };
}

interface TenantContext {
  org: typeof organizations.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  patterns: Array<typeof tenantPackages.$inferSelect>;
  tenantBase: string;
}

/**
 * Resolve org and tenant from URL slugs, verify the token is authorized.
 * Returns null and sends an error response if resolution fails.
 */
async function resolveTenant(c: Context<TenantComposerEnv>): Promise<TenantContext | null> {
  const db = c.get('database');
  const orgSlug = c.req.param('orgSlug');
  const tenantSlug = c.req.param('tenantSlug');

  if (!orgSlug || !tenantSlug) {
    c.status(400);
    c.body('Bad Request');
    return null;
  }

  // Tenant routes REQUIRE token auth (not session-based)
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) {
    c.status(401);
    c.body('Token authentication required for tenant endpoints');
    return null;
  }

  // Resolve organization
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1);

  if (!org) {
    c.status(404);
    c.body('Organization not found');
    return null;
  }

  // Resolve tenant within org
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.org_id, org.id), eq(tenants.slug, tenantSlug)))
    .limit(1);

  if (!tenant) {
    c.status(404);
    c.body('Tenant not found');
    return null;
  }

  // Verify token is authorized for this org/tenant
  const [tokenRecord] = await db
    .select({ tenant_id: tokens.tenant_id, org_id: tokens.org_id })
    .from(tokens)
    .where(eq(tokens.id, auth.tokenId))
    .limit(1);

  if (tokenRecord) {
    // If token is scoped to a specific tenant, it must match
    if (tokenRecord.tenant_id && tokenRecord.tenant_id !== tenant.id) {
      c.status(403);
      c.body('Token is not authorized for this tenant');
      return null;
    }

    // If token is scoped to an org, it must match
    if (tokenRecord.org_id && tokenRecord.org_id !== org.id) {
      c.status(403);
      c.body('Token is not authorized for this organization');
      return null;
    }
  }

  // Load tenant's package patterns
  const patterns = await db
    .select()
    .from(tenantPackages)
    .where(eq(tenantPackages.tenant_id, tenant.id));

  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const tenantBase = `${baseUrl}/org/${encodeURIComponent(orgSlug)}/t/${encodeURIComponent(tenantSlug)}`;

  return { org, tenant, patterns, tenantBase };
}

/**
 * Check if a package name matches any of the tenant's authorized patterns.
 */
function isTenantAuthorized(packageName: string, patterns: Array<typeof tenantPackages.$inferSelect>): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((p) => matchesPackageFilter(packageName, p.package_pattern));
}

/**
 * GET /org/:orgSlug/t/:tenantSlug/packages.json
 * Returns packages.json filtered to only include packages matching tenant's patterns.
 */
export async function tenantPackagesJsonRoute(c: Context<TenantComposerEnv>): Promise<Response> {
  const ctx = await resolveTenant(c);
  if (!ctx) return c.res;

  const { patterns, tenantBase } = ctx;
  const db = c.get('database');

  if (patterns.length === 0) {
    return c.json({ packages: {} });
  }

  // Check if we have any active Composer repos (triggers lazy loading)
  const activeComposerRepos = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.status, 'active'), eq(repositories.vcs_type, 'composer')))
    .limit(1);

  if (activeComposerRepos.length > 0) {
    // Lazy loading mode: point to tenant-scoped p2/dist endpoints
    return c.json({
      'providers-lazy-url': `${tenantBase}/p2/%package%.json`,
      'metadata-url': `${tenantBase}/p2/%package%.json`,
      'mirrors': [
        {
          'dist-url': `${tenantBase}/dists/%package%/%version%/%reference%.%type%`,
          'preferred': true,
        },
      ],
      packages: {},
    });
  }

  // Direct packages mode (git repos only): load all and filter by tenant patterns
  const allPackages = await db.select().from(packages);

  const packagesMap: Record<string, Record<string, Record<string, unknown>>> = {};

  for (const pkg of allPackages) {
    if (!isTenantAuthorized(pkg.name, patterns)) continue;

    if (!packagesMap[pkg.name]) {
      packagesMap[pkg.name] = {};
    }

    // Build dist with tenant-scoped URLs (not global URLs)
    const [vendor, pkgName] = pkg.name.split('/');
    const dist: Record<string, unknown> = {
      type: 'zip',
      url: `${tenantBase}/dists/${encodeURIComponent(vendor)}/${encodeURIComponent(pkgName)}/${encodeURIComponent(pkg.version)}/${encodeURIComponent(pkg.dist_reference || 'latest')}.zip`,
    };

    packagesMap[pkg.name][pkg.version] = {
      name: pkg.name,
      version: pkg.version,
      dist,
    };
  }

  return c.json({ packages: packagesMap });
}

/**
 * GET /org/:orgSlug/t/:tenantSlug/p2/:vendor/:package.json
 * Tenant-scoped p2 provider: checks authorization then delegates to main p2 handler in-process.
 */
export async function tenantP2Route(c: Context<TenantComposerEnv>): Promise<Response> {
  const ctx = await resolveTenant(c);
  if (!ctx) return c.res;

  const vendor = c.req.param('vendor');
  const pkg = c.req.param('package');
  if (!vendor || !pkg) {
    return c.json({ error: 'Bad Request', message: 'Missing vendor or package parameter' }, 400);
  }

  const packagePart = pkg.replace(/\.json$/, '');
  const packageName = `${vendor}/${packagePart}`;

  if (!isTenantAuthorized(packageName, ctx.patterns)) {
    return c.json({ error: 'Forbidden', message: 'Package not authorized for this tenant' }, 403);
  }

  // Delegate to main p2 handler in-process (no HTTP fetch)
  return p2PackageRoute(c as any);
}

/**
 * GET /org/:orgSlug/t/:tenantSlug/dists/:vendor/:package/:version/:reference
 * Tenant-scoped dist: checks authorization then delegates to main dist handler in-process.
 */
export async function tenantDistRoute(c: Context<TenantComposerEnv>): Promise<Response> {
  const ctx = await resolveTenant(c);
  if (!ctx) return c.res;

  const vendor = c.req.param('vendor');
  const pkg = c.req.param('package');
  const version = c.req.param('version');
  const reference = c.req.param('reference');

  if (!vendor || !pkg || !version || !reference) {
    return c.json({ error: 'Bad Request', message: 'Missing required path parameters' }, 400);
  }

  const packageName = `${vendor}/${pkg}`;

  if (!isTenantAuthorized(packageName, ctx.patterns)) {
    return c.json({ error: 'Forbidden', message: 'Package not authorized for this tenant' }, 403);
  }

  // Delegate to main dist handler in-process (no HTTP fetch)
  return distLockfileRoute(c as any);
}
