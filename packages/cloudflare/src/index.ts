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

interface CIMode {
  enabled: boolean;
  jsonOutput: boolean;
}

function log(message: string, color: keyof typeof COLORS = 'reset', ciMode?: CIMode) {
  if (ciMode?.enabled) {
    // GitHub Actions annotations - message may already contain ::notice:: etc
    if (message.startsWith('::error::') || message.startsWith('::warning::') || message.startsWith('::notice::')) {
      console.log(message);
    } else if (color === 'red') {
      console.log(`::error::${message}`);
    } else if (color === 'yellow') {
      console.log(`::warning::${message}`);
    } else if (color === 'blue' || color === 'green') {
      console.log(`::notice::${message}`);
    } else {
      console.log(message);
    }
  } else {
    console.log(`${COLORS[color]}${message}${COLORS.reset}`);
  }
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

/**
 * Parse command line arguments for CI mode
 */
function parseArgs(): { ciMode: boolean; jsonOutput: boolean; command?: string } {
  const args = process.argv.slice(2);
  const ciMode = args.includes('--ci') || process.env.CI === 'true';
  const jsonOutput = args.includes('--json');
  const command = args.find(arg => !arg.startsWith('--'));
  
  return { ciMode, jsonOutput, command };
}

/**
 * Get CI configuration from environment variables and args
 */
function getCIConfig(): {
  workerName: string;
  tier: 'free' | 'paid';
  domain?: string;
  skipUiBuild: boolean;
  skipMigrations: boolean;
  encryptionKey: string;
  apiToken?: string;
  accountId?: string;
} {
  const args = process.argv.slice(2);
  
  // Helper to get value from args or env
  const getValue = (argName: string, envName: string, defaultValue?: string): string | undefined => {
    const argIndex = args.indexOf(`--${argName}`);
    if (argIndex !== -1 && args[argIndex + 1] && !args[argIndex + 1].startsWith('--')) {
      return args[argIndex + 1];
    }
    return process.env[envName] || defaultValue;
  };
  
  // Helper to check for boolean flags
  const hasFlag = (flagName: string, envName: string): boolean => {
    return args.includes(`--${flagName}`) || process.env[envName] === 'true';
  };
  
  const workerName = getValue('worker-name', 'WORKER_NAME', 'package-broker') || 'package-broker';
  const tier = (getValue('tier', 'CLOUDFLARE_TIER', 'free') || 'free') as 'free' | 'paid';
  const domain = getValue('domain', 'DOMAIN');
  const skipUiBuild = hasFlag('skip-ui-build', 'SKIP_UI_BUILD');
  const skipMigrations = hasFlag('skip-migrations', 'SKIP_MIGRATIONS');
  const encryptionKey = getValue('encryption-key', 'ENCRYPTION_KEY') || '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is required in CI mode. Set it via --encryption-key or ENCRYPTION_KEY env var.');
  }
  
  if (!apiToken) {
    throw new Error('CLOUDFLARE_API_TOKEN is required in CI mode.');
  }
  
  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is required in CI mode.');
  }
  
  return {
    workerName,
    tier,
    domain,
    skipUiBuild,
    skipMigrations,
    encryptionKey,
    apiToken,
    accountId,
  };
}

/**
 * CI mode deployment - non-interactive, outputs JSON
 */
