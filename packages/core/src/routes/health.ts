/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context } from 'hono';
import { getLogger } from '../utils/logger';

/**
 * Health check endpoint
 * Returns 200 OK if service is healthy
 */
export async function healthRoute(c: Context): Promise<Response> {
  const logger = getLogger();
  logger.info('Health check requested', {
    method: c.req.method,
    url: c.req.url,
  });

  return c.json({
    status: 'ok',
    timestamp: Date.now(),
  });
}




