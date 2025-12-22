#!/usr/bin/env node

/*
 * Cloudflare Composer Proxy - Prepare Packages for Publishing
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 *
 * This script modifies package.json files to point to dist/ instead of src/
 * for publishing to NPM/GitHub Packages.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const packages = [
  'packages/shared',
  'packages/core',
  'packages/main',
  'packages/cli',
];

function updatePackageJson(packagePath) {
  const packageJsonPath = join(rootDir, packagePath, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  // Update main and types to point to dist/
  if (packageJson.main && packageJson.main.includes('src/')) {
    packageJson.main = packageJson.main.replace('src/', 'dist/').replace('.ts', '.js');
  }
  if (packageJson.types && packageJson.types.includes('src/')) {
    packageJson.types = packageJson.types.replace('src/', 'dist/').replace('.ts', '.d.ts');
  }

  // Update exports
  if (packageJson.exports) {
    if (typeof packageJson.exports === 'string') {
      packageJson.exports = packageJson.exports.replace('src/', 'dist/').replace('.ts', '.js');
    } else if (packageJson.exports['.']) {
      if (typeof packageJson.exports['.'] === 'string') {
        packageJson.exports['.'] = packageJson.exports['.'].replace('src/', 'dist/').replace('.ts', '.js');
      } else {
        if (packageJson.exports['.'].import) {
          packageJson.exports['.'].import = packageJson.exports['.'].import.replace('src/', 'dist/').replace('.ts', '.js');
        }
        if (packageJson.exports['.'].types) {
          packageJson.exports['.'].types = packageJson.exports['.'].types.replace('src/', 'dist/').replace('.ts', '.d.ts');
        }
      }
    }
  }

  // Add files field if not present
  if (!packageJson.files) {
    packageJson.files = ['dist', 'package.json'];
  }

  // Ensure dist/ is in files array
  if (!packageJson.files.includes('dist')) {
    packageJson.files.push('dist');
  }

  // Special handling for main package (needs migrations and wrangler.example.toml)
  if (packagePath === 'packages/main') {
    if (!packageJson.files.includes('migrations')) {
      packageJson.files.push('migrations');
    }
    if (!packageJson.files.includes('wrangler.example.toml')) {
      packageJson.files.push('wrangler.example.toml');
    }
  }

  // Special handling for CLI package
  if (packagePath === 'packages/cli') {
    // CLI doesn't need dist/ in files, it's a binary
  }

  // Special handling for UI package
  if (packagePath === 'packages/ui') {
    // UI only needs dist/
    packageJson.files = ['dist', 'package.json'];
  }

  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`✅ Updated ${packagePath}/package.json for publishing`);
}

// Update all packages
packages.forEach(updatePackageJson);
console.log('\n✅ All packages prepared for publishing');

