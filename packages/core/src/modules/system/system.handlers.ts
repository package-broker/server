/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context } from 'hono';
import type { OpenAPIContext } from '../../routes/api/types';
import { getLogger } from '../../utils/logger';
import { isSshSupported } from '../../utils/environment';

/**
 * Health check endpoint
 * Returns 200 OK if service is healthy
 */
export async function healthHandler(c: Context<{ Variables: any }>): Promise<Response> {
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

/**
 * SSH support check endpoint
 * Returns whether SSH key support is available in the current environment
 */
export async function sshSupportHandler(c: OpenAPIContext<{ Bindings: {}; Variables: {} }>): Promise<Response> {
  const sshSupported = isSshSupported();
  
  return c.json({
    ssh_supported: sshSupported,
  });
}
