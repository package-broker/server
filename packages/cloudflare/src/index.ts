#!/usr/bin/env node

/*
 * PACKAGE.broker - Cloudflare CLI
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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
  verifyTokenPermissions,
  type WranglerOptions,
} from './wrangler.js';
import { renderTemplate, writeWranglerToml } from './template.js';
import { findMainPackage, findUiPackage } from './paths.js';
import {
  parseWranglerToml,
  extractResourceIds,
  findMissingResources,
  generateWranglerToml,
  mergeResourcesIntoConfig,
  wranglerTomlExists,
  type ResourceIds,
} from './wrangler-config.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

interface CLIOptions {
  command: 'init' | 'deploy' | 'help';
  ci: boolean;
  json: boolean;
  workerName?: string;
  tier: 'free' | 'paid';
  domain?: string;
  skipUiBuild: boolean;
  skipMigrations: boolean;
}

interface DeployResult {
  worker_url: string;
  database_id: string;
  kv_namespace_id: string;
  r2_bucket_name: string;
  queue_name?: string;
}

interface ErrorResult {
  error: string;
}

// ============================================================================
// Logging Utilities
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const isCI = process.env.CI === 'true';

/**
 * Log a message to console (interactive mode) or stderr (CI mode with --json)
 */
function log(message: string, color: keyof typeof COLORS = 'reset', options?: { json?: boolean }) {
  const output = options?.json ? process.stderr : process.stdout;
  output.write(`${COLORS[color]}${message}${COLORS.reset}\n`);
}

/**
 * Log a GitHub Actions annotation (only in CI environment)
 */
function ghAnnotation(type: 'notice' | 'warning' | 'error', message: string) {
  if (isCI) {
    console.error(`::${type}::${message}`);
  }
}

/**
 * Output JSON result to stdout (for --json mode)
 */
function outputJson(result: DeployResult | ErrorResult) {
  console.log(JSON.stringify(result));
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv: string[]): CLIOptions {
  const args = argv.slice(2);
  
  const options: CLIOptions = {
    command: 'init',
    ci: false,
    json: false,
    tier: 'free',
    skipUiBuild: false,
    skipMigrations: false,
  };
  
  // Parse command
  if (args.length > 0 && !args[0].startsWith('-')) {
    const cmd = args[0].toLowerCase();
    if (cmd === 'deploy') {
      options.command = 'deploy';
    } else if (cmd === 'init') {
      options.command = 'init';
    } else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
      options.command = 'help';
    }
  }
  
  // Parse flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--ci') {
      options.ci = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--worker-name' && args[i + 1]) {
      options.workerName = args[++i];
    } else if (arg === '--tier' && args[i + 1]) {
      const tier = args[++i].toLowerCase();
      if (tier === 'free' || tier === 'paid') {
        options.tier = tier;
      }
    } else if (arg === '--domain' && args[i + 1]) {
      options.domain = args[++i];
    } else if (arg === '--skip-ui-build') {
      options.skipUiBuild = true;
    } else if (arg === '--skip-migrations') {
      options.skipMigrations = true;
    } else if (arg === '-h' || arg === '--help') {
      options.command = 'help';
    }
  }
  
  // Check environment variable overrides (for CI)
  if (options.ci) {
    if (process.env.WORKER_NAME && !options.workerName) {
      options.workerName = process.env.WORKER_NAME;
    }
    if (process.env.CLOUDFLARE_TIER) {
      const tier = process.env.CLOUDFLARE_TIER.toLowerCase();
      if (tier === 'free' || tier === 'paid') {
        options.tier = tier;
      }
    }
    if (process.env.DOMAIN && !options.domain) {
      options.domain = process.env.DOMAIN;
    }
    if (process.env.SKIP_UI_BUILD === 'true') {
      options.skipUiBuild = true;
    }
    if (process.env.SKIP_MIGRATIONS === 'true') {
      options.skipMigrations = true;
    }
  }
  
  return options;
}

// ============================================================================
// Help Command
// ============================================================================

