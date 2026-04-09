// Authentication middleware

import type { Context } from 'hono';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { DatabasePort } from '../ports';
import { tokens, tokenScopes } from '../db/schema';
import { eq } from 'drizzle-orm';
import { TokenScopeService } from '../services/TokenScopeService';

export interface AuthContext {
  tokenId: string;
  tokenDescription: string;
  tokenPermissions: 'readonly' | 'write';
  scopeService: TokenScopeService;
}

/**
 * Extract Basic Auth credentials from request
 */
function extractBasicAuth(authHeader: string | undefined): {
  username: string;
  password: string;
} | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const encoded = authHeader.slice(6);
    const decoded = atob(encoded);
    const [username, password] = decoded.split(':', 2);
    return { username, password };
  } catch {
    return null;
  }
}

/**
 * Hash token using SHA-256 (for high-entropy tokens)
 */
function hashToken(token: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = sha256(data);
  return bytesToHex(hash);
}

/**
 * Check rate limit in KV
 * Note: KV has eventual consistency (up to 60s), rate limiting is approximate
 * If rateLimitMax is null, 0, or falsy, rate limiting is disabled and no KV operations are performed
 * If KV is unavailable, gracefully allows all requests (rate limiting not enforced)
 */
async function checkRateLimit(
  kv: KVNamespace | undefined,
  tokenId: string,
  rateLimitMax: number | null
): Promise<{ allowed: boolean; remaining: number }> {
  // If rate limiting is disabled (null, 0, or falsy), skip all operations
  if (!rateLimitMax || rateLimitMax <= 0) {
    return { allowed: true, remaining: Infinity };
  }

  // If KV is not available, allow request (graceful degradation)
  if (!kv) {
    return { allowed: true, remaining: Infinity };
  }

  const hour = Math.floor(Date.now() / (1000 * 60 * 60));
  const key = `rate_limit:${tokenId}:${hour}`;

  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= rateLimitMax) {
    return { allowed: false, remaining: 0 };
  }

  // Increment count (eventual consistency is acceptable)
  await kv.put(key, String(count + 1), { expirationTtl: 3600 });

  return { allowed: true, remaining: rateLimitMax - count - 1 };
}

/**
 * Check if request has valid admin session (Bearer token)
 * Sessions require KV - if KV is unavailable, sessions won't work
 */
async function checkAdminSession(
  kv: KVNamespace | undefined,
  authHeader: string | undefined
): Promise<{ valid: boolean; session?: { userId: string; email: string } }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false };
  }

  // Sessions require KV - if unavailable, no sessions can be validated
  if (!kv) {
    return { valid: false };
  }

  const token = authHeader.slice(7);
  const sessionData = await kv.get(`session:${token}`, 'json') as { userId: string; email: string } | null;

  if (!sessionData) {
    return { valid: false };
  }

  return { valid: true, session: sessionData };
}

/**
 * Dual authentication middleware for dist route
 * Accepts either Composer token (Basic Auth) OR admin session (Bearer token)
 */
