#!/usr/bin/env node

/*
 * PACKAGE.broker - Cloudflare CLI - Path Utilities
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Find @package-broker/main package in various locations
 */
export function findMainPackage(targetDir: string): string | null {
  // Try standard node_modules location
  const standardPath = join(
    targetDir,
    'node_modules',
    '@package-broker',
    'main'
  );
  if (existsSync(standardPath)) {
    return standardPath;
  }

  // Try parent directory node_modules (workspace root)
  const parentNodeModules = join(
    targetDir,
    '..',
    'node_modules',
    '@package-broker',
    'main'
  );
  if (existsSync(parentNodeModules)) {
    return parentNodeModules;
  }

  // Try monorepo structure (for development/testing)
  // Check if we're in a monorepo by looking for packages/main relative to current dir
  let currentPath = targetDir;
  for (let i = 0; i < 5; i++) {
    const monorepoPath = join(currentPath, 'packages', 'main');
    if (existsSync(monorepoPath)) {
      return monorepoPath;
    }
    const parentPath = join(currentPath, '..');
    if (parentPath === currentPath) break; // Reached filesystem root
    currentPath = parentPath;
  }

  return null;
}

/**
 * Find @package-broker/ui package in various locations
 */
export function findUiPackage(targetDir: string): string | null {
  // Try standard node_modules location
  const standardPath = join(
    targetDir,
    'node_modules',
    '@package-broker',
    'ui'
  );
  if (existsSync(standardPath)) {
    return standardPath;
  }

  // Try parent directory node_modules (workspace root)
  const parentNodeModules = join(
    targetDir,
    '..',
    'node_modules',
    '@package-broker',
    'ui'
  );
  if (existsSync(parentNodeModules)) {
    return parentNodeModules;
  }

  // Try monorepo structure (for development/testing)
  let currentPath = targetDir;
  for (let i = 0; i < 5; i++) {
    const monorepoPath = join(currentPath, 'packages', 'ui');
    if (existsSync(monorepoPath)) {
      return monorepoPath;
    }
    const parentPath = join(currentPath, '..');
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }

  return null;
}

/**
 * Find migrations directory from @package-broker/main
 */
export function findMigrationsDir(targetDir: string): string | null {
  const mainPackagePath = findMainPackage(targetDir);
  if (!mainPackagePath) {
    return null;
  }
  
  const migrationsDir = join(mainPackagePath, 'migrations');
  if (existsSync(migrationsDir)) {
    return migrationsDir;
  }
  
  return null;
}
