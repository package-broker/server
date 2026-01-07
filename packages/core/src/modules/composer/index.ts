/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Composer module - public-facing Composer repository API
// CRITICAL: Routes MUST remain at root level for Composer protocol compatibility

import type { AppInstance } from '../../factory';
import { composerVersionMiddleware } from '../../middleware';
import { authMiddleware } from '../auth';
import { distAuthMiddleware } from '../../middleware/auth';
import {
  packagesJsonRoute,
  p2PackageRoute,
  distRoute,
  distMirrorRoute,
  distLockfileRoute,
} from './composer.handlers';

/**
 * Mount Composer routes directly on the app at root level
 * These routes MUST stay at root level to maintain Composer protocol compatibility:
 * - /packages.json
 * - /p2/:vendor/:package
 * - /dists/* (mirror format, matching Private Packagist style)
 */
export function mountComposerRoutes(app: AppInstance): void {
  const composerAuth = async (c: any, next: any) => {
    await composerVersionMiddleware(c, next);
  };
  const composerTokenAuth = async (c: any, next: any) => {
    return authMiddleware(c, next);
  };

  // GET /packages.json - aggregated packages.json for all repositories
  app.get('/packages.json', composerAuth, composerTokenAuth, packagesJsonRoute);

  // GET /p2/:vendor/:package - Packagist p2 provider format
  app.get('/p2/:vendor/:package', composerAuth, composerTokenAuth, p2PackageRoute);

  const distAuth = async (c: any, next: any) => {
    return distAuthMiddleware(c, next);
  };

  // GET /dists/:vendor/:package/:version/:reference - mirror URL format (Private Packagist style)
  // Server resolves repository from package name - no repo ID in URL
  // Reference can be a commit hash or generated reference
  app.get('/dists/:vendor/:package/:version/:reference', composerAuth, distAuth, distMirrorRoute);

  // Legacy routes for backwards compatibility
  // GET /dist/m/:vendor/:package/:version - old mirror URL format
  app.get('/dist/m/:vendor/:package/:version', composerAuth, distAuth, distMirrorRoute);

  // GET /dist/:vendor/:package/:version/:reference - lockfile format (legacy)
  app.get('/dist/:vendor/:package/:version/:reference', composerAuth, distAuth, distLockfileRoute);

  // GET /dist/:repo_id/:vendor/:package/:version - repository-specific format (legacy)
  app.get('/dist/:repo_id/:vendor/:package/:version', composerAuth, distAuth, distRoute);
}

// Re-export handlers for use by other modules if needed
export * from './composer.handlers';
