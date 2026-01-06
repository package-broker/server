/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { unzipSync, strFromU8 } from 'fflate';

/**
 * Composer package metadata structure
 * Based on https://getcomposer.org/doc/04-schema.md
 */
export interface ComposerMetadata {
  name: string; // Required: vendor/package format
  version: string; // Required: semantic version
  description?: string;
  license?: string | string[];
  type?: string; // library, project, metapackage, composer-plugin
  homepage?: string;
  readme?: string;
  time?: string; // ISO 8601 timestamp
  authors?: Array<{
    name?: string;
    email?: string;
    homepage?: string;
    role?: string;
  }>;
  support?: {
    email?: string;
    issues?: string;
    forum?: string;
    wiki?: string;
    irc?: string;
    source?: string;
    docs?: string;
    rss?: string;
  };
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
  conflict?: Record<string, string>;
  replace?: Record<string, string>;
  provide?: Record<string, string>;
  suggest?: Record<string, string>;
  autoload?: {
    'psr-0'?: Record<string, string | string[]>;
    'psr-4'?: Record<string, string | string[]>;
    classmap?: string[];
    files?: string[];
  };
  'autoload-dev'?: {
    'psr-0'?: Record<string, string | string[]>;
    'psr-4'?: Record<string, string | string[]>;
    classmap?: string[];
    files?: string[];
  };
  bin?: string[];
  extra?: Record<string, any>;
  [key: string]: any; // Allow additional fields
}

/**
 * Validation result for package archives
 */
export interface ValidationResult {
  success: boolean;
  metadata?: ComposerMetadata;
  errors?: string[];
}

/**
 * Validate a package archive and extract composer.json metadata
 * 
 * Performance optimized for Cloudflare Workers:
 * - Limits composer.json search to first 100 files (avoid DoS)
 * - Limits composer.json size to 1MB (avoid memory exhaustion)
 * - Uses synchronous unzip (faster for small files)
 * 
 * @param archiveData - Zip archive as Uint8Array
 * @returns Validation result with metadata or errors
 */
