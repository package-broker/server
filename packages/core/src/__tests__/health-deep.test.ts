import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  WorkflowStep: class {},
  WorkflowEvent: class {},
}));

import { createApp } from '../factory';

describe('Deep health check', () => {
  it('returns degraded when no database is available', async () => {
    const app = createApp();

    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      status: 'ok' | 'degraded';
      timestamp: number;
      checks: Record<string, string>;
    };

    expect(body.status).toBe('degraded');
    expect(body.timestamp).toEqual(expect.any(Number));
    expect(body.checks).toEqual({ database: 'unavailable' });
  });

  it('returns ok when database is available', async () => {
    const limit = vi.fn(async () => []);
    const from = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ from }));
    const database = { select };

    const app = createApp({ database });

    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      status: 'ok' | 'degraded';
      timestamp: number;
      checks: Record<string, string>;
    };

    expect(body.status).toBe('ok');
    expect(body.timestamp).toEqual(expect.any(Number));
    expect(body.checks).toEqual({ database: 'ok' });
    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(0);
  });
});
