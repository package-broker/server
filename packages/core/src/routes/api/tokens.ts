/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Token API routes

import type { Context } from 'hono';
import type { DatabasePort } from '../../ports';
import { tokens } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createTokenSchema, updateTokenSchema } from '@package-broker/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { nanoid, customAlphabet } from 'nanoid';
import { getAnalytics } from '../../utils/analytics';

// Generate high-entropy tokens (64 characters, URL-safe)
const generateToken = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 64);

export interface TokensRouteEnv {
  Bindings: {
    DB: D1Database;
    KV?: KVNamespace; // Optional - rate limiting requires it
  };
  Variables: {
    database: DatabasePort;
    requestId?: string;
    session?: { userId: string; email: string };
  };
}

/**
 * Hash token using SHA-256
 */
function hashToken(token: string): string {
  const hash = sha256(token);
  return bytesToHex(hash);
}

/**
 * Check if KV is available for rate limiting
 */
function isKvAvailableForRateLimiting(kv: KVNamespace | undefined): boolean {
  return kv !== undefined && kv !== null;
}

/**
 * GET /api/tokens
 * List all tokens (without exposing actual tokens)
 */
export async function listTokens(c: Context<TokensRouteEnv>): Promise<Response> {
  const db = c.get('database');
  const allTokens = await db.select().from(tokens).orderBy(tokens.created_at);

  const tokenList = allTokens.map((token: any) => ({
    id: token.id,
    description: token.description,
    permissions: token.permissions || 'readonly', // Fallback for existing tokens
    rate_limit_max: token.rate_limit_max,
    created_at: token.created_at,
    expires_at: token.expires_at,
    last_used_at: token.last_used_at,
  }));

  return c.json(tokenList);
}

/**
 * POST /api/tokens
 * Create a new token
 * Returns the token ONCE - it cannot be retrieved again
 */
export async function createToken(c: Context<TokensRouteEnv>): Promise<Response> {
  const body = await c.req.json();
  const validated = createTokenSchema.parse(body);

  // Validate: rate limiting requires KV
  if (validated.rate_limit_max !== null &&
    validated.rate_limit_max !== undefined &&
    validated.rate_limit_max > 0) {
    if (!isKvAvailableForRateLimiting(c.env.KV)) {
      return c.json({
        error: 'Bad Request',
        message: 'Rate limiting requires KV namespace to be configured. Please set rate_limit_max to null or 0, or configure KV namespace in your wrangler.toml.'
      }, 400);
    }
  }

  const db = c.get('database');
  const tokenId = nanoid();
  const token = generateToken(); // Generate high-entropy token
  const tokenHash = hashToken(token);

  // Use provided rate_limit_max, or default to 1000 only if not explicitly set to null/0
  const rateLimitMax = validated.rate_limit_max !== null && validated.rate_limit_max !== undefined
    ? validated.rate_limit_max
    : 1000;

  await db.insert(tokens).values({
    id: tokenId,
    description: validated.description,
    token_hash: tokenHash,
    permissions: validated.permissions || 'readonly',
    rate_limit_max: rateLimitMax,
    created_at: Math.floor(Date.now() / 1000),
    expires_at: validated.expires_at || null,
  });

  // Track token creation
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  const session = c.get('session') as { userId: string; email: string } | undefined;
  analytics.trackTokenCreated({
    requestId,
    tokenId,
    userId: session?.userId,
  });

  // Return token ONCE - it's never stored in plaintext
  return c.json(
    {
      id: tokenId,
      token: token, // Only time token is returned
      description: validated.description,
      permissions: validated.permissions || 'readonly',
      rate_limit_max: rateLimitMax,
      created_at: Math.floor(Date.now() / 1000),
      expires_at: validated.expires_at || null,
    },
    201
  );
}

/**
 * DELETE /api/tokens/:id
 * Revoke a token
 */
export async function deleteToken(c: Context<TokensRouteEnv>): Promise<Response> {
  const id = c.req.param('id');
  const db = c.get('database');

  // Check if exists
  const [token] = await db.select().from(tokens).where(eq(tokens.id, id)).limit(1);

  if (!token) {
    return c.json({ error: 'Not Found', message: 'Token not found' }, 404);
  }

  await db.delete(tokens).where(eq(tokens.id, id));

  // Track token revocation
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  const session = c.get('session') as { userId: string; email: string } | undefined;
  analytics.trackTokenDeleted({
    requestId,
    tokenId: id,
    userId: session?.userId,
  });

  return c.json({ message: 'Token revoked' });
}

/**
 * PATCH /api/tokens/:id
 * Update token description and/or rate_limit_max
 * Permissions cannot be changed after creation
 */
export async function updateToken(c: Context<TokensRouteEnv>): Promise<Response> {
  const id = c.req.param('id');
  const body = await c.req.json();
  const validated = updateTokenSchema.parse(body);

  // Validate: rate limiting requires KV
  if (validated.rate_limit_max !== null &&
    validated.rate_limit_max !== undefined &&
    validated.rate_limit_max > 0) {
    if (!isKvAvailableForRateLimiting(c.env.KV)) {
      return c.json({
        error: 'Bad Request',
        message: 'Rate limiting requires KV namespace to be configured. Please set rate_limit_max to null or 0, or configure KV namespace in your wrangler.toml.'
      }, 400);
    }
  }

  const db = c.get('database');

  // Check if token exists
  const [token] = await db.select().from(tokens).where(eq(tokens.id, id)).limit(1);

  if (!token) {
    return c.json({ error: 'Not Found', message: 'Token not found' }, 404);
  }

  // Build update object - only update provided fields
  const updateData: Partial<typeof tokens.$inferInsert> = {};
  if (validated.description !== undefined) {
    updateData.description = validated.description;
  }
  if (validated.rate_limit_max !== undefined) {
    // Allow null/0 to disable rate limiting
    updateData.rate_limit_max = validated.rate_limit_max;
  }

  // Only update if there are fields to update
  if (Object.keys(updateData).length > 0) {
    await db
      .update(tokens)
      .set(updateData)
      .where(eq(tokens.id, id));
  }

  // Fetch updated token
  const [updatedToken] = await db.select().from(tokens).where(eq(tokens.id, id)).limit(1);

  // Track token update (if analytics method exists)
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  const session = c.get('session') as { userId: string; email: string } | undefined;
  if (typeof (analytics as any).trackTokenUpdated === 'function') {
    (analytics as any).trackTokenUpdated({
      requestId,
      tokenId: id,
      userId: session?.userId,
    });
  }

  return c.json({
    id: updatedToken.id,
    description: updatedToken.description,
    permissions: updatedToken.permissions || 'readonly',
    rate_limit_max: updatedToken.rate_limit_max,
    created_at: updatedToken.created_at,
    expires_at: updatedToken.expires_at,
    last_used_at: updatedToken.last_used_at,
  });
}