export async function validatePackageArchive(
  archiveData: Uint8Array
): Promise<ValidationResult> {
  const errors: string[] = [];
  
  // Basic validation
  if (!archiveData || archiveData.length === 0) {
    return {
      success: false,
      errors: ['Archive is empty or invalid'],
    };
  }

  // Check if file is too large (max 100MB to avoid memory issues)
  const MAX_ARCHIVE_SIZE = 100 * 1024 * 1024; // 100MB
  if (archiveData.length > MAX_ARCHIVE_SIZE) {
    return {
      success: false,
      errors: [`Archive too large: ${Math.round(archiveData.length / 1024 / 1024)}MB (max 100MB)`],
    };
  }

  // Check if it's a valid ZIP file (magic bytes: 50 4B 03 04 or 50 4B 05 06)
  if (archiveData.length < 4) {
    return {
      success: false,
      errors: ['File too small to be a valid ZIP archive'],
    };
  }

  const magic = archiveData[0] === 0x50 && archiveData[1] === 0x4B;
  if (!magic) {
    return {
      success: false,
      errors: ['Invalid ZIP archive format (only .zip files are supported)'],
    };
  }

  // Extract files from ZIP
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archiveData);
  } catch (error) {
    console.error(`[package-validator] Failed to extract ZIP:`, error);
    return {
      success: false,
      errors: [`Failed to extract ZIP archive: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }

  // Find composer.json file using direct path lookup (much faster than iteration)
  // This approach finds composer.json regardless of how many files are in the archive
  const allPaths = Object.keys(files);
  console.log(`[package-validator] Archive contains ${allPaths.length} files`);
  
  // Find all composer.json files in the archive (case-insensitive)
  const composerJsonPaths = allPaths.filter(p => {
    const pathLower = p.toLowerCase();
    // Match: composer.json, */composer.json, or */*/composer.json
    return pathLower === 'composer.json' ||
           /^[^/]+\/composer\.json$/.test(pathLower) ||
           /^[^/]+\/[^/]+\/composer\.json$/.test(pathLower);
  });

  console.log(`[package-validator] Found ${composerJsonPaths.length} composer.json file(s):`, composerJsonPaths);

  if (composerJsonPaths.length === 0) {
    // Debug: show first 20 paths to help troubleshoot
    console.log(`[package-validator] First 20 paths in archive:`, allPaths.slice(0, 20));
    
    // Also check if there's a composer.json at any depth (for better error message)
    const deepComposerPaths = allPaths.filter(p => p.toLowerCase().endsWith('/composer.json') || p.toLowerCase() === 'composer.json');
    if (deepComposerPaths.length > 0) {
      console.log(`[package-validator] Found composer.json at unsupported depth:`, deepComposerPaths);
      return {
        success: false,
        errors: [`composer.json found but too deep in directory structure: ${deepComposerPaths[0]} (max 2 levels)`],
      };
    }
    
    return {
      success: false,
      errors: [`composer.json not found in archive (${allPaths.length} files, searched root and up to 2 levels deep)`],
    };
  }

  // Sort by depth (prefer shallower paths) and pick the first one
  // Depth 0: composer.json, Depth 1: dir/composer.json, Depth 2: dir/subdir/composer.json
  const sortedPaths = composerJsonPaths.sort((a, b) => {
    const depthA = (a.match(/\//g) || []).length;
    const depthB = (b.match(/\//g) || []).length;
    return depthA - depthB;
  });

  const composerJsonPath = sortedPaths[0];
  const content = files[composerJsonPath];
  
  console.log(`[package-validator] Using composer.json at: ${composerJsonPath}`);

  // Check file size (max 1MB for composer.json)
  const MAX_COMPOSER_JSON_SIZE = 1024 * 1024; // 1MB
  if (content.length > MAX_COMPOSER_JSON_SIZE) {
    return {
      success: false,
      errors: [`composer.json too large: ${Math.round(content.length / 1024)}KB (max 1MB)`],
    };
  }

  let composerJsonContent: string;
  try {
    composerJsonContent = strFromU8(content);
  } catch (error) {
    return {
      success: false,
      errors: [`Failed to read ${composerJsonPath}: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }

  // Parse composer.json
  let metadata: ComposerMetadata;
  try {
    metadata = JSON.parse(composerJsonContent);
  } catch (error) {
    return {
      success: false,
      errors: [`Invalid JSON in ${composerJsonPath}: ${error instanceof Error ? error.message : 'Parse error'}`],
    };
  }

  // Validate required fields
  if (!metadata.name) {
    errors.push('Missing required field: "name"');
  } else {
    // Validate name format (vendor/package)
    const namePattern = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/i;
    if (!namePattern.test(metadata.name)) {
      errors.push(`Invalid package name format: "${metadata.name}" (must be vendor/package)`);
    }
  }

  if (!metadata.version) {
    errors.push('Missing required field: "version"');
  } else {
    // Validate version format (loose semantic versioning check)
    const versionPattern = /^v?(\d+)(\.\d+)?(\.\d+)?(\.\d+)?([.-]?(alpha|beta|rc|dev|patch|pl|p)\.?\d*)?$/i;
    if (!versionPattern.test(metadata.version)) {
      errors.push(`Invalid version format: "${metadata.version}" (must follow semantic versioning)`);
    }
  }

  // Optional: Validate type field if present
  if (metadata.type) {
    const validTypes = [
      'library', 'project', 'metapackage', 'composer-plugin',
      'magento2-module', 'magento2-theme', 'magento2-language',
      'wordpress-plugin', 'wordpress-theme', 'symfony-bundle',
      'drupal-module', 'drupal-theme',
    ];
    
    // Allow other types but warn if not in common list
    if (!validTypes.includes(metadata.type) && !metadata.type.match(/^(magento|wordpress|drupal|symfony|laravel|typo3)-/)) {
      // This is just informational, not a validation error
      console.log(`Non-standard package type: "${metadata.type}"`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors,
    };
  }

  return {
    success: true,
    metadata,
  };
}

/**
 * Extract README.md from package archive (reused from existing code)
 * Performance: Only extracts README if found in first 50 files
 */
export function extractReadme(zipData: Uint8Array): string | null {
  try {
    const files = unzipSync(zipData);
    
    const readmeNames = [
      'README.md', 'readme.md', 'README.MD', 'Readme.md',
      'README.mdown', 'readme.mdown', 'README.MDOWN', 'Readme.mdown',
      'README', 'readme', 'README.txt', 'readme.txt',
    ];

    let filesChecked = 0;
    const MAX_FILES_TO_CHECK = 50;

    // Look for README in root or first-level directory
    for (const [path, content] of Object.entries(files)) {
      filesChecked++;
      if (filesChecked > MAX_FILES_TO_CHECK) {
        break;
      }

      const filename = path.split('/').pop() || '';
      const filenameLower = filename.toLowerCase();

      // Prefer .md files
      if (readmeNames.slice(0, 8).some(name => filenameLower === name.toLowerCase())) {
        // Limit README size to 500KB
        if (content.length > 500 * 1024) {
          console.warn(`README too large: ${path} (${content.length} bytes)`);
          continue;
        }
        return strFromU8(content);
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting README from ZIP:', error);
    return null;
  }
}

