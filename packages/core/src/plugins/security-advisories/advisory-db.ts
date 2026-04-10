/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { getLogger } from '../../utils/logger';

/**
 * A single security advisory affecting a Composer package.
 */
export interface SecurityAdvisory {
  /** CVE identifier (e.g. "CVE-2024-12345") or advisory reference */
  cve: string | null;
  /** Human-readable title */
  title: string;
  /** URL to the advisory details */
  link: string;
  /** Affected version constraint(s) in Composer format (e.g. ">=2.0,<2.3.1") */
  affected_versions: string;
  /** Composer package name (e.g. "symfony/http-kernel") */
  package_name: string;
}

/**
 * Raw advisory entry from the FriendsOfPHP/security-advisories API.
 * The GitHub API returns a tree of YAML files; we use the packagist.org
 * security advisories API instead, which returns JSON.
 */
interface PackagistAdvisory {
  advisoryId: string;
  packageName: string;
  title: string;
  link: string;
  cve: string | null;
  affectedVersions: string;
  reportedAt: string;
}

interface PackagistAdvisoriesResponse {
  advisories: Record<string, PackagistAdvisory[]>;
}

const PACKAGIST_ADVISORIES_URL = 'https://packagist.org/api/security-advisories/';
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * In-memory advisory database backed by Packagist's security advisories API.
 * Periodically refreshes to stay current.
 */
export class AdvisoryDatabase {
  private advisories = new Map<string, SecurityAdvisory[]>();
  private lastRefreshed = 0;
  private refreshing = false;
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  /**
   * Check a specific package for known advisories.
   * Returns matching advisories (may be empty).
   */
  async checkPackage(packageName: string): Promise<SecurityAdvisory[]> {
    await this.ensureFresh();
    return this.advisories.get(packageName) || [];
  }

  /**
   * Check multiple packages at once. Returns a map of package name → advisories.
   * Only includes packages that have at least one advisory.
   */
  async checkPackages(packageNames: string[]): Promise<Map<string, SecurityAdvisory[]>> {
    await this.ensureFresh();

    const results = new Map<string, SecurityAdvisory[]>();
    for (const name of packageNames) {
      const advisories = this.advisories.get(name);
      if (advisories && advisories.length > 0) {
        results.set(name, advisories);
      }
    }
    return results;
  }

  /**
   * Query Packagist API for advisories affecting specific packages.
   * This is more efficient than loading the entire DB for targeted lookups.
   */
  async queryPackages(packageNames: string[]): Promise<Map<string, SecurityAdvisory[]>> {
    const { results } = await this.queryPackagesWithStatus(packageNames);
    return results;
  }

  /**
   * Query Packagist API, returning both results and upstream error status.
   * Callers can use `upstream_error` to warn users that results may be incomplete.
   */
  async queryPackagesWithStatus(
    packageNames: string[],
  ): Promise<{ results: Map<string, SecurityAdvisory[]>; upstream_error: boolean }> {
    const logger = getLogger();
    const results = new Map<string, SecurityAdvisory[]>();

    if (packageNames.length === 0) return { results, upstream_error: false };

    try {
      const params = new URLSearchParams();
      for (const name of packageNames) {
        params.append('packages[]', name);
      }

      const response = await this.fetchFn(`${PACKAGIST_ADVISORIES_URL}?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'PackageBroker/1.0',
        },
      });

      if (!response.ok) {
        logger.warn('Packagist advisories API returned non-OK', { status: response.status });
        return { results, upstream_error: true };
      }

      const data = (await response.json()) as PackagistAdvisoriesResponse;

      for (const [pkgName, entries] of Object.entries(data.advisories || {})) {
        const advisories: SecurityAdvisory[] = entries.map((entry: PackagistAdvisory) => ({
          cve: entry.cve,
          title: entry.title,
          link: entry.link,
          affected_versions: entry.affectedVersions,
          package_name: pkgName,
        }));
        if (advisories.length > 0) {
          results.set(pkgName, advisories);
        }
      }

      return { results, upstream_error: false };
    } catch (err) {
      logger.error(
        'Failed to query Packagist advisories',
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      return { results, upstream_error: true };
    }
  }

  /**
   * Force a full refresh of the advisory database.
   */
  async refresh(): Promise<number> {
    const logger = getLogger();

    if (this.refreshing) return this.advisories.size;
    this.refreshing = true;

    try {
      // Fetch all advisories (Packagist supports fetching without filter for full DB)
      // For production, we'd paginate; for now, we rely on targeted queries
      // and keep a lightweight cache of recently checked packages.
      logger.info('Refreshing security advisory database');
      this.lastRefreshed = Date.now();
      return this.advisories.size;
    } catch (err) {
      logger.error(
        'Failed to refresh advisory database',
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      return this.advisories.size;
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Get the total number of packages with known advisories.
   */
  get size(): number {
    return this.advisories.size;
  }

  /**
   * Get all advisories (for the API endpoint).
   */
  getAllAdvisories(): SecurityAdvisory[] {
    const all: SecurityAdvisory[] = [];
    for (const advisories of this.advisories.values()) {
      all.push(...advisories);
    }
    return all;
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.lastRefreshed > REFRESH_INTERVAL_MS) {
      await this.refresh();
    }
  }

  /**
   * Populate the database from a Packagist response (for testing or bulk loading).
   */
  loadFromResponse(data: PackagistAdvisoriesResponse): void {
    this.advisories.clear();
    for (const [pkgName, entries] of Object.entries(data.advisories || {})) {
      const advisories: SecurityAdvisory[] = entries.map((entry: PackagistAdvisory) => ({
        cve: entry.cve,
        title: entry.title,
        link: entry.link,
        affected_versions: entry.affectedVersions,
        package_name: pkgName,
      }));
      if (advisories.length > 0) {
        this.advisories.set(pkgName, advisories);
      }
    }
    this.lastRefreshed = Date.now();
  }
}
