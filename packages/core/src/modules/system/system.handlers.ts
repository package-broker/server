/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context } from 'hono';
import type { AppVariables } from '../../factory';
import { users } from '../../db/schema';
import type { OpenAPIContext } from '../../types/openapi';
import { getLogger } from '../../utils/logger';
import { isSshSupported } from '../../utils/environment';

/**
 * Health check endpoint
 * Returns 200 OK if service is healthy
 */
export async function healthHandler(c: Context<{ Variables: AppVariables }>): Promise<Response> {
  const logger = getLogger();
  logger.info('Health check requested', {
    method: c.req.method,
    url: c.req.url,
  });

  const checks: Record<string, string> = {};
  let overall: 'ok' | 'degraded' = 'ok';

  try {
    const db = c.get('database');

    if (db) {
      await db.select().from(users).limit(0);
      checks.database = 'ok';
    } else {
      checks.database = 'unavailable';
      overall = 'degraded';
    }
  } catch {
    checks.database = 'error';
    overall = 'degraded';
  }

  return c.json({
    status: overall,
    timestamp: Date.now(),
    checks,
  });
}

/**
 * SSH support check endpoint
 * Returns whether SSH key support is available in the current environment
 */
export async function sshSupportHandler(c: OpenAPIContext<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>): Promise<Response> {
  const sshSupported = isSshSupported();
  
  return c.json({
    ssh_supported: sshSupported,
  });
}
