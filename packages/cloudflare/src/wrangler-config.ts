#!/usr/bin/env node

/*
 * PACKAGE.broker - Cloudflare CLI - Wrangler Config Parser
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import TOML from '@iarna/toml';

/**
 * Parsed D1 database configuration from wrangler.toml
 */
export interface D1DatabaseConfig {
  binding: string;
  database_name: string;
  database_id: string;
}

/**
 * Parsed KV namespace configuration from wrangler.toml
 */
export interface KVNamespaceConfig {
  binding: string;
  id: string;
}

/**
 * Parsed R2 bucket configuration from wrangler.toml
 */
export interface R2BucketConfig {
  binding: string;
  bucket_name: string;
}

/**
 * Parsed Queue producer configuration from wrangler.toml
 */
export interface QueueProducerConfig {
  binding: string;
  queue: string;
}

/**
 * Parsed Queue consumer configuration from wrangler.toml
 */
export interface QueueConsumerConfig {
  queue: string;
  max_batch_size?: number;
  max_batch_timeout?: number;
}

/**
 * Parsed route configuration from wrangler.toml
 */
export interface RouteConfig {
  pattern: string;
  zone_name?: string;
  zone_id?: string;
  custom_domain?: boolean;
}

/**
 * Parsed wrangler.toml configuration
 */
export interface ParsedWranglerConfig {
  name?: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  
  // Resource bindings
  d1_databases?: D1DatabaseConfig[];
  kv_namespaces?: KVNamespaceConfig[];
  r2_buckets?: R2BucketConfig[];
  
  // Queue configuration
  queues?: {
    producers?: QueueProducerConfig[];
    consumers?: QueueConsumerConfig[];
  };
  
  // Routes
  routes?: RouteConfig[];
  route?: string;
  
  // Assets
  assets?: {
    directory?: string;
    binding?: string;
  };
  
  // Variables
  vars?: Record<string, string>;
  
  // Raw TOML content for merging
  _raw?: string;
}

/**
 * Resource IDs that may need to be created/found
 */
export interface ResourceIds {
  database_id?: string;
  database_name?: string;
  kv_namespace_id?: string;
  r2_bucket_name?: string;
  queue_name?: string;
}

/**
 * Check if a wrangler.toml file exists at the given path
 */
export function wranglerTomlExists(targetDir: string): boolean {
  const wranglerPath = join(targetDir, 'wrangler.toml');
  return existsSync(wranglerPath);
}

/**
 * Parse a wrangler.toml file and extract configuration
 */
export function parseWranglerToml(targetDir: string): ParsedWranglerConfig | null {
  const wranglerPath = join(targetDir, 'wrangler.toml');
  
  if (!existsSync(wranglerPath)) {
    return null;
  }
  
  try {
    const content = readFileSync(wranglerPath, 'utf-8');
    const parsed = TOML.parse(content) as Record<string, unknown>;
    
    const config: ParsedWranglerConfig = {
      name: parsed.name as string | undefined,
      main: parsed.main as string | undefined,
      compatibility_date: parsed.compatibility_date as string | undefined,
      compatibility_flags: parsed.compatibility_flags as string[] | undefined,
      _raw: content,
    };
    
    // Parse D1 databases
    if (Array.isArray(parsed.d1_databases)) {
      config.d1_databases = parsed.d1_databases.map((db: Record<string, unknown>) => ({
        binding: db.binding as string,
        database_name: db.database_name as string,
        database_id: db.database_id as string,
      }));
    }
    
    // Parse KV namespaces
    if (Array.isArray(parsed.kv_namespaces)) {
      config.kv_namespaces = parsed.kv_namespaces.map((kv: Record<string, unknown>) => ({
        binding: kv.binding as string,
        id: kv.id as string,
      }));
    }
    
    // Parse R2 buckets
    if (Array.isArray(parsed.r2_buckets)) {
      config.r2_buckets = parsed.r2_buckets.map((bucket: Record<string, unknown>) => ({
        binding: bucket.binding as string,
        bucket_name: bucket.bucket_name as string,
      }));
    }
    
    // Parse queues
    const queues = parsed.queues as Record<string, unknown> | undefined;
    if (queues) {
      config.queues = {};
      
      if (Array.isArray(queues.producers)) {
        config.queues.producers = queues.producers.map((p: Record<string, unknown>) => ({
          binding: p.binding as string,
          queue: p.queue as string,
        }));
      }
      
      if (Array.isArray(queues.consumers)) {
        config.queues.consumers = queues.consumers.map((c: Record<string, unknown>) => ({
          queue: c.queue as string,
          max_batch_size: c.max_batch_size as number | undefined,
          max_batch_timeout: c.max_batch_timeout as number | undefined,
        }));
      }
    }
    
    // Parse routes
    if (Array.isArray(parsed.routes)) {
      config.routes = parsed.routes.map((r: Record<string, unknown>) => ({
        pattern: r.pattern as string,
        zone_name: r.zone_name as string | undefined,
        zone_id: r.zone_id as string | undefined,
        custom_domain: r.custom_domain as boolean | undefined,
      }));
    }
    
    if (typeof parsed.route === 'string') {
      config.route = parsed.route;
    }
    
    // Parse assets
    const assets = parsed.assets as Record<string, unknown> | undefined;
    if (assets) {
      config.assets = {
        directory: assets.directory as string | undefined,
        binding: assets.binding as string | undefined,
      };
    }
    
    // Parse vars
    const vars = parsed.vars as Record<string, unknown> | undefined;
    if (vars) {
      config.vars = {};
      for (const [key, value] of Object.entries(vars)) {
        if (typeof value === 'string') {
          config.vars[key] = value;
        }
      }
    }
    
    return config;
  } catch (error) {
    // Failed to parse, return null
    return null;
  }
}

