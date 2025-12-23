#!/usr/bin/env node

/*
 * PACKAGE.broker - Cloudflare CLI - Template Renderer
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TemplateVariables {
  worker_name: string;
  generated_db_id: string;
  generated_kv_id: string;
  generated_queue_name?: string;
  paid_tier: boolean;
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
 * Load the wrangler.example.toml template from @package-broker/main
 */
function loadTemplate(targetDir: string): string {
  const mainPackagePath = findMainPackage(targetDir);

  if (!mainPackagePath) {
    throw new Error(
      '@package-broker/main not found. Please run: npm install @package-broker/main\n' +
      '   Or ensure you are in a directory with @package-broker/main installed.'
    );
  }

  const templatePath = join(mainPackagePath, 'wrangler.example.toml');
  
  try {
    return readFileSync(templatePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to load template from @package-broker/main: ${(error as Error).message}\n` +
      `Make sure @package-broker/main is installed: npm install @package-broker/main`
    );
  }
}

/**
 * Render wrangler.toml template with variables
 */
export function renderTemplate(
  targetDir: string,
  variables: TemplateVariables
): string {
  let template = loadTemplate(targetDir);

  // Replace placeholders (both {{variable}} and REPLACE_WITH_YOUR_* formats)
  template = template.replace(/\{\{worker_name\}\}/g, variables.worker_name);
  template = template.replace(/\{\{generated_db_id\}\}/g, variables.generated_db_id);
  template = template.replace(/\{\{generated_kv_id\}\}/g, variables.generated_kv_id);
  
  // Replace literal placeholder strings from template
  template = template.replace(/REPLACE_WITH_YOUR_DATABASE_ID/g, variables.generated_db_id);
  template = template.replace(/REPLACE_WITH_YOUR_KV_NAMESPACE_ID/g, variables.generated_kv_id);

  // Update main path to point to installed package
  template = template.replace(
    /main\s*=\s*["'].*["']/,
    'main = "node_modules/@package-broker/main/dist/index.js"'
  );

  // Remove ENCRYPTION_KEY from [vars] section (it's set as a secret)
  template = template.replace(
    /\[vars\][\s\S]*?ENCRYPTION_KEY\s*=\s*["'][^"']*["']/,
    `[vars]
# ENCRYPTION_KEY is set as a Cloudflare secret, not in this file
# It was automatically set during initialization via: wrangler secret put ENCRYPTION_KEY
# To update it manually, use: wrangler secret put ENCRYPTION_KEY
# Or set it via Cloudflare dashboard: Workers & Pages → Settings → Variables and Secrets`
  );

  // Handle queue configuration based on tier
  if (!variables.paid_tier) {
    // Remove queue configuration for free tier
    template = template.replace(
      /# Queue for async operations[\s\S]*?max_batch_timeout\s*=\s*\d+/,
      `# Queue for async operations (requires Workers Paid plan)
# Uncomment the following lines if you're on the paid tier:
# [[queues.producers]]
# binding = "QUEUE"
# queue = "${variables.worker_name}-queue"
#
# [[queues.consumers]]
# queue = "${variables.worker_name}-queue"
# max_batch_size = 10
# max_batch_timeout = 30`
    );
  } else {
    // Replace queue name placeholder if paid tier
    if (variables.generated_queue_name) {
      template = template.replace(
        /queue\s*=\s*["']package-broker-queue["']/g,
        `queue = "${variables.generated_queue_name}"`
      );
    }
  }

  // Update database and resource names to use worker_name
  template = template.replace(
    /database_name\s*=\s*["']package-broker-db["']/,
    `database_name = "${variables.worker_name}-db"`
  );
  template = template.replace(
    /bucket_name\s*=\s*["']package-broker-artifacts["']/,
    `bucket_name = "${variables.worker_name}-artifacts"`
  );

  return template;
}

/**
 * Write rendered template to wrangler.toml
 */
export function writeWranglerToml(
  targetDir: string,
  content: string
): void {
  const wranglerPath = join(targetDir, 'wrangler.toml');
  writeFileSync(wranglerPath, content, 'utf-8');
}

