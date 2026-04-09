/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { OpenAPIContext } from '../../types/openapi';
import type { DatabasePort } from '../../ports';
import { organizations, organizationMembers, users } from '../../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

interface OrgRouteEnv {
  Bindings: Record<string, unknown>;
  Variables: {
    database: DatabasePort;
    requestId?: string;
    session?: { userId: string; email: string };
  };
}

async function getMembership(
  db: DatabasePort,
  orgId: string,
  userId: string
): Promise<{ id: string; org_id: string; user_id: string; role: string; created_at: number } | undefined> {
  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.org_id, orgId), eq(organizationMembers.user_id, userId)))
    .limit(1);
  return member;
}

function canManageMembers(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

export async function listOrganizations(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };

  const memberships = await db
    .select({ org_id: organizationMembers.org_id })
    .from(organizationMembers)
    .where(eq(organizationMembers.user_id, session.userId));

  if (memberships.length === 0) {
    return c.json([]);
  }

  const orgIds = memberships.map((m: { org_id: string }) => m.org_id);
  const userOrgs = await db.select().from(organizations).where(inArray(organizations.id, orgIds));

  return c.json(
    userOrgs.map((org: typeof organizations.$inferSelect) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      owner_user_id: org.owner_user_id,
      created_at: org.created_at,
    }))
  );
}

export async function createOrganization(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const validated = c.req.valid('json');

  const name = validated.name.trim();
  const slug = validated.slug.trim().toLowerCase();

  // Check slug uniqueness
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  if (existing) {
    return c.json({ error: 'Conflict', message: 'Organization slug is already taken' }, 409);
  }

  const orgId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(organizations).values({
    id: orgId,
    name,
    slug,
    owner_user_id: session.userId,
    created_at: now,
  });

  // Add the creator as owner member
  await db.insert(organizationMembers).values({
    id: nanoid(),
    org_id: orgId,
    user_id: session.userId,
    role: 'owner',
    created_at: now,
  });

  return c.json(
    {
      id: orgId,
      name,
      slug,
      owner_user_id: session.userId,
      created_at: now,
    },
    201
  );
}

export async function getOrganization(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const { id } = c.req.valid('param');

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) {
    return c.json({ error: 'Not Found', message: 'Organization not found' }, 404);
  }

  const membership = await getMembership(db, id, session.userId);
  if (!membership) {
    return c.json({ error: 'Forbidden', message: 'You are not a member of this organization' }, 403);
  }

  return c.json({
    id: org.id,
    name: org.name,
    slug: org.slug,
    owner_user_id: org.owner_user_id,
    created_at: org.created_at,
  });
}

export async function updateOrganization(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const { id } = c.req.valid('param');
  const validated = c.req.valid('json');

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) {
    return c.json({ error: 'Not Found', message: 'Organization not found' }, 404);
  }

  const membership = await getMembership(db, id, session.userId);
  if (!membership || !canManageMembers(membership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  const updateData: Partial<typeof organizations.$inferInsert> = {};
  if (validated.name !== undefined) {
    updateData.name = validated.name.trim();
  }

  if (Object.keys(updateData).length > 0) {
    await db.update(organizations).set(updateData).where(eq(organizations.id, id));
  }

  const [updated] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);

  return c.json({
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    owner_user_id: updated.owner_user_id,
    created_at: updated.created_at,
  });
}

export async function deleteOrganization(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const { id } = c.req.valid('param');

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) {
    return c.json({ error: 'Not Found', message: 'Organization not found' }, 404);
  }

  if (org.owner_user_id !== session.userId) {
    return c.json({ error: 'Forbidden', message: 'Only the owner can delete the organization' }, 403);
  }

  await db.delete(organizations).where(eq(organizations.id, id));

  return c.json({ message: 'Organization deleted' });
}