/**
 * Extract resource IDs from a parsed wrangler.toml config
 */
export function extractResourceIds(config: ParsedWranglerConfig): ResourceIds {
  const resources: ResourceIds = {};
  
  // Extract D1 database ID (use the first one with binding "DB")
  const dbBinding = config.d1_databases?.find(db => db.binding === 'DB');
  if (dbBinding) {
    if (dbBinding.database_id && !dbBinding.database_id.includes('REPLACE')) {
      resources.database_id = dbBinding.database_id;
    }
    if (dbBinding.database_name) {
      resources.database_name = dbBinding.database_name;
    }
  }
  
  // Extract KV namespace ID (use the first one with binding "KV")
  const kvBinding = config.kv_namespaces?.find(kv => kv.binding === 'KV');
  if (kvBinding?.id && !kvBinding.id.includes('REPLACE')) {
    resources.kv_namespace_id = kvBinding.id;
  }
  
  // Extract R2 bucket name (use the first one with binding "R2_BUCKET")
  const r2Binding = config.r2_buckets?.find(r2 => r2.binding === 'R2_BUCKET');
  if (r2Binding?.bucket_name) {
    resources.r2_bucket_name = r2Binding.bucket_name;
  }
  
  // Extract queue name (use the first producer with binding "QUEUE")
  const queueProducer = config.queues?.producers?.find(q => q.binding === 'QUEUE');
  if (queueProducer?.queue) {
    resources.queue_name = queueProducer.queue;
  }
  
  return resources;
}

/**
 * Check which resources are missing from a parsed config
 */
export function findMissingResources(
  config: ParsedWranglerConfig | null,
  workerName: string,
  paidTier: boolean
): {
  needsDatabase: boolean;
  needsKV: boolean;
  needsR2: boolean;
  needsQueue: boolean;
  existingResources: ResourceIds;
} {
  const existingResources = config ? extractResourceIds(config) : {};
  
  return {
    needsDatabase: !existingResources.database_id,
    needsKV: !existingResources.kv_namespace_id,
    needsR2: !existingResources.r2_bucket_name,
    needsQueue: paidTier && !existingResources.queue_name,
    existingResources,
  };
}

/**
 * Generate TOML content for resource bindings
 */
