#!/usr/bin/env node

/*
 * PACKAGE.broker - Cloudflare CLI - Wrangler Utilities
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { execa } from 'execa';

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
 * Execute a wrangler command and return the output
 */
async function execWrangler(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execa('npx', ['wrangler', ...args], {
      cwd: options?.cwd || process.cwd(),
      env: options?.env,
      stdio: 'pipe',
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    if (error.stdout || error.stderr) {
      return { stdout: error.stdout || '', stderr: error.stderr || '' };
    }
    throw error;
  }
}

/**
 * Check if user is authenticated with wrangler
 */
export async function checkAuth(): Promise<boolean> {
  try {
    const { stdout } = await execWrangler(['whoami']);
    return stdout.includes('@') || stdout.length > 0;
  } catch {
    return false;
  }
}

/**
 * Create a D1 database and return its ID
 */
export async function createD1Database(
  name: string,
  options?: { accountId?: string; apiToken?: string }
): Promise<string> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  const { stdout, stderr } = await execWrangler(['d1', 'create', name], { env });

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
  options?: { accountId?: string; apiToken?: string }
): Promise<string | null> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  try {
    const { stdout } = await execWrangler(['d1', 'list'], { env });
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
  options?: { accountId?: string; apiToken?: string }
): Promise<string> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  const { stdout, stderr } = await execWrangler(['kv', 'namespace', 'create', name], { env });

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
  options?: { accountId?: string; apiToken?: string }
): Promise<string | null> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  try {
    const { stdout } = await execWrangler(['kv', 'namespace', 'list'], { env });
    
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
  options?: { accountId?: string; apiToken?: string }
): Promise<void> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  const { stdout, stderr } = await execWrangler(['r2', 'bucket', 'create', name], { env });

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
  options?: { accountId?: string; apiToken?: string }
): Promise<boolean> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  try {
    const { stdout } = await execWrangler(['r2', 'bucket', 'list'], { env });
    
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
  options?: { accountId?: string; apiToken?: string }
): Promise<void> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  const { stdout, stderr } = await execWrangler(['queues', 'create', name], { env });

  if (stderr && !stderr.includes('already exists') && !stdout.includes('Created')) {
    throw new Error(`Failed to create Queue: ${stderr || stdout}`);
  }
}

/**
 * Check if Queue exists
 */
export async function findQueue(
  name: string,
  options?: { accountId?: string; apiToken?: string }
): Promise<boolean> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  try {
    const { stdout } = await execWrangler(['queues', 'list'], { env });
    
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
  options?: { accountId?: string; apiToken?: string; cwd?: string }
): Promise<void> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  // wrangler secret put reads from stdin
  const { stderr, stdout } = await execa('npx', ['wrangler', 'secret', 'put', secretName], {
    cwd: options?.cwd || process.cwd(),
    env,
    input: secretValue + '\n',
    stdio: 'pipe',
  });

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
  options?: { accountId?: string; apiToken?: string; remote?: boolean }
): Promise<void> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  const args = ['d1', 'migrations', 'apply', databaseName];
  if (options?.remote !== false) {
    args.push('--remote');
  }

  const { stdout, stderr } = await execWrangler(args, { env, cwd: migrationsDir });

  if (stderr && !stderr.includes('Applied') && !stdout.includes('Applied')) {
    // Check if migrations were already applied
    if (!stderr.includes('already applied') && !stdout.includes('already applied')) {
      throw new Error(`Failed to apply migrations: ${stderr || stdout}`);
    }
  }
}

/**
 * Deploy a Worker
 */
export async function deployWorker(
  options?: { accountId?: string; apiToken?: string; cwd?: string }
): Promise<string> {
  const env: Record<string, string> = {};
  if (options?.apiToken) env.CLOUDFLARE_API_TOKEN = options.apiToken;
  if (options?.accountId) env.CLOUDFLARE_ACCOUNT_ID = options.accountId;

  const { stdout, stderr } = await execWrangler(['deploy'], {
    env,
    cwd: options?.cwd || process.cwd(),
  });

  // Extract deployment URL from output
  const urlMatch = stdout.match(/https:\/\/[\w-]+\.workers\.dev/) ||
                   stdout.match(/https:\/\/[\w.-]+\/workers\.dev/);

  if (urlMatch) {
    return urlMatch[0];
  }

  if (stderr && !stderr.includes('Successfully')) {
    throw new Error(`Deployment failed: ${stderr || stdout}`);
  }

  // Return a placeholder if URL not found (shouldn't happen, but handle gracefully)
  return 'https://your-worker.workers.dev';
}

