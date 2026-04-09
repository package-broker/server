import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  WorkflowStep: class {},
  WorkflowEvent: class {},
}));

import { createApp } from '../factory';

describe('Global error handler', () => {
  it('should not leak internal error messages in 500 responses', async () => {
    const app = createApp();
    app.get('/test-error', () => {
      throw new Error('SQL syntax error near table "users" at column "password_hash"');
    });

    const res = await app.request('/test-error');
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('An unexpected error occurred');
    expect(body.message).not.toContain('SQL');
    expect(body.message).not.toContain('password_hash');
    expect(body.requestId).toBeDefined();
  });

  it('should still return 4xx errors with useful messages', async () => {
    const app = createApp();
    const res = await app.request('/nonexistent-path');

    expect(res.status).not.toBe(500);
  });
});