export async function listMembers(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const { id } = c.req.valid('param');

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) {
    return c.json({ error: 'Not Found', message: 'Organization not found' }, 404);
  }

  const membership = await getMembership(db, id, session.userId);
  if (!membership) {
    return c.json({ error: 'Forbidden', message: 'You are not a member of this organization' }, 403);
  }

  const members = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.org_id, id));

  return c.json(
    members.map((m: typeof organizationMembers.$inferSelect) => ({
      id: m.id,
      org_id: m.org_id,
      user_id: m.user_id,
      role: m.role,
      created_at: m.created_at,
    }))
  );
}

export async function addMember(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const { id } = c.req.valid('param');
  const validated = c.req.valid('json');

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) {
    return c.json({ error: 'Not Found', message: 'Organization not found' }, 404);
  }

  const membership = await getMembership(db, id, session.userId);
  if (!membership || !canManageMembers(membership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  // Verify the target user exists
  const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, validated.user_id)).limit(1);
  if (!targetUser) {
    return c.json({ error: 'Not Found', message: 'User not found' }, 404);
  }

  // Check if already a member
  const existingMembership = await getMembership(db, id, validated.user_id);
  if (existingMembership) {
    return c.json({ error: 'Conflict', message: 'User is already a member of this organization' }, 409);
  }

  const memberId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(organizationMembers).values({
    id: memberId,
    org_id: id,
    user_id: validated.user_id,
    role: validated.role,
    created_at: now,
  });

  return c.json(
    {
      id: memberId,
      org_id: id,
      user_id: validated.user_id,
      role: validated.role,
      created_at: now,
    },
    201
  );
}

export async function updateMember(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const { id, user_id } = c.req.valid('param');
  const validated = c.req.valid('json');

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) {
    return c.json({ error: 'Not Found', message: 'Organization not found' }, 404);
  }

  const callerMembership = await getMembership(db, id, session.userId);
  if (!callerMembership || !canManageMembers(callerMembership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  const targetMembership = await getMembership(db, id, user_id);
  if (!targetMembership) {
    return c.json({ error: 'Not Found', message: 'Member not found' }, 404);
  }

  // Cannot change the owner's role
  if (targetMembership.role === 'owner') {
    return c.json({ error: 'Forbidden', message: 'Cannot change the owner role' }, 403);
  }

  // Only owner can change admin roles (promote to or demote from admin)
  if ((targetMembership.role === 'admin' || validated.role === 'admin') && callerMembership.role !== 'owner') {
    return c.json({ error: 'Forbidden', message: 'Only the owner can change admin roles' }, 403);
  }

  await db
    .update(organizationMembers)
    .set({ role: validated.role })
    .where(and(eq(organizationMembers.org_id, id), eq(organizationMembers.user_id, user_id)));

  const [updated] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.org_id, id), eq(organizationMembers.user_id, user_id)))
    .limit(1);

  return c.json({
    id: updated.id,
    org_id: updated.org_id,
    user_id: updated.user_id,
    role: updated.role,
    created_at: updated.created_at,
  });
}

export async function removeMember(c: OpenAPIContext<OrgRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const session = c.get('session') as { userId: string; email: string };
  const { id, user_id } = c.req.valid('param');

  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) {
    return c.json({ error: 'Not Found', message: 'Organization not found' }, 404);
  }

  const callerMembership = await getMembership(db, id, session.userId);
  if (!callerMembership || !canManageMembers(callerMembership.role)) {
    return c.json({ error: 'Forbidden', message: 'Requires owner or admin role' }, 403);
  }

  const targetMembership = await getMembership(db, id, user_id);
  if (!targetMembership) {
    return c.json({ error: 'Not Found', message: 'Member not found' }, 404);
  }

  // Cannot remove the owner
  if (targetMembership.role === 'owner') {
    return c.json({ error: 'Forbidden', message: 'Cannot remove the organization owner' }, 403);
  }

  // Admins cannot remove other admins (only owner can)
  if (targetMembership.role === 'admin' && callerMembership.role !== 'owner') {
    return c.json({ error: 'Forbidden', message: 'Only the owner can remove admins' }, 403);
  }

  await db
    .delete(organizationMembers)
    .where(and(eq(organizationMembers.org_id, id), eq(organizationMembers.user_id, user_id)));

  return c.json({ message: 'Member removed' });
}
