/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { OpenAPIContext } from '../../types/openapi';
import type { DatabasePort } from '../../ports';
import { tenants, tenantPackages, organizationMembers } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { nanoid } from 'nanoid';

interface TenantRouteEnv {
  Bindings: Record<string, unknown>;
  Variables: {
    database: DatabasePort;
    requestId?: string;
    session?: { userId: string; email: string };
    org_id?: string;
  };
}

async function getOrgMembership(
  db: DatabasePort,
  orgId: string,
  userId: string
): Promise<{ role: string } | undefined> {
  const [member] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.org_id, orgId), eq(organizationMembers.user_id, userId)))
    .limit(1);
  return member;
}

function canManage(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

function requireOrgId(c: OpenAPIContext<TenantRouteEnv>): string {
  // org_id comes from the parent route parameter set by middleware
  const orgId = c.get('org_id') as string | undefined;
  if (!orgId) {
    throw new HTTPException(500, { message: 'Internal configuration error' });
  }
  return orgId;
}

export async function listTenants(c: OpenAPIContext<TenantRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const orgId = requireOrgId(c);

  const membership = await getOrgMembership(db, orgId, session.userId);
  if (!membership) {
    return c.json({ error: 'Forbidden', message: 'You are not a member of this organization' }, 403);
  }

  const orgTenants = await db.select().from(tenants).where(eq(tenants.org_id, orgId));

  return c.json(
    orgTenants.map((t: typeof tenants.$inferSelect) => ({
      id: t.id,
      org_id: t.org_id,
      name: t.name,
      slug: t.slug,
      created_at: t.created_at,
    }))
  );
}

export async function createTenant(c: OpenAPIContext<TenantRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const orgId = requireOrgId(c);
  const validated = c.req.valid('json');

  const membership = await getOrgMembership(db, orgId, session.userId);
  if (!membership || !canManage(membership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  const name = validated.name.trim();
  const slug = validated.slug.trim().toLowerCase();

  // Check slug uniqueness within org
  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.org_id, orgId), eq(tenants.slug, slug)))
    .limit(1);

  if (existing) {
    return c.json({ error: 'Conflict', message: 'Tenant slug is already taken in this organization' }, 409);
  }

  const tenantId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(tenants).values({
    id: tenantId,
    org_id: orgId,
    name,
    slug,
    created_at: now,
  });

  return c.json(
    {
      id: tenantId,
      org_id: orgId,
      name,
      slug,
      created_at: now,
    },
    201
  );
}

export async function getTenant(c: OpenAPIContext<TenantRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const orgId = requireOrgId(c);
  const { id } = c.req.valid('param');

  const membership = await getOrgMembership(db, orgId, session.userId);
  if (!membership) {
    return c.json({ error: 'Forbidden', message: 'You are not a member of this organization' }, 403);
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.org_id, orgId)))
    .limit(1);

  if (!tenant) {
    return c.json({ error: 'Not Found', message: 'Tenant not found' }, 404);
  }

  return c.json({
    id: tenant.id,
    org_id: tenant.org_id,
    name: tenant.name,
    slug: tenant.slug,
    created_at: tenant.created_at,
  });
}

export async function updateTenant(c: OpenAPIContext<TenantRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const orgId = requireOrgId(c);
  const { id } = c.req.valid('param');
  const validated = c.req.valid('json');

  const membership = await getOrgMembership(db, orgId, session.userId);
  if (!membership || !canManage(membership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.org_id, orgId)))
    .limit(1);

  if (!tenant) {
    return c.json({ error: 'Not Found', message: 'Tenant not found' }, 404);
  }

  const updateData: Partial<typeof tenants.$inferInsert> = {};
  if (validated.name !== undefined) {
    updateData.name = validated.name.trim();
  }

  if (Object.keys(updateData).length > 0) {
    await db.update(tenants).set(updateData).where(eq(tenants.id, id));
  }

  const [updated] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);

  return c.json({
    id: updated.id,
    org_id: updated.org_id,
    name: updated.name,
    slug: updated.slug,
    created_at: updated.created_at,
  });
}

