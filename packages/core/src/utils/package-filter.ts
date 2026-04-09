/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * Check if a package name matches a filter pattern.
 * Supports glob-style patterns: 'vendor/*' matches 'vendor/anything'.
 * Comma-separated patterns: 'vendor/*,other/pkg' matches either.
 */
export function matchesPackageFilter(packageName: string, filter: string): boolean {
  const patterns = filter.split(',').map((p) => p.trim().toLowerCase());
  const pkgLower = packageName.toLowerCase();

  return patterns.some((pattern) => {
    // Only support vendor/* style globs (must have / before *)
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1); // 'vendor/' from 'vendor/*'
      return pkgLower.startsWith(prefix);
    }
    return pkgLower === pattern;
  });
}