function showHelp() {
  console.log(`
PACKAGE.broker Cloudflare CLI

Usage: package-broker-cloudflare [command] [options]

Commands:
  init     Interactive setup (default)
  deploy   Deploy to Cloudflare Workers
  help     Show this help message

Options:
  --ci               Non-interactive mode (no prompts)
  --json             Output machine-readable JSON
  --worker-name      Worker name (default: package-broker)
  --tier             Cloudflare tier: free or paid (default: free)
  --domain           Custom domain for routes
  --skip-ui-build    Skip UI build step
  --skip-migrations  Skip database migrations

Environment Variables (CI mode):
  CLOUDFLARE_API_TOKEN    Cloudflare API token (required)
  CLOUDFLARE_ACCOUNT_ID   Cloudflare account ID (required)
  ENCRYPTION_KEY          Base64-encoded encryption key (required)
  WORKER_NAME             Worker name (overrides --worker-name)
  CLOUDFLARE_TIER         Tier: free or paid (overrides --tier)
  DOMAIN                  Custom domain (overrides --domain)
  SKIP_UI_BUILD           Set to 'true' to skip UI build
  SKIP_MIGRATIONS         Set to 'true' to skip migrations

Examples:
  # Interactive setup
  npx package-broker-cloudflare init

  # CI deployment
  npx package-broker-cloudflare deploy --ci --json --worker-name my-broker

  # Deploy with custom domain
  npx package-broker-cloudflare deploy --ci --json --domain packages.example.com
`);
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}

function validateWorkerName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

