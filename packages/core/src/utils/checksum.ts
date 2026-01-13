/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Compute SHA-1 checksum (shasum) for package archive
 * Used for Composer dist.shasum field
 */
export function computeShasum(data: Uint8Array): string {
  const hash = sha1(data);
  return bytesToHex(hash);
}
