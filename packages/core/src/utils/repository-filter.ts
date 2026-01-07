/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * Check if a package name matches a repository's package_filter.
 * 
 * Supports:
 * - Exact matches: "vendor/package"
 * - Wildcard patterns: "vendor/*" matches all packages under vendor
 * - Prefix wildcards: "mirasvit*" matches "mirasvit-module", "mirasvit/foo"
 * 
 * @param packageFilter - Comma-separated list of package patterns (e.g., "vendor/*,other/package")
 * @param packageName - Package name to check (e.g., "vendor/package")
 * @returns true if package matches any pattern in the filter, or if filter is null/empty
 */
export function matchesPackageFilter(packageFilter: string | null, packageName: string): boolean {
  if (!packageFilter) return true;
  
  const patterns = packageFilter
    .split(',')
    .map((p: string) => p.trim().toLowerCase())
    .filter((p: string) => p.length > 0);
  
  if (patterns.length === 0) return true;

  const pkgLower = packageName.toLowerCase();
  
  return patterns.some((pattern: string) => {
    if (pattern.endsWith('/*')) {
      // Wildcard pattern: "vendor/*" matches "vendor/anything"
      const prefix = pattern.slice(0, -1); // "vendor/"
      return pkgLower.startsWith(prefix);
    }
    if (pattern.endsWith('*')) {
      // Prefix wildcard: "mirasvit*" matches "mirasvit-module", "mirasvit/foo"
      const prefix = pattern.slice(0, -1);
      return pkgLower.startsWith(prefix);
    }
    // Exact match
    return pkgLower === pattern;
  });
}