export async function deleteTenant(c: OpenAPIContext<TenantRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const orgId = requireOrgId(c);
  const { id } = c.req.valid('param');

  const membership = await getOrgMembership(db, orgId, session.userId);
  if (!membership || !canManage(membership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.org_id, orgId)))
    .limit(1);

  if (!tenant) {
    return c.json({ error: 'Not Found', message: 'Tenant not found' }, 404);
  }

  await db.delete(tenants).where(and(eq(tenants.id, id), eq(tenants.org_id, orgId)));

  return c.json({ message: 'Tenant deleted' });
}

// Tenant package patterns
export async function listTenantPackages(c: OpenAPIContext<TenantRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const orgId = requireOrgId(c);
  const { id } = c.req.valid('param');

  const membership = await getOrgMembership(db, orgId, session.userId);
  if (!membership) {
    return c.json({ error: 'Forbidden', message: 'You are not a member of this organization' }, 403);
  }

  // Verify tenant belongs to org
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.org_id, orgId)))
    .limit(1);

  if (!tenant) {
    return c.json({ error: 'Not Found', message: 'Tenant not found' }, 404);
  }

  const patterns = await db
    .select()
    .from(tenantPackages)
    .where(eq(tenantPackages.tenant_id, id));

  return c.json(
    patterns.map((p: typeof tenantPackages.$inferSelect) => ({
      id: p.id,
      tenant_id: p.tenant_id,
      package_pattern: p.package_pattern,
      access_level: p.access_level,
      created_at: p.created_at,
    }))
  );
}

export async function addTenantPackage(c: OpenAPIContext<TenantRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const orgId = requireOrgId(c);
  const { id } = c.req.valid('param');
  const validated = c.req.valid('json');

  const membership = await getOrgMembership(db, orgId, session.userId);
  if (!membership || !canManage(membership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  // Verify tenant belongs to org
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.org_id, orgId)))
    .limit(1);

  if (!tenant) {
    return c.json({ error: 'Not Found', message: 'Tenant not found' }, 404);
  }

  const pattern = validated.package_pattern.trim();

  // Check uniqueness (pattern format already validated by Zod schema)
  const [existing] = await db
    .select({ id: tenantPackages.id })
    .from(tenantPackages)
    .where(and(eq(tenantPackages.tenant_id, id), eq(tenantPackages.package_pattern, pattern)))
    .limit(1);

  if (existing) {
    return c.json({ error: 'Conflict', message: 'Package pattern already exists for this tenant' }, 409);
  }

  const pkgId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(tenantPackages).values({
    id: pkgId,
    tenant_id: id,
    package_pattern: pattern,
    access_level: validated.access_level,
    created_at: now,
  });

  return c.json(
    {
      id: pkgId,
      tenant_id: id,
      package_pattern: pattern,
      access_level: validated.access_level,
      created_at: now,
    },
    201
  );
}

export async function removeTenantPackage(c: OpenAPIContext<TenantRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const orgId = requireOrgId(c);
  const { id, package_id } = c.req.valid('param');

  const membership = await getOrgMembership(db, orgId, session.userId);
  if (!membership || !canManage(membership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  // Verify tenant belongs to org
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, id), eq(tenants.org_id, orgId)))
    .limit(1);

  if (!tenant) {
    return c.json({ error: 'Not Found', message: 'Tenant not found' }, 404);
  }

  const [pkg] = await db
    .select()
    .from(tenantPackages)
    .where(and(eq(tenantPackages.id, package_id), eq(tenantPackages.tenant_id, id)))
    .limit(1);

  if (!pkg) {
    return c.json({ error: 'Not Found', message: 'Package pattern not found' }, 404);
  }

  await db.delete(tenantPackages).where(eq(tenantPackages.id, package_id));

  return c.json({ message: 'Package pattern removed' });
}