export async function distAuthMiddleware(
  c: Context<{
    Bindings: {
      DB: D1Database;
      KV?: KVNamespace; // Optional - only needed for rate limiting
      QUEUE?: Queue;
    };
    Variables: {
      auth?: AuthContext;
      session?: { userId: string; email: string };
      database: DatabasePort;
    };
  }>,
  next: () => Promise<Response>
): Promise<Response> {
  const authHeader = c.req.header('Authorization');

  // Try admin session first (Bearer token) - for UI downloads
  const sessionResult = await checkAdminSession(c.env.KV, authHeader);
  if (sessionResult.valid && sessionResult.session) {
    c.set('session', sessionResult.session);
    return await next();
  }

  // Fall back to Composer token auth (Basic Auth) - for composer CLI
  const credentials = extractBasicAuth(authHeader);
  if (!credentials) {
    return c.json({ error: 'Unauthorized', message: 'Authentication required (Bearer session or Basic token)' }, 401);
  }

  // Token is passed as password, username should be "token"
  if (credentials.username !== 'token') {
    return c.json({ error: 'Unauthorized', message: 'Username must be "token"' }, 401);
  }

  const token = credentials.password;
  if (!token) {
    return c.json({ error: 'Unauthorized', message: 'Token required in password field' }, 401);
  }

  const tokenHash = hashToken(token);

  // Query D1 first to check if rate limiting is enabled
  // We need this to decide whether to use KV cache (skip KV ops if rate limiting is disabled)
  const db = c.get('database');
  const [dbToken] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token_hash, tokenHash))
    .limit(1);

  let tokenRecord: (typeof tokens.$inferSelect) | null = dbToken || null;

  // Only use KV cache if rate limiting is enabled (rate_limit_max > 0) and KV is available
  // This avoids unnecessary KV operations when rate limiting is disabled
  if (tokenRecord && tokenRecord.rate_limit_max && tokenRecord.rate_limit_max > 0 && c.env.KV) {
    const cacheKey = `token:${tokenHash}`;
    try {
      const cached = await c.env.KV.get(cacheKey, 'json') as (typeof tokens.$inferSelect) | null;
      if (cached) {
        // Verify token hasn't expired
        if (!cached.expires_at || cached.expires_at >= Date.now() / 1000) {
          tokenRecord = cached;
        }
      }
    } catch {
      // Cache miss or error - use D1 result
    }

    // Cache for 5 seconds to handle burst requests (only if rate limiting is enabled)
    if (tokenRecord) {
      c.executionCtx.waitUntil(
        c.env.KV.put(cacheKey, JSON.stringify(tokenRecord), { expirationTtl: 5 }).catch(() => {
          // Ignore cache errors
        })
      );
    }
  }

  if (!tokenRecord) {
    return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
  }

  // Check expiration
  if (tokenRecord.expires_at && tokenRecord.expires_at < Date.now() / 1000) {
    return c.json({ error: 'Unauthorized', message: 'Token expired' }, 401);
  }

  // Check rate limit (skip if null/0 to avoid KV operations)
  const rateLimitMax = tokenRecord.rate_limit_max;
  const rateLimit = await checkRateLimit(c.env.KV, tokenRecord.id, rateLimitMax);
  if (!rateLimit.allowed) {
    return c.json({ error: 'Too Many Requests', message: 'Rate limit exceeded' }, 429);
  }

  // Load token scopes for access control
  const scopeRows = await db
    .select({ scope_type: tokenScopes.scope_type, scope_value: tokenScopes.scope_value })
    .from(tokenScopes)
    .where(eq(tokenScopes.token_id, tokenRecord.id));
  const scopeService = new TokenScopeService(
    scopeRows as { scope_type: 'repository' | 'package_pattern'; scope_value: string }[]
  );

  // Attach token info to context
  c.set('auth', {
    tokenId: tokenRecord.id,
    tokenDescription: tokenRecord.description,
    tokenPermissions: (tokenRecord.permissions || 'readonly') as 'readonly' | 'write',
    scopeService,
  });

  // Update last_used_at (non-blocking)
  c.executionCtx.waitUntil(
    (async () => {
      const db = c.get('database');
      if (c.env.QUEUE && typeof c.env.QUEUE.send === 'function') {
        await c.env.QUEUE.send({
          type: 'update_token_last_used',
          tokenId: tokenRecord.id,
          timestamp: Math.floor(Date.now() / 1000),
        });
      } else {
        await db
          .update(tokens)
          .set({ last_used_at: Math.floor(Date.now() / 1000) })
          .where(eq(tokens.id, tokenRecord.id));
      }
    })()
  );

  return await next();
}

/**
 * Authentication middleware
 * Validates Basic Auth -> D1 Token -> KV Rate Limit
 */
