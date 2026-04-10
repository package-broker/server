/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { BrokerPlugin } from '../../kernel/plugin';
import type { SyncObserver } from '../../kernel/hooks';
import { SecurityAdvisoryService } from './advisory-service';
import { AdvisoryDatabase } from './advisory-db';
import { setSecurityAdvisoryServiceInstance } from './advisory.handlers';
import { getLogger } from '../../utils/logger';

export { SecurityAdvisoryService } from './advisory-service';
export { AdvisoryDatabase, type SecurityAdvisory } from './advisory-db';

interface SecurityAdvisoryServices extends Record<string, unknown> {
  securityAdvisoryService: SecurityAdvisoryService;
  securityAdvisoryDb: AdvisoryDatabase;
}

interface SecurityAdvisoryEvents extends Record<string, unknown> {
  'package.synced': { packageName: string; version: string };
  'security.advisory.found': {
    packageName: string;
    version: string;
    advisoryCount: number;
  };
}

/**
 * Security Advisories Plugin
 *
 * The first real plugin built on the Phase 0 kernel. It:
 * 1. Registers a SecurityAdvisoryService in the service container
 * 2. Subscribes to `package.synced` events to check packages
 * 3. Emits `security.advisory.found` when vulnerabilities are detected
 * 4. Adds a sync observer to scan packages after repository sync
 */
export const securityAdvisoriesPlugin: BrokerPlugin<
  SecurityAdvisoryServices,
  SecurityAdvisoryEvents
> = {
  name: 'security-advisories',
  version: '1.0.0',

  register(ctx) {
    const logger = getLogger();
    const db = new AdvisoryDatabase();
    const service = new SecurityAdvisoryService(db);

    // Share service instance with HTTP handlers
    setSecurityAdvisoryServiceInstance(service);

    // Register services
    ctx.services.register('securityAdvisoryDb', () => db);
    ctx.services.register('securityAdvisoryService', () => service);

    // Subscribe to package.synced events — store unsubscribe handle
    const unsubscribeSynced = ctx.events.on('package.synced', async (payload) => {
      const { packageName, version } = payload;

      try {
        const result = await service.checkPackage(packageName, version);

        if (result.is_vulnerable) {
          logger.warn('Security advisory found', {
            package: packageName,
            version,
            advisoryCount: result.advisories.length,
          });

          ctx.events.emit('security.advisory.found', {
            packageName,
            version,
            advisoryCount: result.advisories.length,
          });
        }
      } catch (err) {
        logger.error(
          'Security advisory check failed',
          { package: packageName, version },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    });

    // Add sync observer — store reference for cleanup
    const syncObserver: SyncObserver = async (payload: unknown) => {
      const syncPayload = payload as {
        repoId?: string;
        packages?: Array<{ name: string; version: string }>;
      };

      if (!syncPayload.packages || syncPayload.packages.length === 0) return;

      try {
        const results = await service.checkPackages(syncPayload.packages);
        const vulnerable = results.filter((r) => r.is_vulnerable);

        if (vulnerable.length > 0) {
          logger.warn('Vulnerable packages detected after sync', {
            repoId: syncPayload.repoId,
            vulnerableCount: vulnerable.length,
            totalChecked: syncPayload.packages.length,
          });
        }
      } catch (err) {
        logger.error(
          'Post-sync security scan failed',
          { repoId: syncPayload.repoId },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    };

    ctx.hooks.addSyncObserver(syncObserver);

    // Store cleanup references on the plugin object for dispose()
    (securityAdvisoriesPlugin as any)._unsubscribeSynced = unsubscribeSynced;
    (securityAdvisoriesPlugin as any)._syncObserver = syncObserver;
    (securityAdvisoriesPlugin as any)._hooks = ctx.hooks;

    logger.info('Security advisories plugin registered');
  },

  async dispose() {
    const logger = getLogger();

    // Clean up event subscription
    const unsubscribe = (securityAdvisoriesPlugin as any)._unsubscribeSynced;
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }

    // Clean up sync observer
    const hooks = (securityAdvisoriesPlugin as any)._hooks;
    const observer = (securityAdvisoriesPlugin as any)._syncObserver;
    if (hooks && observer) {
      hooks.removeSyncObserver(observer);
    }

    // Reset shared service instance
    setSecurityAdvisoryServiceInstance(null as any);

    logger.info('Security advisories plugin disposed');
  },
};
