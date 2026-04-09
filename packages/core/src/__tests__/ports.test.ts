import { describe, expectTypeOf, it } from 'vitest';
import type {
  CachePort,
  DatabaseAdapter,
  QueuePort,
  RateLimiterPort,
  SessionStorePort,
  VcsProviderPort,
} from '../ports';
import type { Job } from '../jobs/processor';

describe('ports types', () => {
  it('CachePort exposes getJson', () => {
    expectTypeOf<CachePort['getJson']>().toBeFunction();
  });

  it('QueuePort uses Job payloads', () => {
    expectTypeOf<Parameters<QueuePort['send']>[0]>().toEqualTypeOf<Job>();
    expectTypeOf<Parameters<QueuePort['sendBatch']>[0]>().toEqualTypeOf<Job[]>();
  });

  it('exports the new port interfaces', () => {
    expectTypeOf<DatabaseAdapter>().toMatchTypeOf<DatabaseAdapter>();
    expectTypeOf<SessionStorePort>().toMatchTypeOf<SessionStorePort>();
    expectTypeOf<RateLimiterPort>().toMatchTypeOf<RateLimiterPort>();
    expectTypeOf<VcsProviderPort>().toMatchTypeOf<VcsProviderPort>();
  });
});
