import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdvisoryDatabase } from '../plugins/security-advisories/advisory-db';
import { SecurityAdvisoryService } from '../plugins/security-advisories/advisory-service';
import {
  securityAdvisoriesPlugin,
} from '../plugins/security-advisories';
import {
  ServiceContainer,
  EventBus,
  HookRegistry,
  resetPluginRegistry,
  loadPlugin,
  type PluginContext,
} from '../kernel';

// Mock logger
vi.mock('../utils/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const SAMPLE_ADVISORIES_RESPONSE = {
  advisories: {
    'symfony/http-kernel': [
      {
        advisoryId: 'PKSA-abc1',
        packageName: 'symfony/http-kernel',
        title: 'RCE via fragment injection',
        link: 'https://symfony.com/cve-2024-001',
        cve: 'CVE-2024-00001',
        affectedVersions: '>=6.0,<6.3.5',
        reportedAt: '2024-01-15T00:00:00Z',
      },
      {
        advisoryId: 'PKSA-abc2',
        packageName: 'symfony/http-kernel',
        title: 'DoS via header parsing',
        link: 'https://symfony.com/cve-2024-002',
        cve: 'CVE-2024-00002',
        affectedVersions: '>=5.0,<5.4.40|>=6.0,<6.4.1',
        reportedAt: '2024-06-01T00:00:00Z',
      },
    ],
    'laravel/framework': [
      {
        advisoryId: 'PKSA-def1',
        packageName: 'laravel/framework',
        title: 'SQL injection in Eloquent',
        link: 'https://laravel.com/security',
        cve: 'CVE-2024-00003',
        affectedVersions: '>=10.0,<10.48.1',
        reportedAt: '2024-03-01T00:00:00Z',
      },
    ],
  },
};

// ─── AdvisoryDatabase ─────────────────────────────────────────────

describe('AdvisoryDatabase', () => {
  it('should load advisories from response', () => {
    const db = new AdvisoryDatabase();
    db.loadFromResponse(SAMPLE_ADVISORIES_RESPONSE);

    expect(db.size).toBe(2);
  });

  it('should check a package by name', async () => {
    const db = new AdvisoryDatabase();
    db.loadFromResponse(SAMPLE_ADVISORIES_RESPONSE);

    const advisories = await db.checkPackage('symfony/http-kernel');
    expect(advisories).toHaveLength(2);
    expect(advisories[0].cve).toBe('CVE-2024-00001');
  });

  it('should return empty for unknown packages', async () => {
    const db = new AdvisoryDatabase();
    db.loadFromResponse(SAMPLE_ADVISORIES_RESPONSE);

    const advisories = await db.checkPackage('unknown/package');
    expect(advisories).toHaveLength(0);
  });

  it('should check multiple packages at once', async () => {
    const db = new AdvisoryDatabase();
    db.loadFromResponse(SAMPLE_ADVISORIES_RESPONSE);

    const results = await db.checkPackages([
      'symfony/http-kernel',
      'laravel/framework',
      'unknown/pkg',
    ]);

    expect(results.size).toBe(2);
    expect(results.has('symfony/http-kernel')).toBe(true);
    expect(results.has('laravel/framework')).toBe(true);
    expect(results.has('unknown/pkg')).toBe(false);
  });

  it('should get all advisories', () => {
    const db = new AdvisoryDatabase();
    db.loadFromResponse(SAMPLE_ADVISORIES_RESPONSE);

    const all = db.getAllAdvisories();
    expect(all).toHaveLength(3);
  });

  it('should query Packagist API', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_ADVISORIES_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const db = new AdvisoryDatabase(mockFetch);
    const results = await db.queryPackages(['symfony/http-kernel']);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(results.size).toBe(2);
    expect(results.get('symfony/http-kernel')).toHaveLength(2);
  });

  it('should handle Packagist API errors gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Server Error', { status: 500 }),
    );

    const db = new AdvisoryDatabase(mockFetch);
    const results = await db.queryPackages(['symfony/http-kernel']);

    expect(results.size).toBe(0);
  });

  it('should report upstream_error on API failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Server Error', { status: 500 }),
    );

    const db = new AdvisoryDatabase(mockFetch);
    const { results, upstream_error } = await db.queryPackagesWithStatus(['symfony/http-kernel']);

    expect(results.size).toBe(0);
    expect(upstream_error).toBe(true);
  });

  it('should report no upstream_error on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_ADVISORIES_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const db = new AdvisoryDatabase(mockFetch);
    const { results, upstream_error } = await db.queryPackagesWithStatus(['symfony/http-kernel']);

    expect(results.size).toBe(2);
    expect(upstream_error).toBe(false);
  });

  it('should report upstream_error on network failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const db = new AdvisoryDatabase(mockFetch);
    const { upstream_error } = await db.queryPackagesWithStatus(['symfony/http-kernel']);

    expect(upstream_error).toBe(true);
  });
});