async function deployCI(targetDir: string, ciMode: CIMode): Promise<void> {
  const config = getCIConfig();
  const { workerName, tier, domain, skipUiBuild, skipMigrations, encryptionKey, apiToken, accountId } = config;
  const paidTier = tier === 'paid';
  
  const result: {
    worker_url?: string;
    database_id?: string;
    kv_namespace_id?: string;
    error?: string;
  } = {};
  
  try {
    log('::notice::Starting Cloudflare deployment in CI mode', 'reset', ciMode);
    
    // Check prerequisites
    const mainPackagePath = findMainPackage(targetDir);
    if (!mainPackagePath) {
      throw new Error('@package-broker/main not found. Ensure package.json includes @package-broker/main and run npm ci.');
    }
    
    // Check authentication
    const isAuthenticated = await checkAuth({
      apiToken,
      accountId,
    });
    
    if (!isAuthenticated) {
      throw new Error('Cloudflare authentication failed. Check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
    }
    
    log('::notice::Cloudflare authentication verified', 'reset', ciMode);
    
    // Create resources
    const dbName = `${workerName}-db`;
    const kvTitle = `${workerName}-kv`;
    const r2Bucket = `${workerName}-artifacts`;
    const queueName = paidTier ? `${workerName}-queue` : undefined;
    
    let dbId: string;
    let kvId: string;
    
    // D1 Database
    log(`::notice::Discovering or creating D1 database: ${dbName}`, 'reset', ciMode);
    const existingDbId = await findD1Database(dbName, { apiToken, accountId });
    if (existingDbId) {
      dbId = existingDbId;
      log(`::notice::Database already exists: ${dbId}`, 'reset', ciMode);
    } else {
      dbId = await createD1Database(dbName, { apiToken, accountId });
      log(`::notice::Database created: ${dbId}`, 'reset', ciMode);
    }
    result.database_id = dbId;
    
    // KV Namespace
    log(`::notice::Discovering or creating KV namespace: ${kvTitle}`, 'reset', ciMode);
    const existingKvId = await findKVNamespace(kvTitle, { apiToken, accountId });
    if (existingKvId) {
      kvId = existingKvId;
      log(`::notice::KV namespace already exists: ${kvId}`, 'reset', ciMode);
    } else {
      kvId = await createKVNamespace(kvTitle, { apiToken, accountId });
      log(`::notice::KV namespace created: ${kvId}`, 'reset', ciMode);
    }
    result.kv_namespace_id = kvId;
    
    // R2 Bucket
    log(`::notice::Discovering or creating R2 bucket: ${r2Bucket}`, 'reset', ciMode);
    const bucketExists = await findR2Bucket(r2Bucket, { apiToken, accountId });
    if (!bucketExists) {
      await createR2Bucket(r2Bucket, { apiToken, accountId });
      log(`::notice::R2 bucket created`, 'reset', ciMode);
    } else {
      log(`::notice::R2 bucket already exists`, 'reset', ciMode);
    }
    
    // Queue (paid tier only)
    if (paidTier && queueName) {
      log(`::notice::Discovering or creating Queue: ${queueName}`, 'reset', ciMode);
      const queueExists = await findQueue(queueName, { apiToken, accountId });
      if (!queueExists) {
        await createQueue(queueName, { apiToken, accountId });
        log(`::notice::Queue created`, 'reset', ciMode);
      } else {
        log(`::notice::Queue already exists`, 'reset', ciMode);
      }
    }
    
    // Set encryption key as secret
    log('::notice::Setting encryption key as Cloudflare secret', 'reset', ciMode);
    await setSecret('ENCRYPTION_KEY', encryptionKey, {
      apiToken,
      accountId,
      cwd: targetDir,
      workerName,
    });
    
    // Generate wrangler.toml
    log('::notice::Generating wrangler.toml', 'reset', ciMode);
    const templateContent = renderTemplate(targetDir, {
      worker_name: workerName,
      generated_db_id: dbId,
      generated_kv_id: kvId,
      generated_queue_name: queueName,
      paid_tier: paidTier,
      domain,
    });
    writeWranglerToml(targetDir, templateContent);
    
    // Copy migrations
    if (!skipMigrations) {
      log('::notice::Copying migrations', 'reset', ciMode);
      await copyMigrations(targetDir);
    }
    
    // Build UI if needed
    if (!skipUiBuild) {
      const uiPackagePath = join(targetDir, 'node_modules', '@package-broker', 'ui');
      const uiDistPath = join(uiPackagePath, 'dist');
      
      if (!existsSync(uiDistPath)) {
        log('::warning::UI assets not found, attempting to build', 'reset', ciMode);
        try {
          const { execa } = await import('execa');
          if (existsSync(uiPackagePath)) {
            await execa('npm', ['run', 'build'], {
              cwd: uiPackagePath,
              stdio: 'pipe',
            });
            log('::notice::UI built successfully', 'reset', ciMode);
          }
        } catch (error) {
          log(`::warning::Failed to build UI: ${(error as Error).message}`, 'reset', ciMode);
        }
      }
    }
    
    // Apply migrations
    if (!skipMigrations) {
      log('::notice::Applying database migrations', 'reset', ciMode);
      try {
        await applyMigrations(dbName, join(targetDir, 'migrations'), {
          apiToken,
          accountId,
          remote: true,
          cwd: targetDir,
        });
      } catch (error) {
        log(`::warning::Migration warning: ${(error as Error).message}`, 'reset', ciMode);
      }
    }
    
    // Deploy
    log('::notice::Deploying Worker', 'reset', ciMode);
    const workerUrl = await deployWorker({
      apiToken,
      accountId,
      cwd: targetDir,
      workerName,
    });
    result.worker_url = workerUrl;
    log(`::notice::Deployment complete! Worker URL: ${workerUrl}`, 'reset', ciMode);
    
    // Output JSON if requested
    if (ciMode.jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    const errorMsg = (error as Error).message;
    log(`::error::${errorMsg}`, 'reset', ciMode);
    result.error = errorMsg;
    
    if (ciMode.jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    }
    
    process.exit(1);
  }
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
  const { ciMode, jsonOutput, command } = parseArgs();
  const ciModeConfig: CIMode = { enabled: ciMode, jsonOutput };
  
  // Handle CI mode
  if (ciMode && command === 'deploy') {
    await deployCI(targetDir, ciModeConfig);
    return;
  }
  
  // Interactive mode
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

  // Check if UI needs to be built
  log('\n🎨 Checking UI assets...', 'blue');
  const uiPackagePath = join(
    targetDir,
    'node_modules',
    '@package-broker',
    'ui'
  );
  const uiDistPath = join(uiPackagePath, 'dist');
  
  if (!existsSync(uiDistPath)) {
    log('⚠️  UI assets not found. Checking UI package...', 'yellow');
    try {
      const { execa } = await import('execa');
      // Check if UI package exists
      if (existsSync(uiPackagePath)) {
        log('   Building UI...', 'blue');
        await execa('npm', ['run', 'build'], {
          cwd: uiPackagePath,
          stdio: 'pipe',
        });
        log('✓ UI built successfully', 'green');
      } else {
        log('⚠️  UI package not found. Installing @package-broker/ui...', 'yellow');
        await execa('npm', ['install', '@package-broker/ui'], {
          cwd: targetDir,
          stdio: 'pipe',
        });
        // Try to build after installation
        if (existsSync(uiPackagePath)) {
          log('   Building UI...', 'blue');
          await execa('npm', ['run', 'build'], {
            cwd: uiPackagePath,
            stdio: 'pipe',
          });
          log('✓ UI built successfully', 'green');
        }
      }
    } catch (error) {
      log('⚠️  Failed to build UI. UI will not be available.', 'yellow');
      log('   You can build it manually: cd node_modules/@package-broker/ui && npm run build', 'yellow');
      log('   Or install @package-broker/ui which includes pre-built assets.', 'yellow');
    }
  } else {
    log('✓ UI assets found', 'green');
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

