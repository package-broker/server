/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context } from 'hono';
import { SecurityAdvisoryService } from './advisory-service';
import { AdvisoryDatabase } from './advisory-db';
import type { SecurityAdvisory } from './advisory-db';
import { getLogger } from '../../utils/logger';

// Singleton service instance — shared with the plugin when loaded
let serviceInstance: SecurityAdvisoryService | null = null;

export function getSecurityAdvisoryService(): SecurityAdvisoryService {
  if (!serviceInstance) {
    serviceInstance = new SecurityAdvisoryService(new AdvisoryDatabase());
  }
  return serviceInstance;
}

export function setSecurityAdvisoryServiceInstance(service: SecurityAdvisoryService): void {
  serviceInstance = service;
}

/**
 * GET /api/security/advisories?packages=vendor/pkg1,vendor/pkg2
 */
export async function listAdvisories(c: Context): Promise<Response> {
  const logger = getLogger();
  const service = getSecurityAdvisoryService();

  try {
    const packagesParam = c.req.query('packages');

    if (!packagesParam) {
      return c.json({
        advisories: {},
        packages_checked: 0,
        vulnerable_count: 0,
      });
    }

    const packageNames = packagesParam
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);

    if (packageNames.length === 0) {
      return c.json({
        advisories: {},
        packages_checked: 0,
        vulnerable_count: 0,
      });
    }

    // Cap at 100 packages per request
    const cappedNames = packageNames.slice(0, 100);

    const { results: advisoryMap, upstream_error } =
      await service.getDatabase().queryPackagesWithStatus(cappedNames);

    const response: Record<string, SecurityAdvisory[]> = {};
    for (const [name, advisories] of advisoryMap) {
      response[name] = advisories;
    }

    return c.json({
      advisories: response,
      packages_checked: cappedNames.length,
      vulnerable_count: advisoryMap.size,
      ...(upstream_error && { upstream_error: true }),
    });
  } catch (err) {
    logger.error(
      'Error listing advisories',
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return c.json(
      { error: 'Internal Server Error', message: 'Failed to check security advisories' },
      500,
    );
  }
}

/**
 * GET /api/security/advisories/:vendor/:package/:version
 */
export async function checkPackageAdvisories(c: Context): Promise<Response> {
  const logger = getLogger();
  const service = getSecurityAdvisoryService();

  try {
    const vendor = c.req.param('vendor');
    const pkg = c.req.param('package');
    const version = c.req.param('version');

    if (!vendor || !pkg || !version) {
      return c.json({ error: 'Bad Request', message: 'Vendor, package, and version are required' }, 400);
    }

    const packageName = `${vendor}/${pkg}`;
    const result = await service.checkPackage(packageName, version);

    return c.json(result);
  } catch (err) {
    logger.error(
      'Error checking package advisories',
      { vendor: c.req.param('vendor'), package: c.req.param('package'), version: c.req.param('version') },
      err instanceof Error ? err : new Error(String(err)),
    );
    return c.json(
      { error: 'Internal Server Error', message: 'Failed to check security advisories' },
      500,
    );
  }
}