// ─── SecurityAdvisoryService ──────────────────────────────────────

describe('SecurityAdvisoryService', () => {
  let db: AdvisoryDatabase;
  let service: SecurityAdvisoryService;

  beforeEach(() => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_ADVISORIES_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    db = new AdvisoryDatabase(mockFetch);
    service = new SecurityAdvisoryService(db);
  });

  it('should check a vulnerable package', async () => {
    const result = await service.checkPackage('symfony/http-kernel', '6.3.0');

    expect(result.is_vulnerable).toBe(true);
    expect(result.package_name).toBe('symfony/http-kernel');
    expect(result.version).toBe('6.3.0');
    expect(result.advisories.length).toBeGreaterThan(0);
  });

  it('should report safe for patched versions', async () => {
    const result = await service.checkPackage('symfony/http-kernel', '6.4.2');

    // 6.4.2 is above the affected range <6.4.1 in second advisory,
    // and above <6.3.5 in first advisory
    expect(result.is_vulnerable).toBe(false);
  });

  it('should check multiple packages in batch', async () => {
    const results = await service.checkPackages([
      { name: 'symfony/http-kernel', version: '6.3.0' },
      { name: 'laravel/framework', version: '10.48.0' },
      { name: 'unknown/safe', version: '1.0.0' },
    ]);

    expect(results).toHaveLength(3);

    const symfony = results.find((r) => r.package_name === 'symfony/http-kernel');
    expect(symfony?.is_vulnerable).toBe(true);

    const laravel = results.find((r) => r.package_name === 'laravel/framework');
    expect(laravel?.is_vulnerable).toBe(true);

    const unknown = results.find((r) => r.package_name === 'unknown/safe');
    expect(unknown?.is_vulnerable).toBe(false);
  });

  it('should treat dev versions as potentially vulnerable', async () => {
    const result = await service.checkPackage('symfony/http-kernel', 'dev-main');

    // dev versions can't be compared with semver, so all advisories match
    expect(result.is_vulnerable).toBe(true);
  });
});

// ─── Plugin Registration ──────────────────────────────────────────

describe('securityAdvisoriesPlugin', () => {
  beforeEach(() => {
    resetPluginRegistry();
  });

  it('should have correct metadata', () => {
    expect(securityAdvisoriesPlugin.name).toBe('security-advisories');
    expect(securityAdvisoriesPlugin.version).toBe('1.0.0');
  });

  it('should register services in the container', async () => {
    const ctx: PluginContext<any, any> = {
      services: new ServiceContainer(),
      events: new EventBus(),
      hooks: new HookRegistry(),
    };

    await loadPlugin(securityAdvisoriesPlugin as any, ctx);

    expect(ctx.services.has('securityAdvisoryService')).toBe(true);
    expect(ctx.services.has('securityAdvisoryDb')).toBe(true);

    const service = ctx.services.get('securityAdvisoryService');
    expect(service).toBeInstanceOf(SecurityAdvisoryService);
  });

  it('should subscribe to package.synced events', async () => {
    const ctx: PluginContext<any, any> = {
      services: new ServiceContainer(),
      events: new EventBus(),
      hooks: new HookRegistry(),
    };

    await loadPlugin(securityAdvisoriesPlugin as any, ctx);

    // Emit a package.synced event — should not throw
    await expect(
      ctx.events.emit('package.synced', {
        packageName: 'safe/package',
        version: '1.0.0',
      }),
    ).resolves.toBeUndefined();
  });

  it('should add a sync observer', async () => {
    const ctx: PluginContext<any, any> = {
      services: new ServiceContainer(),
      events: new EventBus(),
      hooks: new HookRegistry(),
    };

    await loadPlugin(securityAdvisoriesPlugin as any, ctx);

    const observers = ctx.hooks.syncObservers();
    expect(observers).toHaveLength(1);
  });

  it('should have a dispose function', async () => {
    const ctx: PluginContext<any, any> = {
      services: new ServiceContainer(),
      events: new EventBus(),
      hooks: new HookRegistry(),
    };

    const handle = await loadPlugin(securityAdvisoriesPlugin as any, ctx);
    await expect(handle.dispose()).resolves.toBeUndefined();
  });
});
