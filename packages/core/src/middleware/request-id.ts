/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context, Next } from 'hono';
import { nanoid } from 'nanoid';
import { getLogger } from '../utils/logger';

/**
 * Request ID middleware
 * 
 * Generates a unique request ID for each request and stores it in context.
 * This ID is used for log correlation across the request lifecycle.
 */
export async function requestIdMiddleware(
  c: Context,
  next: Next
): Promise<void> {
  // Generate unique request ID
  const requestId = nanoid(16);

  // Store in context variables
  c.set('requestId', requestId);

  // Set request ID in logger for automatic inclusion in all logs
  const logger = getLogger();
  logger.setRequestId(requestId);

  // Log request start
  logger.info('Request started', {
    method: c.req.method,
    url: c.req.url,
    path: new URL(c.req.url).pathname,
  });

  // Call next middleware/handler
  await next();

  // Add request ID to response headers for debugging
  // Response is available after next() completes
  if (c.res) {
    c.res.headers.set('X-Request-ID', requestId);
  }
}

