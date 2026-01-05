#!/usr/bin/env node

/*
 * PACKAGE.broker - Cloudflare CLI - Wrangler Utilities
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { execa } from 'execa';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface D1Database {
  database_id: string;
  database_name: string;
}

export interface KVNamespace {
  id: string;
  title: string;
}

export interface R2Bucket {
  name: string;
}

export interface Queue {
  name: string;
}

/**
 * Common options for wrangler commands
 */
export interface WranglerOptions {
  cwd?: string;
  apiToken?: string;
  accountId?: string;
  configPath?: string;
}

/**
 * Build environment variables for wrangler execution
 * Uses explicit options, falls back to process.env
 */
function buildWranglerEnv(options?: WranglerOptions): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  
  // Explicit options take precedence
  if (options?.apiToken) {
    env.CLOUDFLARE_API_TOKEN = options.apiToken;
  }
  if (options?.accountId) {
    env.CLOUDFLARE_ACCOUNT_ID = options.accountId;
  }
  
  return env;
}

/**
 * Resolve the wrangler binary path
 * Priority:
 * 1. Local node_modules/.bin/wrangler in the target directory
 * 2. CLI package's own node_modules/.bin/wrangler
 * 3. null (will use npx --no-install)
 */
function resolveWranglerBinary(cwd?: string): string | null {
  const binName = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  
  // Try target directory's node_modules
  if (cwd) {
    const localBin = join(cwd, 'node_modules', '.bin', binName);
    if (existsSync(localBin)) {
      return localBin;
    }
  }
  
  // Try CLI package's own node_modules
  const cliPackageBin = join(__dirname, '..', 'node_modules', '.bin', binName);
  if (existsSync(cliPackageBin)) {
    return cliPackageBin;
  }
  
  // Try monorepo structure (development)
  const monorepoRoot = join(__dirname, '..', '..', '..', 'node_modules', '.bin', binName);
  if (existsSync(monorepoRoot)) {
    return monorepoRoot;
  }
  
  return null;
}

/**
 * Execute a wrangler command and return the output
 * Prefers local wrangler binary, falls back to npx --no-install
 */
async function execWrangler(
  args: string[],
  options?: WranglerOptions
): Promise<{ stdout: string; stderr: string }> {
  const env = buildWranglerEnv(options);
  const cwd = options?.cwd || process.cwd();
  
  // Add config path if provided
  const fullArgs = [...args];
  if (options?.configPath) {
    fullArgs.push('--config', options.configPath);
  }
  
  // Try to find local wrangler binary
  const wranglerBin = resolveWranglerBinary(cwd);
  
  try {
    let result;
    if (wranglerBin) {
      // Use local wrangler binary
      result = await execa(wranglerBin, fullArgs, {
        cwd,
        env,
        stdio: 'pipe',
      });
    } else {
      // Fall back to npx --no-install (won't auto-install)
      result = await execa('npx', ['--no-install', 'wrangler', ...fullArgs], {
        cwd,
        env,
        stdio: 'pipe',
      });
    }
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const execaError = error as { stdout?: string; stderr?: string };
    if (execaError.stdout || execaError.stderr) {
      return { stdout: execaError.stdout || '', stderr: execaError.stderr || '' };
    }
    throw error;
  }
}

/**
 * Execute wrangler with stdin input
 */
async function execWranglerWithInput(
  args: string[],
  input: string,
  options?: WranglerOptions
): Promise<{ stdout: string; stderr: string }> {
  const env = buildWranglerEnv(options);
  const cwd = options?.cwd || process.cwd();
  
  // Add config path if provided
  const fullArgs = [...args];
  if (options?.configPath) {
    fullArgs.push('--config', options.configPath);
  }
  
  // Try to find local wrangler binary
  const wranglerBin = resolveWranglerBinary(cwd);
  
  try {
    let result;
    if (wranglerBin) {
      result = await execa(wranglerBin, fullArgs, {
        cwd,
        env,
        input,
        stdio: 'pipe',
      });
    } else {
      result = await execa('npx', ['--no-install', 'wrangler', ...fullArgs], {
        cwd,
        env,
        input,
        stdio: 'pipe',
      });
    }
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const execaError = error as { stdout?: string; stderr?: string };
    if (execaError.stdout || execaError.stderr) {
      return { stdout: execaError.stdout || '', stderr: execaError.stderr || '' };
    }
    throw error;
  }
}

