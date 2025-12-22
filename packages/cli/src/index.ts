#!/usr/bin/env node

/*
 * PACKAGE.broker - CLI
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

function main() {
  const targetDir = process.cwd();

  log('\n🚀 Initializing PACKAGE.broker...\n', 'bright');

  // Find the main package in node_modules
  const mainPackagePath = join(
    targetDir,
    'node_modules',
    '@package-broker',
    'main'
  );

  if (!existsSync(mainPackagePath)) {
    log('❌ Error: @package-broker/main not found in node_modules', 'red');
    log('   Please run: npm install @package-broker/main', 'yellow');
    process.exit(1);
  }

  // Check if wrangler.toml already exists
  const wranglerPath = join(targetDir, 'wrangler.toml');
  if (existsSync(wranglerPath)) {
    log('⚠️  wrangler.toml already exists. Skipping...', 'yellow');
  } else {
    // Copy wrangler.example.toml
    const exampleTomlPath = join(mainPackagePath, 'wrangler.example.toml');
    try {
      copyFileSync(exampleTomlPath, wranglerPath);
      log('✅ Created wrangler.toml', 'green');
    } catch (error) {
      log(`❌ Error copying wrangler.toml: ${(error as Error).message}`, 'red');
      process.exit(1);
    }
  }

  // Check if migrations directory exists
  const migrationsDir = join(targetDir, 'migrations');
  if (existsSync(migrationsDir)) {
    log('⚠️  migrations/ directory already exists. Skipping...', 'yellow');
  } else {
    // Copy migrations
    try {
      mkdirSync(migrationsDir, { recursive: true });
      const sourceMigrationsDir = join(mainPackagePath, 'migrations');
      const migrationFiles = readdirSync(sourceMigrationsDir).filter((f) => f.endsWith('.sql'));

      for (const file of migrationFiles) {
        copyFileSync(join(sourceMigrationsDir, file), join(migrationsDir, file));
      }
      log(`✅ Copied ${migrationFiles.length} migration files`, 'green');
    } catch (error) {
      log(`❌ Error copying migrations: ${(error as Error).message}`, 'red');
      process.exit(1);
    }
  }

  log('\n📝 Next steps:', 'bright');
  log('');
  log('1. Edit wrangler.toml with your configuration', 'blue');
  log('   - Set your worker name', 'blue');
  log('   - Configure encryption key (generate with: openssl rand -base64 32)', 'blue');
  log('');
  log('2. Login to Cloudflare:', 'blue');
  log('   npx wrangler login', 'blue');
  log('');
  log('3. Create Cloudflare resources:', 'blue');
  log('   npx wrangler d1 create composer-proxy-db', 'blue');
  log('   npx wrangler kv:namespace create COMPOSER_KV', 'blue');
  log('   npx wrangler r2 bucket create composer-proxy-artifacts', 'blue');
  log('');
  log('4. Update wrangler.toml with the generated IDs from step 3', 'blue');
  log('');
  log('5. Apply database migrations:', 'blue');
  log('   npx wrangler d1 migrations apply composer-proxy-db --remote', 'blue');
  log('');
  log('6. Deploy to Cloudflare:', 'blue');
  log('   npx wrangler deploy', 'blue');
  log('');
  log('📚 Documentation: https://github.com/package-broker/server', 'bright');
  log('');
}

main();
