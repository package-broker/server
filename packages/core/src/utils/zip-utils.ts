/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { unzipSync, strFromU8 } from 'fflate';
import { getLogger } from './logger';

const MAX_FILE_SIZE = 500 * 1024; // 500 KB

/**
 * Extract a file from a ZIP archive by matching against a list of filename patterns.
 * Searches the archive entries and returns the content of the first match.
 * Matching is case-insensitive. Prefers .md over .mdown when both exist.
 *
 * @param zipData - Raw ZIP archive bytes
 * @param filePatterns - Filenames to look for (e.g. ['README.md', 'readme.md'])
 * @returns File content as string, or null if not found
 */
export function extractFileFromZip(
  zipData: Uint8Array,
  filePatterns: string[],
): string | null {
  try {
    const files = unzipSync(zipData);
    const patternsLower = filePatterns.map((p) => p.toLowerCase());

    for (const [path, content] of Object.entries(files)) {
      const filename = path.split('/').pop() || '';
      if (patternsLower.includes(filename.toLowerCase())) {
        if (content.length > MAX_FILE_SIZE) {
          const logger = getLogger();
          logger.warn('Skipping oversized file in ZIP', {
            path,
            size: content.length,
            maxSize: MAX_FILE_SIZE,
          });
          continue;
        }
        return strFromU8(content);
      }
    }

    return null;
  } catch (error) {
    const logger = getLogger();
    logger.error(
      'Error extracting file from ZIP',
      {},
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

const README_PATTERNS = [
  'README.md',
  'readme.md',
  'Readme.md',
  'README.mdown',
  'readme.mdown',
  'Readme.mdown',
  'README',
  'README.txt',
];

const CHANGELOG_PATTERNS = [
  'CHANGELOG.md',
  'changelog.md',
  'Changelog.md',
  'CHANGELOG.mdown',
  'changelog.mdown',
  'Changelog.mdown',
  'CHANGES.md',
];

export const extractReadme = (data: Uint8Array): string | null =>
  extractFileFromZip(data, README_PATTERNS);

export const extractChangelog = (data: Uint8Array): string | null =>
  extractFileFromZip(data, CHANGELOG_PATTERNS);
