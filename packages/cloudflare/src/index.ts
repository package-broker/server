#!/usr/bin/env node

/*
 * PACKAGE.broker - Cloudflare CLI
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import prompts from 'prompts';
import { randomBytes } from 'crypto';
import {
  checkAuth,
  createD1Database,
  findD1Database,
  createKVNamespace,
  findKVNamespace,
  createR2Bucket,
  findR2Bucket,
  createQueue,
  findQueue,
  setSecret,
  applyMigrations,
  deployWorker,
} from './wrangler.js';
import { renderTemplate, writeWranglerToml } from './template.js';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message: string, color: keyof typeof COLORS = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}

function validateWorkerName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Find @package-broker/main package in various locations
 */
function findMainPackage(targetDir: string): string | null {
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

async function copyMigrations(targetDir: string): Promise<number> {
  const mainPackagePath = findMainPackage(targetDir);

  if (!mainPackagePath) {
    throw new Error(
      '@package-broker/main not found. Please run: npm install @package-broker/main\n' +
      '   Or ensure you are in a directory with @package-broker/main installed.'
    );
  }

  const migrationsDir = join(targetDir, 'migrations');
  if (!existsSync(migrationsDir)) {
    mkdirSync(migrationsDir, { recursive: true });
  }

  const sourceMigrationsDir = join(mainPackagePath, 'migrations');
  if (!existsSync(sourceMigrationsDir)) {
    throw new Error('Migrations directory not found in @package-broker/main');
  }

  const migrationFiles = readdirSync(sourceMigrationsDir).filter((f) =>
    f.endsWith('.sql')
  );

  for (const file of migrationFiles) {
    copyFileSync(
      join(sourceMigrationsDir, file),
      join(migrationsDir, file)
    );
  }

  return migrationFiles.length;
}

async function main() {
  const targetDir = process.cwd();

  log('\n🚀 PACKAGE.broker - Cloudflare Workers Setup\n', 'bright');

  // Check prerequisites
  const mainPackagePath = findMainPackage(targetDir);

  if (!mainPackagePath) {
    log('Error: @package-broker/main not found', 'red');
    log('   Please run: npm install @package-broker/main', 'yellow');
    log('   Or ensure you are in a directory with @package-broker/main installed.', 'yellow');
    process.exit(1);
  }

  // Check wrangler.toml
  const wranglerPath = join(targetDir, 'wrangler.toml');
  if (existsSync(wranglerPath)) {
    const response = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: 'wrangler.toml already exists. Overwrite?',
      initial: false,
    });

    if (!response.overwrite) {
      log('Aborted.', 'yellow');
      process.exit(0);
    }
  }

  // Interactive prompts
  log('\n📋 Configuration\n', 'bright');

  const tierResponse = await prompts({
    type: 'select',
    name: 'tier',
    message: 'Which Cloudflare Workers tier will you use?',
    choices: [
      { title: 'Free tier (100k requests/day, no queues)', value: 'free' },
      { title: 'Paid tier ($5/month, unlimited requests, queues enabled)', value: 'paid' },
    ],
    initial: 0,
  });

  if (!tierResponse.tier) {
    log('Aborted.', 'yellow');
    process.exit(0);
  }

  const paidTier = tierResponse.tier === 'paid';

  const nameResponse = await prompts({
    type: 'text',
    name: 'workerName',
    message: 'Worker name:',
    initial: 'package-broker',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'Worker name cannot be empty';
      }
      if (!validateWorkerName(value)) {
        return 'Worker name can only contain letters, numbers, hyphens, and underscores';
      }
      return true;
    },
  });

  if (!nameResponse.workerName) {
    log('Aborted.', 'yellow');
    process.exit(0);
  }

  const workerName = nameResponse.workerName.trim();

  // Generate encryption key
  log('\n🔐 Generating encryption key...', 'blue');
  const encryptionKey = generateEncryptionKey();
  log('✓ Encryption key generated', 'green');

  // Check authentication
  log('\n🔑 Checking Cloudflare authentication...', 'blue');
  const isAuthenticated = await checkAuth();

  if (!isAuthenticated) {
    log('⚠️  Not authenticated with Cloudflare', 'yellow');
    log('   Please run: npx wrangler login', 'yellow');
    process.exit(1);
  }
  log('✓ Authenticated', 'green');

  // Create resources
  log('\n📦 Creating Cloudflare resources...\n', 'bright');

  const dbName = `${workerName}-db`;
  const kvTitle = `${workerName}-kv`;
  const r2Bucket = `${workerName}-artifacts`;
  const queueName = paidTier ? `${workerName}-queue` : undefined;

  let dbId: string;
  let kvId: string;

  // D1 Database
  log(`Creating D1 database: ${dbName}...`, 'blue');
  try {
    const existingDbId = await findD1Database(dbName);
    if (existingDbId) {
      log(`✓ Database already exists: ${existingDbId}`, 'green');
      dbId = existingDbId;
    } else {
      dbId = await createD1Database(dbName);
      log(`✓ Database created: ${dbId}`, 'green');
    }
  } catch (error) {
    log(`✗ Failed to create database: ${(error as Error).message}`, 'red');
    process.exit(1);
  }

  // KV Namespace
  log(`Creating KV namespace: ${kvTitle}...`, 'blue');
  try {
    const existingKvId = await findKVNamespace(kvTitle);
    if (existingKvId) {
      log(`✓ KV namespace already exists: ${existingKvId}`, 'green');
      kvId = existingKvId;
    } else {
      kvId = await createKVNamespace(kvTitle);
      log(`✓ KV namespace created: ${kvId}`, 'green');
    }
  } catch (error) {
    log(`✗ Failed to create KV namespace: ${(error as Error).message}`, 'red');
    process.exit(1);
  }

  // R2 Bucket
  log(`Creating R2 bucket: ${r2Bucket}...`, 'blue');
  try {
    const bucketExists = await findR2Bucket(r2Bucket);
    if (bucketExists) {
      log(`✓ R2 bucket already exists`, 'green');
    } else {
      await createR2Bucket(r2Bucket);
      log(`✓ R2 bucket created`, 'green');
    }
  } catch (error) {
    log(`✗ Failed to create R2 bucket: ${(error as Error).message}`, 'red');
    process.exit(1);
  }

  // Queue (paid tier only)
  if (paidTier && queueName) {
    log(`Creating Queue: ${queueName}...`, 'blue');
    try {
      const queueExists = await findQueue(queueName);
      if (queueExists) {
        log(`✓ Queue already exists`, 'green');
      } else {
        await createQueue(queueName);
        log(`✓ Queue created`, 'green');
      }
    } catch (error) {
      log(`✗ Failed to create Queue: ${(error as Error).message}`, 'red');
      process.exit(1);
    }
  }

  // Set encryption key as secret
  log('\n🔐 Setting encryption key as Cloudflare secret...', 'blue');
  try {
    await setSecret('ENCRYPTION_KEY', encryptionKey, { 
      cwd: targetDir,
      workerName: workerName 
    });
    log('✓ Encryption key set as secret', 'green');
  } catch (error) {
    log(`✗ Failed to set secret: ${(error as Error).message}`, 'red');
    log('   You can set it manually with: wrangler secret put ENCRYPTION_KEY', 'yellow');
    process.exit(1);
  }

  // Generate wrangler.toml
  log('\n📝 Generating wrangler.toml...', 'blue');
  try {
    const templateContent = renderTemplate(targetDir, {
      worker_name: workerName,
      generated_db_id: dbId,
      generated_kv_id: kvId,
      generated_queue_name: queueName,
      paid_tier: paidTier,
    });
    writeWranglerToml(targetDir, templateContent);
    log('✓ wrangler.toml created', 'green');
  } catch (error) {
    log(`✗ Failed to generate wrangler.toml: ${(error as Error).message}`, 'red');
    process.exit(1);
  }

  // Copy migrations
  log('\n📋 Copying migrations...', 'blue');
  try {
    const migrationCount = await copyMigrations(targetDir);
    log(`✓ ${migrationCount} migration files copied`, 'green');
  } catch (error) {
    log(`✗ Failed to copy migrations: ${(error as Error).message}`, 'red');
    process.exit(1);
  }

  // Deploy confirmation
  log('\n🚀 Deployment\n', 'bright');
  const deployResponse = await prompts({
    type: 'confirm',
    name: 'deploy',
    message: 'Deploy to Cloudflare Workers now?',
    initial: true,
  });

  if (deployResponse.deploy) {
    // Apply migrations
    log('\n📋 Applying database migrations...', 'blue');
    try {
      await applyMigrations(dbName, join(targetDir, 'migrations'), { 
        remote: true,
        cwd: targetDir 
      });
      log('✓ Migrations applied', 'green');
    } catch (error) {
      log(`⚠️  Migration warning: ${(error as Error).message}`, 'yellow');
      log('   You can apply migrations manually with:', 'yellow');
      log(`   npx wrangler d1 migrations apply ${dbName} --remote`, 'yellow');
    }

    // Deploy
    log('\n🚀 Deploying Worker...', 'blue');
    try {
      const workerUrl = await deployWorker({ 
        cwd: targetDir,
        workerName: workerName 
      });
      log(`✓ Deployed successfully!`, 'green');
      log(`\n🌐 Worker URL: ${workerUrl}`, 'bright');
      log(`\n💡 Note: If the route shows as "Inactive" in the Cloudflare dashboard,`, 'yellow');
      log(`   the Worker is still accessible. The status may take a moment to update.`, 'yellow');
    } catch (error) {
      log(`✗ Deployment failed: ${(error as Error).message}`, 'red');
      process.exit(1);
    }
  }

  // Success message
  log('\n✅ Setup complete!\n', 'bright');
  log('Next steps:', 'blue');
  log('1. Open your Worker URL in a browser', 'blue');
  log('2. Complete the initial setup (email + password)', 'blue');
  log('3. Create an access token in the dashboard', 'blue');
  log('4. Start adding repository sources\n', 'blue');

  if (!deployResponse.deploy) {
    log('To deploy later, run:', 'yellow');
    log('  npx wrangler deploy\n', 'yellow');
  }

  log('Documentation: https://package.broker/docs/', 'bright');
  log('');
}

main().catch((error) => {
  log(`\n✗ Fatal error: ${error.message}`, 'red');
  process.exit(1);
});

