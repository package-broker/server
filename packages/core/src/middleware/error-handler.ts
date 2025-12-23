/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context } from 'hono';
import { getLogger } from '../utils/logger';

/**
 * Error handling middleware
 * Catches errors, logs to Workers Logs (free tier), and returns appropriate HTTP status
 */
export async function errorHandlerMiddleware(
  c: Context,
  next: () => Promise<Response>
): Promise<Response> {
  try {
    return await next();
  } catch (error) {
    const logger = getLogger();
    const requestId = c.get('requestId') as string | undefined;

    // Log error with structured context
    logger.error(
      'Request error',
      {
        url: c.req.url,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
      },
      error instanceof Error ? error : new Error(String(error))
    );

    // Return appropriate error response
    if (error instanceof Error) {
      // Known error types
      if (error.message.includes('Unauthorized')) {
        return c.json({ error: 'Unauthorized', message: error.message }, 401);
      }
      if (error.message.includes('Not Found')) {
        return c.json({ error: 'Not Found', message: error.message }, 404);
      }
      if (error.message.includes('Rate limit')) {
        return c.json({ error: 'Too Many Requests', message: error.message }, 429);
      }
    }

    // Generic error
    return c.json(
      {
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        ...(requestId && { requestId }),
      },
      500
    );
  }
}