function generateResourceBindings(
  workerName: string,
  resources: ResourceIds,
  paidTier: boolean
): string {
  const lines: string[] = [];
  
  // D1 Database
  lines.push('# D1 Database');
  lines.push('[[d1_databases]]');
  lines.push('binding = "DB"');
  lines.push(`database_name = "${resources.database_name || `${workerName}-db`}"`);
  lines.push(`database_id = "${resources.database_id || 'REPLACE_WITH_YOUR_DATABASE_ID'}"`);
  lines.push('');
  
  // KV Namespace
  lines.push('# KV Namespace for caching');
  lines.push('[[kv_namespaces]]');
  lines.push('binding = "KV"');
  lines.push(`id = "${resources.kv_namespace_id || 'REPLACE_WITH_YOUR_KV_NAMESPACE_ID'}"`);
  lines.push('');
  
  // R2 Bucket
  lines.push('# R2 Bucket for artifacts');
  lines.push('[[r2_buckets]]');
  lines.push('binding = "R2_BUCKET"');
  lines.push(`bucket_name = "${resources.r2_bucket_name || `${workerName}-artifacts`}"`);
  lines.push('');
  
  // Queue (paid tier only)
  if (paidTier && resources.queue_name) {
    lines.push('# Queue for async operations');
    lines.push('[[queues.producers]]');
    lines.push('binding = "QUEUE"');
    lines.push(`queue = "${resources.queue_name}"`);
    lines.push('');
    lines.push('[[queues.consumers]]');
    lines.push(`queue = "${resources.queue_name}"`);
    lines.push('max_batch_size = 10');
    lines.push('max_batch_timeout = 30');
    lines.push('');
  } else if (!paidTier) {
    lines.push('# Queue for async operations (requires Workers Paid plan)');
    lines.push('# Uncomment the following lines if you\'re on the paid tier:');
    lines.push('# [[queues.producers]]');
    lines.push('# binding = "QUEUE"');
    lines.push(`# queue = "${workerName}-queue"`);
    lines.push('#');
    lines.push('# [[queues.consumers]]');
    lines.push(`# queue = "${workerName}-queue"`);
    lines.push('# max_batch_size = 10');
    lines.push('# max_batch_timeout = 30');
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Generate a complete wrangler.toml configuration
 */
export function generateWranglerToml(
  workerName: string,
  resources: ResourceIds,
  options: {
    paidTier: boolean;
    domain?: string;
    mainPath?: string;
    uiAssetsPath?: string;
  }
): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`name = "${workerName}"`);
  lines.push(`main = "${options.mainPath || 'node_modules/@package-broker/main/dist/index.js'}"`);
  lines.push('compatibility_date = "2024-09-23"');
  lines.push('compatibility_flags = ["nodejs_compat"]');
  lines.push('');
  
  // Assets configuration
  if (options.uiAssetsPath) {
    lines.push('# Static Assets (UI)');
    lines.push('[assets]');
    lines.push(`directory = "${options.uiAssetsPath}"`);
    lines.push('binding = "ASSETS"');
    lines.push('');
  }
  
  // Variables section
  lines.push('[vars]');
  lines.push('# ENCRYPTION_KEY is set as a Cloudflare secret, not in this file');
  lines.push('# It was automatically set during initialization via: wrangler secret put ENCRYPTION_KEY');
  lines.push('# To update it manually, use: wrangler secret put ENCRYPTION_KEY');
  lines.push('# Or set it via Cloudflare dashboard: Workers & Pages → Settings → Variables and Secrets');
  lines.push('');
  lines.push('# Maximum package versions to return per package (reduces CPU time for packages with 100+ versions)');
  lines.push('# Auto-detected based on tier:');
  lines.push('#   - Free tier (no QUEUE): defaults to 50 versions');
  lines.push('#   - Paid tier (with QUEUE): defaults to unlimited (0)');
  lines.push('# Uncomment to override the auto-detected default:');
  lines.push('# MAX_PACKAGE_VERSIONS = "50"');
  lines.push('');
  
  // Observability section
  lines.push('# Workers Logs (free tier: 200k events/day, 3-day retention)');
  lines.push('# View logs in Cloudflare Dashboard: Workers & Pages > Your Worker > Logs');
  lines.push('[observability]');
  lines.push('enabled = true');
  lines.push('head_sampling_rate = 1');
  lines.push('');
  
  // Resource bindings
  lines.push(generateResourceBindings(workerName, resources, options.paidTier));
  
  // Custom domain routes
  // Note: custom_domain = true requires the pattern WITHOUT the /* suffix
  if (options.domain) {
    lines.push('# Custom domain route');
    lines.push('[[routes]]');
    lines.push(`pattern = "${options.domain}"`);
    lines.push('custom_domain = true');
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Merge new resource IDs into an existing wrangler.toml content
 */
export function mergeResourcesIntoConfig(
  existingContent: string,
  resources: ResourceIds,
  workerName: string,
  options: {
    paidTier: boolean;
    domain?: string;
  }
): string {
  let content = existingContent;
  
  // Update database_id if provided
  if (resources.database_id) {
    content = content.replace(
      /database_id\s*=\s*["']?[^"'\n]*["']?/g,
      `database_id = "${resources.database_id}"`
    );
  }
  
  // Update KV namespace id if provided
  if (resources.kv_namespace_id) {
    // Find [[kv_namespaces]] section and update the id
    content = content.replace(
      /(\[\[kv_namespaces\]\][^\[]*?)id\s*=\s*["'][^"']*["']/,
      `$1id = "${resources.kv_namespace_id}"`
    );
  }
  
  // Update R2 bucket name if provided
  if (resources.r2_bucket_name) {
    content = content.replace(
      /(\[\[r2_buckets\]\][^\[]*?)bucket_name\s*=\s*["'][^"']*["']/,
      `$1bucket_name = "${resources.r2_bucket_name}"`
    );
  }
  
  // Add queue configuration if paid tier and queue exists but not in config
  if (options.paidTier && resources.queue_name) {
    if (!content.includes('[[queues.producers]]') || content.includes('# [[queues.producers]]')) {
      // Remove commented queue section and add active one
      content = content.replace(
        /# Queue for async operations.*?# max_batch_timeout = \d+/s,
        `# Queue for async operations
[[queues.producers]]
binding = "QUEUE"
queue = "${resources.queue_name}"

[[queues.consumers]]
queue = "${resources.queue_name}"
max_batch_size = 10
max_batch_timeout = 30`
      );
    }
  }
  
  // Add custom domain route if provided and not already present
  // Note: custom_domain = true requires the pattern WITHOUT the /* suffix
  if (options.domain && !content.includes(`pattern = "${options.domain}`)) {
    // Check if routes section exists
    if (!content.includes('[[routes]]')) {
      content = content.trimEnd() + `

# Custom domain route
[[routes]]
pattern = "${options.domain}"
custom_domain = true
`;
    }
  }
  
  return content;
}