export async function authMiddleware(
  c: Context<{
    Bindings: {
      DB: D1Database;
      KV?: KVNamespace; // Optional - only needed for rate limiting
      QUEUE?: Queue; // Optional - only available on Workers Paid plan
    };
    Variables: {
      auth: AuthContext;
      database: DatabasePort;
      requestId?: string;
    };
  }>,
  next: () => Promise<Response>
): Promise<Response> {
  const authHeader = c.req.header('Authorization');
  const credentials = extractBasicAuth(authHeader);

  if (!credentials) {
    return c.json({ error: 'Unauthorized', message: 'Basic authentication required' }, 401);
  }

  // Token is passed as password, username should be "token"
  if (credentials.username !== 'token') {
    return c.json(
      { error: 'Unauthorized', message: 'Username must be "token"' },
      401
    );
  }

  const token = credentials.password;
  if (!token) {
    return c.json({ error: 'Unauthorized', message: 'Token required in password field' }, 401);
  }

  const tokenHash = hashToken(token);

  // Query D1 first to check if rate limiting is enabled
  // We need this to decide whether to use KV cache (skip KV ops if rate limiting is disabled)
  const db = c.get('database');
  const [dbToken] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.token_hash, tokenHash))
    .limit(1);

  let tokenRecord: (typeof tokens.$inferSelect) | null = dbToken || null;

  // Only use KV cache if rate limiting is enabled (rate_limit_max > 0) and KV is available
  // This avoids unnecessary KV operations when rate limiting is disabled
  if (tokenRecord && tokenRecord.rate_limit_max && tokenRecord.rate_limit_max > 0 && c.env.KV) {
    const cacheKey = `token:${tokenHash}`;
    try {
      const cached = await c.env.KV.get(cacheKey, 'json') as (typeof tokens.$inferSelect) | null;
      if (cached) {
        // Verify token hasn't expired
        if (!cached.expires_at || cached.expires_at >= Date.now() / 1000) {
          tokenRecord = cached;
        }
      }
    } catch {
      // Cache miss or error - use D1 result
    }

    // Cache for 5 seconds to handle burst requests (only if rate limiting is enabled)
    if (tokenRecord) {
      c.executionCtx.waitUntil(
        c.env.KV.put(cacheKey, JSON.stringify(tokenRecord), { expirationTtl: 5 }).catch(() => {
          // Ignore cache errors
        })
      );
    }
  }

  if (!tokenRecord) {
    return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
  }

  // Check expiration
  if (tokenRecord.expires_at && tokenRecord.expires_at < Date.now() / 1000) {
    return c.json({ error: 'Unauthorized', message: 'Token expired' }, 401);
  }

  const rateLimitMax = tokenRecord.rate_limit_max;
  const rateLimit = await checkRateLimit(c.env.KV, tokenRecord.id, rateLimitMax);
  if (!rateLimit.allowed) {
    return c.json(
      {
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
      },
      429
    );
  }

  // Load token scopes for access control
  const scopeRows = await db
    .select({ scope_type: tokenScopes.scope_type, scope_value: tokenScopes.scope_value })
    .from(tokenScopes)
    .where(eq(tokenScopes.token_id, tokenRecord.id));
  const scopeService = new TokenScopeService(
    scopeRows as { scope_type: 'repository' | 'package_pattern'; scope_value: string }[]
  );

  // Attach token info to context
  c.set('auth', {
    tokenId: tokenRecord.id,
    tokenDescription: tokenRecord.description,
    tokenPermissions: (tokenRecord.permissions || 'readonly') as 'readonly' | 'write',
    scopeService,
  });

  // Track token usage analytics
  const { getAnalytics } = await import('../utils/analytics');
  const analytics = getAnalytics();
  const requestId = c.get('requestId') as string | undefined;
  analytics.trackAuthTokenUsed({
    requestId,
    tokenId: tokenRecord.id,
  });

  // Update last_used_at (non-blocking)
  const updateTokenLastUsed = async () => {
    const db = c.get('database');
    if (c.env.QUEUE && typeof c.env.QUEUE.send === 'function') {
      // Use Queue for async processing (Paid plan)
      await c.env.QUEUE.send({
        type: 'update_token_last_used',
        tokenId: tokenRecord.id,
        timestamp: Math.floor(Date.now() / 1000),
      });
    } else {
      // Fallback: update directly in database (Free tier)
      await db
        .update(tokens)
        .set({ last_used_at: Math.floor(Date.now() / 1000) })
        .where(eq(tokens.id, tokenRecord.id));
    }
  };

  // Run in background to not block the response
  c.executionCtx.waitUntil(updateTokenLastUsed());

  return await next();
}

/**
 * Middleware to check token permissions
 * Requires write permission for certain operations
 */
export function checkTokenPermissions(requiredPermission: 'readonly' | 'write') {
  return async (
    c: Context<{
      Variables: {
        auth: AuthContext;
      };
    }>,
    next: () => Promise<Response>
  ): Promise<Response> => {
    const auth = c.get('auth');

    if (!auth) {
      return c.json({
        error: 'Unauthorized',
        message: 'Authentication required'
      }, 401);
    }

    const tokenPermission = auth.tokenPermissions || 'readonly';

    if (requiredPermission === 'write' && tokenPermission === 'readonly') {
      return c.json({
        error: 'Forbidden',
        message: 'This operation requires write permissions. Your token has read-only access.'
      }, 403);
    }

    return await next();
  };
}
