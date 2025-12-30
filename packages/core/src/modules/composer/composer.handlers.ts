/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

// Composer routes - packages.json and p2 provider
// CRITICAL: These handlers maintain 100% Composer/Packagist protocol compatibility

// Re-export handlers from original files with adjusted imports
// This maintains exact behavior while allowing modular structure

export {
  packagesJsonRoute,
  p2PackageRoute,
  buildP2Response,
  ensurePackagistRepository,
  transformPackageDistUrls,
  storeLazyPackageMetadata,
  storePackageInDB,
  type ComposerRouteEnv,
} from '../../routes/composer';

export {
  distRoute,
  distMirrorRoute,
  distLockfileRoute,
  type DistRouteEnv,
} from '../../routes/dist';
