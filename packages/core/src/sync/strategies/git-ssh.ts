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
async function cloneRepository(
  url: string,
  targetPath: string,
  keyPath: string,
  passphrase?: string
): Promise<void> {
  const { spawn } = await import('child_process');
  
  return new Promise((resolve, reject) => {
    // Set up SSH command with key
    const sshCommand = `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes`;
    
    // Set environment variables
    const env = {
      ...process.env,
      GIT_SSH_COMMAND: passphrase 
        ? `sshpass -p '${passphrase}' ${sshCommand}` 
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
 * Find and parse composer.json files from cloned repository
 */
async function findAndParseComposerFiles(
  repoPath: string,
  pattern: string
): Promise<ComposerPackage[]> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    // Find all composer.json files matching the pattern
    // Use proper shell escaping for the path
    const { stdout } = await execAsync(`find "${repoPath}" -name "composer.json" -type f`);
    const files = stdout.trim().split('\n').filter(Boolean);

    // Filter files by glob pattern
    const relativeFiles = files.map((file: string) => file.replace(repoPath + '/', ''));
    const matchedFiles = micromatch(relativeFiles, pattern);

    if (matchedFiles.length === 0) {
      return [];
    }

    // Parse each composer.json file
    const packages: ComposerPackage[] = [];

    const { join } = await import('path');
    const { readFile } = await import('fs/promises');

    for (const file of matchedFiles) {
      const fullPath = join(repoPath, file);
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
        logger.warn('Failed to parse composer.json', { file, error: error instanceof Error ? error.message : String(error) });
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
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    // Use proper shell escaping for the path
    const { stdout } = await execAsync(`cd "${repoPath}" && git tag -l`);
    const tags = stdout.trim().split('\n').filter(Boolean);
    
    // Filter and sort valid semver tags
    const versions = tags
      .map((tag: string) => tag.replace(/^v/, '')) // Remove 'v' prefix
      .filter((tag: string) => semver.valid(tag))
      .sort((a: string, b: string) => semver.rcompare(a, b))
      .slice(0, 50); // Limit to 50 versions

    return versions;
  } catch (error) {
    logger.warn('Failed to get git tags', { repoPath, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

