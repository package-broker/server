// Composer version middleware - reject Composer 1.x

import type { Context, Next } from 'hono';

/**
 * Middleware to reject Composer 1.x requests
 * Returns 406 Not Acceptable for Composer/1.* User-Agent
 */
export async function composerVersionMiddleware(
  c: Context,
  next: () => Promise<Response>
): Promise<Response> {
  const userAgent = c.req.header('User-Agent') || '';

  // Reject Composer 1.x
  if (userAgent.startsWith('Composer/1.')) {
    return c.json(
      {
        error: 'Composer 2.x required',
        message: 'This proxy only supports Composer 2.x. Please upgrade your Composer installation.',
      },
      406
    );
  }

  // Allow Composer 2.x and other clients
  return await next();
}

