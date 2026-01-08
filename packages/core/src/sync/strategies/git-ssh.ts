/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * Git SSH sync strategy
 * Clones git repositories using SSH keys (Node.js only, not available in Cloudflare Workers)
 * 
 * This module uses dynamic imports for Node.js-specific modules to avoid bundling issues
 */

import type { SyncResult, ComposerPackage } from '../types';
import { getLogger } from '../../utils/logger';
import micromatch from 'micromatch';
import semver from 'semver';

const logger = getLogger();

/**
 * Clone git repository using SSH key
 * @param url - Git repository URL (SSH format: git@github.com:owner/repo.git or HTTPS)
 * @param privateKey - SSH private key
 * @param passphrase - Optional passphrase for encrypted private key
 * @param composerJsonPath - Glob pattern for composer.json files
 * @returns Sync result with packages
 */
export async function syncViaGitSsh(
  url: string,
  privateKey: string,
  passphrase?: string,
  composerJsonPath: string = '**/composer.json'
): Promise<SyncResult> {
  // Dynamically import Node.js modules (only available in Node.js environment)
  const { spawn } = await import('child_process');
  const { promisify } = await import('util');
  const { writeFile, mkdir, rm, chmod, readFile } = await import('fs/promises');
  const { join } = await import('path');
  const { tmpdir } = await import('os');

  const tempDir = join(tmpdir(), `package-broker-${Date.now()}-${Math.random().toString(36).slice(0, 7)}`);
  const keyPath = join(tempDir, 'ssh_key');
  let repoPath: string | null = null;

  try {
    // Create temporary directory
    await mkdir(tempDir, { recursive: true });

    // Write private key to temporary file
    await writeFile(keyPath, privateKey, { mode: 0o600 });
    await chmod(keyPath, 0o600);

    // Convert HTTPS URL to SSH format if needed
    const sshUrl = convertToSshUrl(url);
    repoPath = join(tempDir, 'repo');

    // Clone repository using SSH
    await cloneRepository(sshUrl, repoPath, keyPath, passphrase);

    // Find and parse composer.json files
    const packages = await findAndParseComposerFiles(repoPath, composerJsonPath);

    if (packages.length === 0) {
      return {
        success: false,
        packages: [],
        error: 'no_composer_json_found',
      };
    }

    logger.info('SSH git sync completed', {
      url,
      packageCount: packages.length,
    });

    return {
      success: true,
      packages,
      strategy: 'git_ssh',
    };
  } catch (error) {
    logger.error('SSH git sync failed', { url, error: error instanceof Error ? error.message : String(error) });
    
    return {
      success: false,
      packages: [],
      error: error instanceof Error ? error.message : 'ssh_sync_failed',
    };
  } finally {
    // Clean up temporary files
    try {
      if (repoPath) {
        await rm(repoPath, { recursive: true, force: true });
      }
      if (keyPath) {
        await rm(keyPath, { force: true });
      }
      await rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn('Failed to clean up temporary files', { tempDir, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) });
    }
  }
}

/**
 * Convert HTTPS URL to SSH format
 * Example: https://github.com/owner/repo.git -> git@github.com:owner/repo.git
 */