async function copyMigrations(targetDir: string, destDir?: string): Promise<number> {
  const mainPackagePath = findMainPackage(targetDir);

  if (!mainPackagePath) {
    throw new Error(
      '@package-broker/main not found. Please run: npm install @package-broker/main\n' +
      '   Or ensure you are in a directory with @package-broker/main installed.'
    );
  }

  const migrationsDir = destDir || join(targetDir, 'migrations');
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

// ============================================================================
// CI Deploy Flow
// ============================================================================

async function runCiDeploy(options: CLIOptions): Promise<void> {
  const targetDir = process.cwd();
  const jsonOutput = options.json;
  
  // Validate required environment variables
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!apiToken) {
    const error = 'CLOUDFLARE_API_TOKEN environment variable is required';
    ghAnnotation('error', error);
    if (jsonOutput) {
      outputJson({ error });
    } else {
      log(`✗ ${error}`, 'red');
    }
    process.exit(1);
  }
  
  if (!accountId) {
    const error = 'CLOUDFLARE_ACCOUNT_ID environment variable is required';
    ghAnnotation('error', error);
    if (jsonOutput) {
      outputJson({ error });
    } else {
      log(`✗ ${error}`, 'red');
    }
    process.exit(1);
  }
  
  if (!encryptionKey) {
    const error = 'ENCRYPTION_KEY environment variable is required';
    ghAnnotation('error', error);
    if (jsonOutput) {
      outputJson({ error });
    } else {
      log(`✗ ${error}`, 'red');
    }
    process.exit(1);
  }
  
  // Validate worker name
  const workerName = options.workerName || 'package-broker';
  if (!validateWorkerName(workerName)) {
    const error = `Invalid worker name: ${workerName}. Use only letters, numbers, hyphens, and underscores.`;
    ghAnnotation('error', error);
    if (jsonOutput) {
      outputJson({ error });
    } else {
      log(`✗ ${error}`, 'red');
    }
    process.exit(1);
  }
  
  const paidTier = options.tier === 'paid';
  
  // Wrangler options for all commands
  const wranglerOpts: WranglerOptions = {
    apiToken,
    accountId,
    cwd: targetDir,
  };
  
  try {
    // Check prerequisites
    log('Checking prerequisites...', 'blue', { json: jsonOutput });
    
    const mainPackagePath = findMainPackage(targetDir);
    if (!mainPackagePath) {
      throw new Error('@package-broker/main not found. Run: npm install @package-broker/main');
    }
    
    // Check authentication
    log('Verifying Cloudflare authentication...', 'blue', { json: jsonOutput });
    const isAuthenticated = await checkAuth(wranglerOpts);
    if (!isAuthenticated) {
      throw new Error('Cloudflare authentication failed. Check your API token.');
    }
    ghAnnotation('notice', 'Cloudflare authentication successful');
    
    // Verify token permissions
    log('Verifying token permissions...', 'blue', { json: jsonOutput });
    const permissions = await verifyTokenPermissions({ ...wranglerOpts, paidTier });
    if (!permissions.valid) {
      ghAnnotation('warning', `Token permission issues: ${permissions.errors.join(', ')}`);
    }
    
    // Check for existing wrangler.toml and parse it
    log('Checking for existing wrangler.toml...', 'blue', { json: jsonOutput });
    const existingConfig = wranglerTomlExists(targetDir) ? parseWranglerToml(targetDir) : null;
    const { needsDatabase, needsKV, needsR2, needsQueue, existingResources } = 
      findMissingResources(existingConfig, workerName, paidTier);
    
    if (existingConfig) {
      log('Found existing wrangler.toml, extracting resource IDs...', 'blue', { json: jsonOutput });
      ghAnnotation('notice', 'Using existing wrangler.toml configuration');
    }
    
    // Resource names
    const dbName = existingResources.database_name || `${workerName}-db`;
    const kvTitle = `${workerName}-kv`;
    const r2Bucket = existingResources.r2_bucket_name || `${workerName}-artifacts`;
    const queueName = paidTier ? (existingResources.queue_name || `${workerName}-queue`) : undefined;
    
    // Create/find missing resources
    const resources: ResourceIds = { ...existingResources };
    
    if (needsDatabase) {
      log(`Creating/finding D1 database: ${dbName}...`, 'blue', { json: jsonOutput });
      const existingDbId = await findD1Database(dbName, wranglerOpts);
      if (existingDbId) {
        log(`Database already exists: ${existingDbId}`, 'green', { json: jsonOutput });
        resources.database_id = existingDbId;
      } else {
        try {
          const newDbId = await createD1Database(dbName, wranglerOpts);
          log(`Database created: ${newDbId}`, 'green', { json: jsonOutput });
          resources.database_id = newDbId;
        } catch (createError) {
          // If creation fails (e.g., database already exists), try to find it again
          const errorMessage = (createError as Error).message.toLowerCase();
          if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
            log('Creation failed (resource may already exist), attempting to find existing database...', 'yellow', { json: jsonOutput });
            const foundDbId = await findD1Database(dbName, wranglerOpts);
            if (foundDbId) {
              log(`Found existing database: ${foundDbId}`, 'green', { json: jsonOutput });
              resources.database_id = foundDbId;
            } else {
              throw new Error(`Database "${dbName}" appears to exist but could not retrieve its ID. Error: ${(createError as Error).message}`);
            }
          } else {
            throw createError;
          }
        }
      }
      resources.database_name = dbName;
    }
    
    if (needsKV) {
      log(`Creating/finding KV namespace: ${kvTitle}...`, 'blue', { json: jsonOutput });
      const existingKvId = await findKVNamespace(kvTitle, wranglerOpts);
      if (existingKvId) {
        log(`KV namespace already exists: ${existingKvId}`, 'green', { json: jsonOutput });
        resources.kv_namespace_id = existingKvId;
      } else {
        try {
          const newKvId = await createKVNamespace(kvTitle, wranglerOpts);
          log(`KV namespace created: ${newKvId}`, 'green', { json: jsonOutput });
          resources.kv_namespace_id = newKvId;
        } catch (createError) {
          // If creation fails (e.g., namespace already exists), try to find it again
          const errorMessage = (createError as Error).message.toLowerCase();
          if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
            log('Creation failed (resource may already exist), attempting to find existing KV namespace...', 'yellow', { json: jsonOutput });
            const foundKvId = await findKVNamespace(kvTitle, wranglerOpts);
            if (foundKvId) {
              log(`Found existing KV namespace: ${foundKvId}`, 'green', { json: jsonOutput });
              resources.kv_namespace_id = foundKvId;
            } else {
              throw new Error(`KV namespace "${kvTitle}" appears to exist but could not retrieve its ID. Error: ${(createError as Error).message}`);
            }
          } else {
            throw createError;
          }
        }
      }
    }
    
    if (needsR2) {
      log(`Creating/finding R2 bucket: ${r2Bucket}...`, 'blue', { json: jsonOutput });
      const bucketExists = await findR2Bucket(r2Bucket, wranglerOpts);
      if (bucketExists) {
        log('R2 bucket already exists', 'green', { json: jsonOutput });
      } else {
        await createR2Bucket(r2Bucket, wranglerOpts);
        log('R2 bucket created', 'green', { json: jsonOutput });
      }
      resources.r2_bucket_name = r2Bucket;
    }
    
    if (needsQueue && queueName) {
      log(`Creating/finding Queue: ${queueName}...`, 'blue', { json: jsonOutput });
      const queueExists = await findQueue(queueName, wranglerOpts);
      if (queueExists) {
        log('Queue already exists', 'green', { json: jsonOutput });
      } else {
        await createQueue(queueName, wranglerOpts);
        log('Queue created', 'green', { json: jsonOutput });
      }
      resources.queue_name = queueName;
    }
    
    // Create ephemeral workspace
    const ephemeralDir = join(tmpdir(), 'package-broker-cloudflare', `${workerName}-${Date.now()}`);
    mkdirSync(ephemeralDir, { recursive: true });
    log(`Created ephemeral workspace: ${ephemeralDir}`, 'blue', { json: jsonOutput });
    
    // Generate or merge wrangler.toml
    log('Generating wrangler.toml...', 'blue', { json: jsonOutput });
    let wranglerContent: string;
    
    const uiPackagePath = findUiPackage(targetDir);
    const uiAssetsPath = uiPackagePath ? join(targetDir, 'node_modules/@package-broker/ui/dist') : undefined;
    
    // Use absolute path for main file so wrangler can resolve it correctly
    // even when config file is in a different directory
    const mainPath = join(targetDir, 'node_modules/@package-broker/main/dist/index.js');
    
    if (existingConfig?._raw) {
      // Merge new resource IDs into existing config
      wranglerContent = mergeResourcesIntoConfig(
        existingConfig._raw,
        resources,
        workerName,
        { paidTier, domain: options.domain }
      );
    } else {
      // Generate new config
      wranglerContent = generateWranglerToml(workerName, resources, {
        paidTier,
        domain: options.domain,
        mainPath,
        uiAssetsPath,
      });
    }
    
    const ephemeralConfigPath = join(ephemeralDir, 'wrangler.toml');
    writeFileSync(ephemeralConfigPath, wranglerContent, 'utf-8');
    
    // Copy migrations to ephemeral directory
    log('Copying migrations...', 'blue', { json: jsonOutput });
    const migrationsDir = join(ephemeralDir, 'migrations');
    const migrationCount = await copyMigrations(targetDir, migrationsDir);
    log(`${migrationCount} migration files copied`, 'green', { json: jsonOutput });
    
    // Check/build UI
    if (!options.skipUiBuild) {
      log('Checking UI assets...', 'blue', { json: jsonOutput });
      const uiDistPath = uiPackagePath ? join(uiPackagePath, 'dist') : null;
      
      if (!uiDistPath || !existsSync(uiDistPath)) {
        ghAnnotation('warning', 'UI assets not found. UI may not be available.');
        log('UI assets not found. Skipping UI...', 'yellow', { json: jsonOutput });
      } else {
        log('UI assets found', 'green', { json: jsonOutput });
      }
    }
    
    // Set encryption key as secret
    log('Setting encryption key as secret...', 'blue', { json: jsonOutput });
    await setSecret('ENCRYPTION_KEY', encryptionKey, {
      ...wranglerOpts,
      workerName,
      configPath: ephemeralConfigPath,
    });
    log('Encryption key set', 'green', { json: jsonOutput });
    
    // Apply migrations
    if (!options.skipMigrations) {
      log('Applying database migrations...', 'blue', { json: jsonOutput });
      try {
        await applyMigrations(dbName, migrationsDir, {
          ...wranglerOpts,
          remote: true,
          configPath: ephemeralConfigPath,
        });
        log('Migrations applied', 'green', { json: jsonOutput });
      } catch (migrationError) {
        ghAnnotation('warning', `Migration warning: ${(migrationError as Error).message}`);
        log(`Migration warning: ${(migrationError as Error).message}`, 'yellow', { json: jsonOutput });
      }
    }
    
    // Deploy worker
    log('Deploying Worker...', 'blue', { json: jsonOutput });
    const workerUrl = await deployWorker({
      ...wranglerOpts,
      workerName,
      configPath: ephemeralConfigPath,
    });
    
    ghAnnotation('notice', `Deployment complete! Worker URL: ${workerUrl}`);
    
    // Output result
    const result: DeployResult = {
      worker_url: workerUrl,
      database_id: resources.database_id || '',
      kv_namespace_id: resources.kv_namespace_id || '',
      r2_bucket_name: resources.r2_bucket_name || r2Bucket,
      queue_name: resources.queue_name,
    };
    
    if (jsonOutput) {
      outputJson(result);
    } else {
      log(`\n✅ Deployment complete!`, 'bright');
      log(`🌐 Worker URL: ${workerUrl}`, 'bright');
      if (options.domain) {
        log(`\n📝 Custom Domain Configuration Required:`, 'yellow');
        log(`   Create a CNAME record pointing ${options.domain} to your worker`, 'yellow');
      }
    }
    
  } catch (error) {
    const errorMessage = (error as Error).message;
    ghAnnotation('error', errorMessage);
    
    if (jsonOutput) {
      outputJson({ error: errorMessage });
    } else {
      log(`\n✗ Deployment failed: ${errorMessage}`, 'red');
    }
    process.exit(1);
  }
}

