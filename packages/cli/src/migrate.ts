#!/usr/bin/env node

/*
 * PACKAGE.broker - Migration CLI
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── CLI colors ──────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(msg: string, color = ''): void {
  console.log(`${color}${msg}${C.reset}`);
}

function error(msg: string): void {
  log(`Error: ${msg}`, C.red);
}

// ─── Types ───────────────────────────────────────────────────────

interface ComposerJson {
  name?: string;
  repositories?: ComposerRepository[];
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
  [key: string]: unknown;
}

interface ComposerRepository {
  type: string;
  url: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ComposerPackagesJson {
  packages: Record<string, Record<string, unknown>>;
  'provider-includes'?: Record<string, { sha256: string }>;
  'providers-url'?: string;
  includes?: Record<string, { sha1: string }>;
}

interface MigrateOptions {
  from: 'satis' | 'packagist';
  instance: string;
  target: string;
  token?: string;
  dryRun: boolean;
  composerJsonPath: string;
}

interface DiscoveredPackage {
  name: string;
  versions: string[];
}

// ─── Source discovery ────────────────────────────────────────────

async function discoverFromSatis(url: string): Promise<DiscoveredPackage[]> {
  const packagesUrl = `${url.replace(/\/$/, '')}/packages.json`;

  const response = await fetch(packagesUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'PackageBroker-Migrate/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${packagesUrl}: HTTP ${response.status}`);
  }

  const data = (await response.json()) as ComposerPackagesJson;
  const packages: DiscoveredPackage[] = [];

  // Handle direct packages format
  for (const [name, versions] of Object.entries(data.packages || {})) {
    packages.push({ name, versions: Object.keys(versions) });
  }

  // Handle provider-includes format (large Satis instances)
  if (data.includes) {
    for (const [includeUrl] of Object.entries(data.includes)) {
      const resolvedUrl = `${url.replace(/\/$/, '')}/${includeUrl}`;
      try {
        const includeResponse = await fetch(resolvedUrl, {
          headers: { Accept: 'application/json', 'User-Agent': 'PackageBroker-Migrate/1.0' },
        });
        if (includeResponse.ok) {
          const includeData = (await includeResponse.json()) as ComposerPackagesJson;
          for (const [name, versions] of Object.entries(includeData.packages || {})) {
            packages.push({ name, versions: Object.keys(versions) });
          }
        }
      } catch {
        // Skip failed include files
      }
    }
  }

  return packages;
}

async function discoverFromPrivatePackagist(
  url: string,
  token?: string,
): Promise<DiscoveredPackage[]> {
  const packagesUrl = `${url.replace(/\/$/, '')}/packages.json`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'PackageBroker-Migrate/1.0',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(packagesUrl, { headers });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      'Authentication failed. Use --token to provide your Private Packagist token.',
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${packagesUrl}: HTTP ${response.status}`);
  }

  const data = (await response.json()) as ComposerPackagesJson;
  const packages: DiscoveredPackage[] = [];

  for (const [name, versions] of Object.entries(data.packages || {})) {
    packages.push({ name, versions: Object.keys(versions) });
  }

  return packages;
}

// ─── composer.json rewriter ──────────────────────────────────────

function rewriteComposerJson(
  composerJson: ComposerJson,
  sourceUrl: string,
  targetUrl: string,
): ComposerJson {
  const updated = { ...composerJson };

  if (!updated.repositories) return updated;

  const normalizedSource = sourceUrl.replace(/\/$/, '').toLowerCase();

  updated.repositories = updated.repositories.map((repo) => {
    const normalizedRepoUrl = (repo.url || '').replace(/\/$/, '').toLowerCase();

    if (normalizedRepoUrl === normalizedSource) {
      return {
        type: 'composer',
        url: targetUrl.replace(/\/$/, ''),
      };
    }

    return repo;
  });

  return updated;
}

// ─── Savings calculator ──────────────────────────────────────────

interface SavingsEstimate {
  source: string;
  monthly_cost: number;
  annual_cost: number;
  annual_savings: number;
  package_count: number;
}

function estimateSavings(
  source: 'satis' | 'packagist',
  packageCount: number,
): SavingsEstimate {
  // Private Packagist pricing (as of 2025):
  // - Free: 5 packages, 1 user
  // - Personal: $7/mo — 10 packages
  // - Small: $35/mo — 50 packages
  // - Medium: $119/mo — 150 packages
  // - Large: $299/mo — unlimited
  // - Organization: $399/mo+ — team features

  let monthlyEstimate = 0;

  if (source === 'packagist') {
    if (packageCount <= 5) monthlyEstimate = 0;
    else if (packageCount <= 10) monthlyEstimate = 7;
    else if (packageCount <= 50) monthlyEstimate = 35;
    else if (packageCount <= 150) monthlyEstimate = 119;
    else monthlyEstimate = 299;
  } else {
    // Satis is free but requires hosting
    // Estimate server costs
    monthlyEstimate = packageCount > 50 ? 20 : 10;
  }

  return {
    source: source === 'packagist' ? 'Private Packagist' : 'Satis (hosting costs)',
    monthly_cost: monthlyEstimate,
    annual_cost: monthlyEstimate * 12,
    annual_savings: monthlyEstimate * 12,
    package_count: packageCount,
  };
}

// ─── CLI argument parsing ────────────────────────────────────────

function parseArgs(args: string[]): MigrateOptions {
  let from: 'satis' | 'packagist' = 'satis';
  let instance = '';
  let target = '';
  let token: string | undefined;
  let dryRun = false;
  let composerJsonPath = join(process.cwd(), 'composer.json');

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--from':
        from = args[++i] as 'satis' | 'packagist';
        if (from !== 'satis' && from !== 'packagist') {
          error(`Invalid source: ${from}. Use "satis" or "packagist".`);
          process.exit(1);
        }
        break;
      case '--instance':
        instance = args[++i];
        break;
      case '--target':
        target = args[++i];
        break;
      case '--token':
        token = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--composer-json':
        composerJsonPath = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (args[i].startsWith('--')) {
          error(`Unknown option: ${args[i]}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  if (!instance) {
    error('Missing required --instance flag.');
    printHelp();
    process.exit(1);
  }

  if (!target) {
    error('Missing required --target flag.');
    printHelp();
    process.exit(1);
  }

  return { from, instance, target, token, dryRun, composerJsonPath };
}

function printHelp(): void {
  log('');
  log('PACKAGE.broker Migration CLI', C.bold);
  log('');
  log('Migrate from Satis or Private Packagist to PACKAGE.broker', C.dim);
  log('');
  log('Usage:', C.bold);
  log('  npx @package-broker/cli migrate --from <source> --instance <url> --target <url>');
  log('');
  log('Options:', C.bold);
  log('  --from <source>         Source type: "satis" or "packagist" (default: satis)');
  log('  --instance <url>        URL of the source registry to migrate from');
  log('  --target <url>          URL of your PACKAGE.broker instance');
  log('  --token <token>         Authentication token (required for Private Packagist)');
  log('  --dry-run               Show what would be done without making changes');
  log('  --composer-json <path>  Path to composer.json (default: ./composer.json)');
  log('  --help, -h              Show this help message');
  log('');
  log('Examples:', C.bold);
  log('  npx @package-broker/cli migrate \\');
  log('    --from satis \\');
  log('    --instance https://packages.example.com \\');
  log('    --target https://broker.example.com');
  log('');
  log('  npx @package-broker/cli migrate \\');
  log('    --from packagist \\');
  log('    --instance https://repo.packagist.com/acme \\');
  log('    --target https://broker.example.com \\');
  log('    --token pp_xxxxxxxxxxxx \\');
  log('    --dry-run');
  log('');
}

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Remove the "migrate" subcommand if present
  const filteredArgs = args[0] === 'migrate' ? args.slice(1) : args;

  if (filteredArgs.length === 0 || filteredArgs.includes('--help') || filteredArgs.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const options = parseArgs(filteredArgs);

  log('');
  log('  PACKAGE.broker Migration', C.bold);
  log(`  ${C.dim}Migrating from ${options.from} to PACKAGE.broker${C.reset}`);
  log('');

  // Step 1: Read composer.json
  if (!existsSync(options.composerJsonPath)) {
    error(`composer.json not found at: ${options.composerJsonPath}`);
    process.exit(1);
  }

  const composerJsonRaw = readFileSync(options.composerJsonPath, 'utf-8');
  let composerJson: ComposerJson;
  try {
    composerJson = JSON.parse(composerJsonRaw) as ComposerJson;
  } catch {
    error('Invalid JSON in composer.json');
    process.exit(1);
  }

  log(`  ${C.green}✓${C.reset} Read composer.json (${composerJson.name || 'unnamed project'})`);

  // Step 2: Discover packages from source
  log(`  ${C.cyan}→${C.reset} Discovering packages from ${options.instance}...`);

  let packages: DiscoveredPackage[];
  try {
    if (options.from === 'packagist') {
      packages = await discoverFromPrivatePackagist(options.instance, options.token);
    } else {
      packages = await discoverFromSatis(options.instance);
    }
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (packages.length === 0) {
    log(`  ${C.yellow}⚠${C.reset} No packages found at ${options.instance}`);
    process.exit(0);
  }

  const totalVersions = packages.reduce((sum, p) => sum + p.versions.length, 0);
  log(
    `  ${C.green}✓${C.reset} Found ${C.bold}${packages.length}${C.reset} packages (${totalVersions} versions)`,
  );

  // Step 3: Show what will be migrated
  log('');
  log('  Packages to migrate:', C.bold);
  for (const pkg of packages.slice(0, 20)) {
    log(`    ${C.dim}•${C.reset} ${pkg.name} (${pkg.versions.length} versions)`);
  }
  if (packages.length > 20) {
    log(`    ${C.dim}... and ${packages.length - 20} more${C.reset}`);
  }
  log('');

  // Step 4: Rewrite composer.json
  const updatedComposerJson = rewriteComposerJson(composerJson, options.instance, options.target);

  if (options.dryRun) {
    log('  [DRY RUN] Would rewrite composer.json repositories:', C.yellow);
    const repos = updatedComposerJson.repositories || [];
    for (const repo of repos) {
      log(`    ${C.dim}•${C.reset} ${repo.type}: ${repo.url}`);
    }
    log('');
  } else {
    // Write updated composer.json with proper formatting
    const updatedJson = JSON.stringify(updatedComposerJson, null, 4) + '\n';
    writeFileSync(options.composerJsonPath, updatedJson, 'utf-8');
    log(`  ${C.green}✓${C.reset} Updated composer.json — repository URL changed to ${options.target}`);
  }

  // Step 5: Savings estimate
  const savings = estimateSavings(options.from, packages.length);
  log('');
  log('  ─────────────────────────────────────', C.dim);
  log('');
  log(`  ${C.bold}💰 Estimated savings${C.reset}`);
  log(`     Source: ${savings.source}`);
  log(
    `     Previous cost: ${C.yellow}$${savings.monthly_cost}/month${C.reset} ($${savings.annual_cost}/year)`,
  );
  log(`     PACKAGE.broker: ${C.green}$0/month${C.reset} (self-hosted)`);
  log(`     ${C.bold}${C.green}You save $${savings.annual_savings}/year${C.reset}`);
  log('');

  if (options.dryRun) {
    log(`  ${C.yellow}[DRY RUN]${C.reset} No changes were made. Remove --dry-run to apply.`);
  } else {
    log(`  ${C.bold}Next steps:${C.reset}`);
    log(`    1. Run ${C.cyan}composer update${C.reset} to verify the migration`);
    log(`    2. Commit the updated composer.json and composer.lock`);
  }

  log('');
}

export {
  discoverFromSatis,
  discoverFromPrivatePackagist,
  rewriteComposerJson,
  estimateSavings,
  parseArgs,
  type MigrateOptions,
  type DiscoveredPackage,
  type SavingsEstimate,
  type ComposerJson,
};

// Only run main() when executed directly (not when imported by tests)
const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('migrate.js') || process.argv[1].endsWith('migrate.ts'));

if (isDirectExecution) {
  main().catch((err) => {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
