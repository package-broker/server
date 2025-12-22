/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Settings API route

import type { Context } from 'hono';

export interface SettingsRouteEnv {
  Bindings: {
    KV?: KVNamespace; // Optional - rate limiting requires it
  };
}

// KV keys for settings
const SETTINGS_PREFIX = 'settings:';
const PACKAGIST_MIRRORING_KEY = `${SETTINGS_PREFIX}packagist_mirroring_enabled`;
export const PACKAGE_CACHING_KEY = `${SETTINGS_PREFIX}package_caching_enabled`;

/**
 * Check if KV is available and operational
 */
function isKvAvailable(kv: KVNamespace | undefined): boolean {
  return kv !== undefined && kv !== null;
}

/**
 * GET /api/settings
 * Get all settings including KV availability
 */
export async function getSettings(c: Context<SettingsRouteEnv>): Promise<Response> {
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
    package_caching_enabled: packageCachingEnabled !== 'false', // Default to true if KV available
  });
}

/**
 * PUT /api/settings/packagist-mirroring
 * Enable or disable public Packagist mirroring
 */
export async function updatePackagistMirroring(
  c: Context<SettingsRouteEnv>
): Promise<Response> {
  const body = await c.req.json() as { enabled: boolean };

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

/**
 * Check if Packagist mirroring is enabled
 * Used by the p2 route to determine whether to proxy to Packagist
 */
export async function isPackagistMirroringEnabled(kv: KVNamespace | undefined): Promise<boolean> {
  if (!isKvAvailable(kv) || !kv) {
    return false; // Default to false if KV unavailable
  }
  const value = await kv.get(PACKAGIST_MIRRORING_KEY);
  // Default to true if not set (backwards compatible)
  return value === null || value === 'true';
}

/**
 * Check if package caching is enabled
 * Used to optionally disable KV caching for packages (useful when hitting rate limits)
 */
export async function isPackageCachingEnabled(kv: KVNamespace | undefined): Promise<boolean> {
  if (!isKvAvailable(kv) || !kv) {
    return false; // Default to false if KV unavailable
  }
  const value = await kv.get(PACKAGE_CACHING_KEY);
  // Default to true if not set (backwards compatible)
  return value !== 'false';
}