// ============================================================================
// Interactive Init Flow
// ============================================================================

async function runInteractiveInit(): Promise<void> {
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

  // Check if UI needs to be built
  log('\n🎨 Checking UI assets...', 'blue');
  const uiPackagePath = findUiPackage(targetDir);
  const uiDistPath = uiPackagePath ? join(uiPackagePath, 'dist') : null;
  
  if (!uiDistPath || !existsSync(uiDistPath)) {
    log('⚠️  UI assets not found. Checking UI package...', 'yellow');
    try {
      const { execa } = await import('execa');
      // Check if UI package exists
      if (uiPackagePath && existsSync(uiPackagePath)) {
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
        const newUiPackagePath = findUiPackage(targetDir);
        if (newUiPackagePath && existsSync(newUiPackagePath)) {
          log('   Building UI...', 'blue');
          await execa('npm', ['run', 'build'], {
            cwd: newUiPackagePath,
            stdio: 'pipe',
          });
          log('✓ UI built successfully', 'green');
        }
      }
    } catch {
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

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const options = parseArgs(process.argv);
  
  switch (options.command) {
    case 'help':
      showHelp();
      break;
      
    case 'deploy':
      if (options.ci) {
        await runCiDeploy(options);
      } else {
        // Non-CI deploy - run interactive flow
        await runInteractiveInit();
      }
      break;
      
    case 'init':
    default:
      await runInteractiveInit();
      break;
  }
}

main().catch((error) => {
  const isJsonMode = process.argv.includes('--json');
  
  if (isJsonMode) {
    outputJson({ error: error.message });
  } else {
    log(`\n✗ Fatal error: ${error.message}`, 'red');
  }
  
  ghAnnotation('error', `Fatal error: ${error.message}`);
  process.exit(1);
});