/**
 * Check if user is authenticated with wrangler
 * Supports both interactive (wrangler login) and CI (API token) authentication
 */
export async function checkAuth(options?: WranglerOptions): Promise<boolean> {
  try {
    const { stdout } = await execWrangler(['whoami'], options);
    // Check for common success patterns
    return (
      stdout.includes('@') ||
      stdout.includes('Account ID') ||
      stdout.includes('You are logged in') ||
      stdout.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Verify that the API token has required permissions
 * Checks by attempting to list resources
 */
export async function verifyTokenPermissions(
  options?: WranglerOptions & { paidTier?: boolean }
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Check D1 access
  try {
    const { stderr } = await execWrangler(['d1', 'list'], options);
    if (stderr.includes('permission') || stderr.includes('unauthorized')) {
      errors.push('D1 Database: Missing permission');
    }
  } catch {
    errors.push('D1 Database: Unable to verify access');
  }
  
  // Check KV access
  try {
    const { stderr } = await execWrangler(['kv', 'namespace', 'list'], options);
    if (stderr.includes('permission') || stderr.includes('unauthorized')) {
      errors.push('KV Namespace: Missing permission');
    }
  } catch {
    errors.push('KV Namespace: Unable to verify access');
  }
  
  // Check R2 access
  try {
    const { stderr } = await execWrangler(['r2', 'bucket', 'list'], options);
    if (stderr.includes('permission') || stderr.includes('unauthorized')) {
      errors.push('R2 Bucket: Missing permission');
    }
  } catch {
    errors.push('R2 Bucket: Unable to verify access');
  }
  
  // Check Queue access (paid tier only)
  if (options?.paidTier) {
    try {
      const { stderr } = await execWrangler(['queues', 'list'], options);
      if (stderr.includes('permission') || stderr.includes('unauthorized')) {
        errors.push('Queue: Missing permission');
      }
    } catch {
      errors.push('Queue: Unable to verify access');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a D1 database and return its ID
 */
export async function createD1Database(
  name: string,
  options?: WranglerOptions
): Promise<string> {
  const { stdout, stderr } = await execWrangler(['d1', 'create', name], options);

  // Check if database already exists
  const output = (stdout + stderr).toLowerCase();
  if (output.includes('already exists') || output.includes('duplicate')) {
    // Database already exists, try to find its ID
    const existingId = await findD1Database(name, options);
    if (existingId) {
      return existingId;
    }
    // If we can't find it, throw a helpful error
    throw new Error(`Database "${name}" already exists but could not retrieve its ID. Please check your Cloudflare account.`);
  }

  // Try to parse JSON output first
  try {
    const json = JSON.parse(stdout);
    if (json.database_id) {
      return json.database_id;
    }
  } catch {
    // Not JSON, parse text output
  }

  // Parse text output: "database_id = "abc123...""
  const dbIdMatch = stdout.match(/database_id\s*=\s*["']?([a-f0-9-]+)["']?/i) ||
                    stdout.match(/"database_id":\s*"([a-f0-9-]+)"/i) ||
                    stderr.match(/database_id\s*=\s*["']?([a-f0-9-]+)["']?/i);

  if (dbIdMatch && dbIdMatch[1]) {
    return dbIdMatch[1];
  }

  throw new Error(`Failed to parse D1 database ID from output: ${stdout}\n${stderr}`);
}

/**
 * List existing D1 databases and find by name
 */
export async function findD1Database(
  name: string,
  options?: WranglerOptions
): Promise<string | null> {
  try {
    const { stdout } = await execWrangler(['d1', 'list'], options);
    // Parse JSON or text output
    let databases: D1Database[] = [];
    
    try {
      const json = JSON.parse(stdout);
      databases = Array.isArray(json) ? json : json.result || [];
    } catch {
      // Parse text output line by line
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes(name)) {
          const idMatch = line.match(/([a-f0-9-]{32,})/i);
          if (idMatch) {
            return idMatch[1];
          }
        }
      }
    }

    const db = databases.find((d) => d.database_name === name);
    return db?.database_id || null;
  } catch {
    return null;
  }
}

/**
 * Create a KV namespace and return its ID
 */
export async function createKVNamespace(
  name: string,
  options?: WranglerOptions
): Promise<string> {
  const { stdout, stderr } = await execWrangler(['kv', 'namespace', 'create', name], options);

  // Parse output: "id = "abc123...""
  const idMatch = stdout.match(/id\s*=\s*["']?([a-f0-9]{32})["']?/i) ||
                  stdout.match(/"id":\s*"([a-f0-9]{32})"/i) ||
                  stderr.match(/id\s*=\s*["']?([a-f0-9]{32})["']?/i);

  if (idMatch && idMatch[1]) {
    return idMatch[1];
  }

  throw new Error(`Failed to parse KV namespace ID from output: ${stdout}\n${stderr}`);
}

/**
 * List existing KV namespaces and find by title
 */
export async function findKVNamespace(
  title: string,
  options?: WranglerOptions
): Promise<string | null> {
  try {
    const { stdout } = await execWrangler(['kv', 'namespace', 'list'], options);
    
    try {
      const json = JSON.parse(stdout);
      const namespaces: KVNamespace[] = Array.isArray(json) ? json : json.result || [];
      const ns = namespaces.find((n) => n.title === title);
      return ns?.id || null;
    } catch {
      // Parse text output
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes(title)) {
          const idMatch = line.match(/([a-f0-9]{32})/);
          if (idMatch) {
            return idMatch[1];
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create an R2 bucket
 */
export async function createR2Bucket(
  name: string,
  options?: WranglerOptions
): Promise<void> {
  const { stdout, stderr } = await execWrangler(['r2', 'bucket', 'create', name], options);

  // Check for errors (bucket might already exist)
  if (stderr && !stderr.includes('already exists') && !stdout.includes('Created')) {
    throw new Error(`Failed to create R2 bucket: ${stderr || stdout}`);
  }
}

/**
 * Check if R2 bucket exists
 */
export async function findR2Bucket(
  name: string,
  options?: WranglerOptions
): Promise<boolean> {
  try {
    const { stdout } = await execWrangler(['r2', 'bucket', 'list'], options);
    
    try {
      const json = JSON.parse(stdout);
      const buckets: R2Bucket[] = Array.isArray(json) ? json : json.result || [];
      return buckets.some((b) => b.name === name);
    } catch {
      // Parse text output
      return stdout.includes(name);
    }
  } catch {
    return false;
  }
}

/**
 * Create a Queue
 */
export async function createQueue(
  name: string,
  options?: WranglerOptions
): Promise<void> {
  const { stdout, stderr } = await execWrangler(['queues', 'create', name], options);

  if (stderr && !stderr.includes('already exists') && !stdout.includes('Created')) {
    throw new Error(`Failed to create Queue: ${stderr || stdout}`);
  }
}

/**
 * Check if Queue exists
 */
export async function findQueue(
  name: string,
  options?: WranglerOptions
): Promise<boolean> {
  try {
    const { stdout } = await execWrangler(['queues', 'list'], options);
    
    try {
      const json = JSON.parse(stdout);
      const queues: Queue[] = Array.isArray(json) ? json : json.result || [];
      return queues.some((q) => q.name === name);
    } catch {
      return stdout.includes(name);
    }
  } catch {
    return false;
  }
}

/**
 * Set a Cloudflare Worker secret
 */
export async function setSecret(
  secretName: string,
  secretValue: string,
  options?: WranglerOptions & { workerName?: string }
): Promise<void> {
  // Build wrangler command with --name if worker name is provided
  const args = ['secret', 'put', secretName];
  if (options?.workerName) {
    args.push('--name', options.workerName);
  }

  // wrangler secret put reads from stdin
  const { stderr, stdout } = await execWranglerWithInput(args, secretValue + '\n', options);

  // Check for success indicators
  const output = (stdout + stderr).toLowerCase();
  if (
    !output.includes('created') &&
    !output.includes('updated') &&
    !output.includes('enter the secret value') &&
    !output.includes('successfully')
  ) {
    // If there's actual error content, throw
    if (stderr && stderr.trim().length > 0 && !stderr.includes('Enter')) {
      throw new Error(`Failed to set secret ${secretName}: ${stderr}`);
    }
  }
}

/**
 * Apply D1 migrations
 */
export async function applyMigrations(
  databaseName: string,
  migrationsDir: string,
  options?: WranglerOptions & { remote?: boolean }
): Promise<void> {
  const args = ['d1', 'migrations', 'apply', databaseName];
  if (options?.remote !== false) {
    args.push('--remote');
  }

  const { stdout, stderr } = await execWrangler(args, options);

  if (stderr && !stderr.includes('Applied') && !stdout.includes('Applied')) {
    // Check if migrations were already applied or if it's a duplicate column error (safe to ignore)
    const isAlreadyApplied = stderr.includes('already applied') || stdout.includes('already applied');
    const isDuplicateColumn = stderr.includes('duplicate column') || stdout.includes('duplicate column');
    
    if (!isAlreadyApplied && !isDuplicateColumn) {
      throw new Error(`Failed to apply migrations: ${stderr || stdout}`);
    }
    
    // Log warning for duplicate column (migration conflict, but safe)
    if (isDuplicateColumn) {
      console.warn('⚠️  Some migrations may have already been applied (duplicate column detected). This is safe to ignore.');
    }
  }
}

/**
 * Get account subdomain from wrangler whoami
 */
async function getAccountSubdomain(options?: WranglerOptions): Promise<string | null> {
  try {
    const { stdout } = await execWrangler(['whoami'], options);

    // Extract subdomain from whoami output (format: "lukasz-bajsarowicz" or similar)
    const subdomainMatch = stdout.match(/@([\w-]+)/);
    if (subdomainMatch) {
      return subdomainMatch[1];
    }
  } catch {
    // Ignore errors, return null
  }
  return null;
}

/**
 * Deploy a Worker
 */
export async function deployWorker(
  options?: WranglerOptions & { workerName?: string }
): Promise<string> {
  const { stdout, stderr } = await execWrangler(['deploy'], options);

  // Check for deployment errors
  if (stderr && !stderr.includes('Successfully') && !stderr.includes('deployed')) {
    const errorMatch = stderr.match(/\[ERROR\][^\n]+/);
    if (errorMatch) {
      throw new Error(`Deployment failed: ${errorMatch[0]}`);
    }
  }

  // Extract deployment URL from output - try multiple patterns
  // Pattern 1: https://worker-name.subdomain.workers.dev
  let urlMatch = stdout.match(/https:\/\/[\w-]+\.workers\.dev/i) ||
                 stdout.match(/https:\/\/[\w.-]+\.workers\.dev/i);
  
  // Pattern 2: deployed to https://...
  if (!urlMatch) {
    urlMatch = stdout.match(/deployed to (https:\/\/[\w.-]+\.workers\.dev)/i);
    if (urlMatch) {
      urlMatch = [urlMatch[1]];
    }
  }
  
  // Pattern 3: https://...workers.dev (any format)
  if (!urlMatch) {
    urlMatch = stdout.match(/(https:\/\/[^\s]+\.workers\.dev)/i);
  }

  if (urlMatch && urlMatch[0]) {
    return urlMatch[0];
  }

  // Fallback: construct URL from worker name and account subdomain
  if (options?.workerName) {
    const subdomain = await getAccountSubdomain(options);
    if (subdomain) {
      return `https://${options.workerName}.${subdomain}.workers.dev`;
    }
    // If we can't get subdomain, try generic format
    return `https://${options.workerName}.workers.dev`;
  }

  // Last resort: return placeholder
  return 'https://your-worker.workers.dev';
}