function convertToSshUrl(url: string): string {
  // If already SSH format, return as-is
  if (url.startsWith('git@') || url.startsWith('ssh://')) {
    return url;
  }

  // Convert HTTPS to SSH
  const match = url.match(/https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (match) {
    const [, host, owner, repo] = match;
    return `git@${host}:${owner}/${repo}.git`;
  }

  // If conversion fails, return original URL (git clone will handle it)
  return url;
}

/**
 * Clone git repository using SSH key
 */
/**
 * Escape a string for use in shell command (basic escaping)
 * Only escapes single quotes and wraps in single quotes
 */
function escapeShellArg(arg: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

async function cloneRepository(
  url: string,
  targetPath: string,
  keyPath: string,
  passphrase?: string
): Promise<void> {
  const { spawn } = await import('child_process');
  
  return new Promise((resolve, reject) => {
    // Set up SSH command with key - properly escape keyPath
    // Use -i with properly escaped path to prevent command injection
    const escapedKeyPath = escapeShellArg(keyPath);
    const sshCommand = `ssh -i ${escapedKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes`;
    
    // Set environment variables
    // Note: For passphrase-protected keys, sshpass is required
    // The passphrase is escaped to prevent command injection
    const env = {
      ...process.env,
      GIT_SSH_COMMAND: passphrase 
        ? `sshpass -p ${escapeShellArg(passphrase)} ${sshCommand}` 
        : sshCommand,
    };

    // For passphrase-protected keys, we need ssh-agent or expect
    // For now, we'll use a simpler approach with GIT_SSH_COMMAND
    // Note: This requires sshpass to be installed for passphrase support
    const gitProcess = spawn('git', ['clone', '--depth', '1', url, targetPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Git clone failed: ${stderr || stdout || 'Unknown error'}`));
      }
    });

    gitProcess.on('error', (error) => {
      reject(new Error(`Failed to spawn git process: ${error.message}`));
    });
  });
}

/**
 * Recursively find files matching a name pattern
 * Uses Node.js APIs instead of shell commands for security
 */
async function findFilesRecursive(
  dirPath: string,
  fileName: string
): Promise<string[]> {
  const { readdir, stat } = await import('fs/promises');
  const { join } = await import('path');
  
  const files: string[] = [];
  
  async function walkDir(currentPath: string): Promise<void> {
    try {
      const entries = await readdir(currentPath);
      
      for (const entry of entries) {
        const fullPath = join(currentPath, entry);
        try {
          const stats = await stat(fullPath);
          
          if (stats.isDirectory()) {
            await walkDir(fullPath);
          } else if (stats.isFile() && entry === fileName) {
            files.push(fullPath);
          }
        } catch {
          // Skip files/dirs we can't access
          continue;
        }
      }
    } catch {
      // Skip directories we can't read
      return;
    }
  }
  
  await walkDir(dirPath);
  return files;
}

/**
 * Find and parse composer.json files from cloned repository
 */
async function findAndParseComposerFiles(
  repoPath: string,
  pattern: string
): Promise<ComposerPackage[]> {
  try {
    // Find all composer.json files using Node.js APIs (no shell commands)
    const allFiles = await findFilesRecursive(repoPath, 'composer.json');

    // Filter files by glob pattern
    // Make paths relative to repoPath for pattern matching
    const relativeFiles = allFiles.map((file: string) => {
      const relative = file.replace(repoPath, '').replace(/^\//, '');
      return relative;
    });
    const matchedFiles = micromatch(relativeFiles, pattern);
    
    // Convert back to full paths
    const { join } = await import('path');
    const fullMatchedFiles = matchedFiles.map((file: string) => join(repoPath, file));

    if (matchedFiles.length === 0) {
      return [];
    }

    // Parse each composer.json file
    const packages: ComposerPackage[] = [];

    const { readFile } = await import('fs/promises');

    for (const fullPath of fullMatchedFiles) {
      try {
        const content = await readFile(fullPath, 'utf-8');
        const composerJson = JSON.parse(content);

        if (composerJson.name) {
          // Get version from git tags
          const versions = await getVersionsFromTags(repoPath);
          
          for (const version of versions) {
            packages.push({
              name: composerJson.name,
              version,
              description: composerJson.description,
              license: composerJson.license,
              type: composerJson.type,
              homepage: composerJson.homepage,
              require: composerJson.require,
              'require-dev': composerJson['require-dev'],
              autoload: composerJson.autoload,
            });
          }

          // If no versions found, add at least one entry
          if (versions.length === 0) {
            packages.push({
              name: composerJson.name,
              version: 'dev-main',
              description: composerJson.description,
              license: composerJson.license,
              type: composerJson.type,
              homepage: composerJson.homepage,
              require: composerJson.require,
              'require-dev': composerJson['require-dev'],
              autoload: composerJson.autoload,
            });
          }
        }
      } catch (error) {
        logger.warn('Failed to parse composer.json', { file: fullPath, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return packages;
  } catch (error) {
    logger.error('Failed to find composer.json files', { repoPath, pattern, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Get versions from git tags
 */
async function getVersionsFromTags(repoPath: string): Promise<string[]> {
  const { spawn } = await import('child_process');
  const { promisify } = await import('util');

  try {
    // Use spawn with cwd option instead of shell cd command for security
    return new Promise((resolve) => {
      const gitProcess = spawn('git', ['tag', '-l'], {
        cwd: repoPath, // Use cwd option instead of shell cd
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      gitProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          const tags = stdout.trim().split('\n').filter(Boolean);
          
          // Filter and sort valid semver tags
          const versions = tags
            .map((tag: string) => tag.replace(/^v/, '')) // Remove 'v' prefix
            .filter((tag: string) => semver.valid(tag))
            .sort((a: string, b: string) => semver.rcompare(a, b))
            .slice(0, 50); // Limit to 50 versions

          resolve(versions);
        } else {
          logger.warn('Failed to get git tags', { repoPath, stderr });
          resolve([]);
        }
      });

      gitProcess.on('error', (error) => {
        logger.warn('Failed to spawn git tag process', { repoPath, error: error instanceof Error ? error.message : String(error) });
        resolve([]);
      });
    });
  } catch (error) {
    logger.warn('Failed to get git tags', { repoPath, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

