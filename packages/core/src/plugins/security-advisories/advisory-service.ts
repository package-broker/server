/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { AdvisoryDatabase, type SecurityAdvisory } from './advisory-db';
import { getLogger } from '../../utils/logger';
import semver from 'semver';

export interface VulnerabilityCheckResult {
  package_name: string;
  version: string;
  advisories: SecurityAdvisory[];
  is_vulnerable: boolean;
}

/**
 * Service for checking packages against known security advisories.
 * Uses the Packagist security advisories API for real-time lookups.
 */
export class SecurityAdvisoryService {
  private readonly db: AdvisoryDatabase;

  constructor(db?: AdvisoryDatabase) {
    this.db = db || new AdvisoryDatabase();
  }

  /**
   * Check a single package/version for vulnerabilities.
   */
  async checkPackage(packageName: string, version: string): Promise<VulnerabilityCheckResult> {
    const advisories = await this.db.queryPackages([packageName]);
    const packageAdvisories = advisories.get(packageName) || [];

    const matchingAdvisories = this.filterByVersion(packageAdvisories, version);

    return {
      package_name: packageName,
      version,
      advisories: matchingAdvisories,
      is_vulnerable: matchingAdvisories.length > 0,
    };
  }

  /**
   * Check multiple packages for vulnerabilities (batch).
   */
  async checkPackages(
    packages: Array<{ name: string; version: string }>,
  ): Promise<VulnerabilityCheckResult[]> {
    const uniqueNames = [...new Set(packages.map((p) => p.name))];
    const advisoryMap = await this.db.queryPackages(uniqueNames);

    return packages.map((pkg) => {
      const packageAdvisories = advisoryMap.get(pkg.name) || [];
      const matching = this.filterByVersion(packageAdvisories, pkg.version);

      return {
        package_name: pkg.name,
        version: pkg.version,
        advisories: matching,
        is_vulnerable: matching.length > 0,
      };
    });
  }

  /**
   * Get the underlying advisory database for direct access.
   */
  getDatabase(): AdvisoryDatabase {
    return this.db;
  }

  /**
   * Filter advisories by checking if the given version falls within the affected range.
   * Uses Composer-style version constraints (translated to semver ranges).
   */
  private filterByVersion(advisories: SecurityAdvisory[], version: string): SecurityAdvisory[] {
    const logger = getLogger();
    const cleanVersion = semver.clean(version);

    // If version is not valid semver (e.g. "dev-main"), return all advisories
    if (!cleanVersion) {
      return advisories;
    }

    return advisories.filter((advisory) => {
      try {
        const range = this.composerConstraintToSemver(advisory.affected_versions);
        if (!range) return true; // Can't parse → assume affected for safety
        return semver.satisfies(cleanVersion, range);
      } catch {
        // If we can't determine, err on the side of caution
        logger.debug('Could not parse version constraint', {
          constraint: advisory.affected_versions,
          version,
        });
        return true;
      }
    });
  }

  /**
   * Convert a Composer version constraint to a semver range.
   * Handles common patterns:
   * - ">=2.0,<2.3.1"  → ">=2.0.0 <2.3.1"
   * - ">=1.0,<1.5|>=2.0,<2.1"  → ">=1.0.0 <1.5.0 || >=2.0.0 <2.1.0"
   * - "<5.4.46"  → "<5.4.46"
   */
  private composerConstraintToSemver(constraint: string): string | null {
    if (!constraint) return null;

    // Split on pipe (OR) and handle each group
    const groups = constraint.split('|').map((group) => group.trim());
    const semverGroups = groups
      .map((group) => {
        // Split on comma (AND) within a group
        const parts = group.split(',').map((p) => p.trim());
        return parts
          .map((part) => {
            // Clean up Composer-specific syntax
            return part
              .replace(/^([<>=!]+)\s*/, '$1') // Remove whitespace after operators
              .replace(/^~/, '~') // Tilde range
              .replace(/^\^/, '^'); // Caret range
          })
          .join(' ');
      })
      .filter(Boolean);

    const result = semverGroups.join(' || ');
    // Verify the range is valid
    try {
      if (semver.validRange(result)) return result;
    } catch {
      // Fall through
    }
    return null;
  }
}
