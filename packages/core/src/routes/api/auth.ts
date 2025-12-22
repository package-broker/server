/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Auth routes for admin login

import type { Context } from 'hono';
import { UserService } from '../../services/UserService';
import { getAnalytics } from '../../utils/analytics';

// Generate a session token
function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * POST /api/auth/login
 * Authenticate admin user and return session token
 */
export async function loginRoute(c: Context): Promise<Response> {
  const db = c.get('database');
  const userService = new UserService(db);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400);
  }

  const user = await userService.verifyCredentials(email, password);
  const requestId = c.get('requestId') as string | undefined;
  const analytics = getAnalytics();

  if (!user) {
    analytics.trackAuthLogin({
      requestId,
      userId: 'unknown',
      success: false,
    });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Check 2FA
  if (user.two_factor_enabled) {
    const { code } = body;
    if (!code) {
      return c.json({ error: '2FA required', code: '2fa_required' }, 403);
    }

    const isValid = await userService.validateTwoFactorLogin(user.id, code);
    if (!isValid) {
      analytics.trackAuthLogin({
        requestId,
        userId: user.id,
        success: false,
      });
      return c.json({ error: 'Invalid 2FA code' }, 401);
    }
  }

  // Generate session token
  const sessionToken = generateSessionToken();

  analytics.trackAuthLogin({
    requestId,
    userId: user.id,
    success: true,
  });

  // Store session in KV (expires in 24 hours)
  await c.env.KV.put(`session:${sessionToken}`, JSON.stringify({
    userId: user.id,
    email: user.email,
    role: user.role,
    createdAt: Date.now(),
  }), {
    expirationTtl: 86400, // 24 hours
  });

  return c.json({
    token: sessionToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      two_factor_enabled: user.two_factor_enabled,
    },
  });
}

/**
 * POST /api/auth/logout
 * Invalidate session token
 */
export async function logoutRoute(c: Context): Promise<Response> {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    await c.env.KV.delete(`session:${token}`);
  }
  return c.json({ message: 'Logged out' });
}

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
export async function meRoute(c: Context): Promise<Response> {
  const session = c.get('session');
  if (!session) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  // Refresh user data from DB to get latest status
  const db = c.get('database');
  const userService = new UserService(db);
  const user = await userService.findById(session.userId);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      two_factor_enabled: user.two_factor_enabled
    }
  });
}

/**
 * POST /api/setup
 * Create initial admin user
 */
export async function setupRoute(c: Context): Promise<Response> {
  const db = c.get('database');
  const userService = new UserService(db);

  // Check if any user exists
  const count = await userService.count();
  if (count > 0) {
    return c.json({ error: 'Setup already completed' }, 403);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 400);
  }

  // Create first admin
  const user = await userService.create({
    email,
    password,
    role: 'admin'
  });

  return c.json({
    message: 'Setup complete',
    user: {
      id: user?.id,
      email: user?.email
    }
  });
}

/**
 * POST /api/auth/2fa/setup
 * Start 2FA setup flow
 */
export async function setup2FARoute(c: Context): Promise<Response> {
  const db = c.get('database');
  const userService = new UserService(db);
  const session = c.get('session');

  // Generate new secret
  const secret = await userService.setupTwoFactor(session.userId);
  const qrCode = await userService.generateTwoFactorQrCode(session.email, secret);

  return c.json({ secret, qrCode });
}

/**
 * POST /api/auth/2fa/enable
 * Confirm 2FA setup with code
 */
export async function enable2FARoute(c: Context): Promise<Response> {
  const db = c.get('database');
  const userService = new UserService(db);
  const session = c.get('session');

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { secret, code } = body;

  if (!secret || !code) {
    return c.json({ error: 'Secret and code required' }, 400);
  }

  try {
    const recoveryCodes = await userService.enableTwoFactor(session.userId, secret, code);
    return c.json({ recoveryCodes });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
}

/**
 * POST /api/auth/2fa/disable
 * Disable 2FA
 */
export async function disable2FARoute(c: Context): Promise<Response> {
  const db = c.get('database');
  const userService = new UserService(db);
  const session = c.get('session');

  await userService.disableTwoFactor(session.userId);
  return c.json({ message: '2FA disabled' });
}

/**
 * POST /api/auth/invite/accept
 * Accept invite and set password
 */
export async function acceptInviteRoute(c: Context): Promise<Response> {
  const db = c.get('database');
  const userService = new UserService(db);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { token, password } = body;

  if (!token || !password) {
    return c.json({ error: 'Token and password required' }, 400);
  }

  try {
    const user = await userService.acceptInvite(token, password);
    return c.json({ message: 'Invite accepted', user: { email: user.email } });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
}

/**
 * Middleware to verify session token
 */
export async function sessionMiddleware(c: Context, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', message: 'Session token required' }, 401);
  }

  const token = authHeader.slice(7);

  // Check KV for session
  const sessionData = await c.env.KV.get(`session:${token}`, 'json');

  if (!sessionData) {
    return c.json({ error: 'Unauthorized', message: 'Invalid or expired session' }, 401);
  }

  // Attach session to context
  c.set('session', sessionData);

  return await next();
}

/**
 * Check if auth is required / setup is needed
 */
export async function checkAuthRequired(c: Context): Promise<Response> {
  const db = c.get('database');
  const userService = new UserService(db);

  const count = await userService.count();

  return c.json({
    authRequired: true,
    setupRequired: count === 0
  });
}




