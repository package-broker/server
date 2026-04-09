/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { describe, it, expect } from 'vitest';
import { ensureZipFormat } from '../routes/dist';
import { zipSync, unzipSync, gzipSync } from 'fflate';

/**
 * Create a minimal valid TAR archive from a record of filename→content.
 */
function createTar(files: Record<string, string>): Uint8Array {
  const blocks: Uint8Array[] = [];

  for (const [name, content] of Object.entries(files)) {
    const contentBytes = new TextEncoder().encode(content);
    const header = new Uint8Array(512);

    // Filename (bytes 0-99)
    const nameBytes = new TextEncoder().encode(name);
    header.set(nameBytes.slice(0, 100), 0);

    // File mode (bytes 100-107): 0000644
    header.set(new TextEncoder().encode('0000644\0'), 100);

    // Owner/group (bytes 108-123): zeros
    header.set(new TextEncoder().encode('0000000\0'), 108);
    header.set(new TextEncoder().encode('0000000\0'), 116);

    // File size in octal (bytes 124-135)
    const sizeOctal = contentBytes.length.toString(8).padStart(11, '0') + '\0';
    header.set(new TextEncoder().encode(sizeOctal), 124);

    // Modification time (bytes 136-147)
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
    header.set(new TextEncoder().encode(mtime), 136);

    // Type flag (byte 156): '0' = regular file
    header[156] = 48; // ASCII '0'

    // UStar magic (bytes 257-262)
    header.set(new TextEncoder().encode('ustar\0'), 257);

    // UStar version (bytes 263-264)
    header.set(new TextEncoder().encode('00'), 263);

    // Compute checksum (bytes 148-155): sum of all header bytes, treating checksum field as spaces
    header.set(new TextEncoder().encode('        '), 148); // 8 spaces
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i];
    const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 ';
    header.set(new TextEncoder().encode(checksumStr), 148);

    blocks.push(header);

    // File data padded to 512 bytes
    const paddedSize = Math.ceil(contentBytes.length / 512) * 512;
    const dataBlock = new Uint8Array(paddedSize);
    dataBlock.set(contentBytes);
    blocks.push(dataBlock);
  }

  // End-of-archive: two 512-byte zero blocks
  blocks.push(new Uint8Array(1024));

  const totalSize = blocks.reduce((sum, b) => sum + b.length, 0);
  const tar = new Uint8Array(totalSize);
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }
  return tar;
}

describe('ensureZipFormat', () => {
  it('should pass through ZIP data unchanged', async () => {
    const originalZip = zipSync({ 'test.txt': new TextEncoder().encode('hello') });
    const result = await ensureZipFormat(originalZip);
    expect(result).toEqual(originalZip);
  });

  it('should convert a TAR archive to ZIP', async () => {
    const tar = createTar({ 'hello.txt': 'world' });
    const result = await ensureZipFormat(tar);

    // Verify it's a valid ZIP by unzipping
    const files = unzipSync(result);
    expect(files['hello.txt']).toBeDefined();
    expect(new TextDecoder().decode(files['hello.txt'])).toBe('world');
  });

  it('should convert a .tar.gz archive to ZIP', async () => {
    const tar = createTar({ 'pkg/composer.json': '{"name": "test/pkg"}' });
    // Verify the TAR is valid before gzipping
    expect(tar.length).toBeGreaterThan(512);
    const tarGz = gzipSync(tar);
    // Verify gzip magic
    expect(tarGz[0]).toBe(0x1f);
    expect(tarGz[1]).toBe(0x8b);

    const result = await ensureZipFormat(tarGz);

    // Verify ZIP magic
    expect(result[0]).toBe(0x50); // P
    expect(result[1]).toBe(0x4B); // K
    const files = unzipSync(result);
    expect(files['pkg/composer.json']).toBeDefined();
    expect(new TextDecoder().decode(files['pkg/composer.json'])).toContain('test/pkg');
  });

  it('should sanitize path traversal in TAR entries', async () => {
    const tar = createTar({ '../../etc/passwd': 'root:x:0:0' });
    const result = await ensureZipFormat(tar);

    const files = unzipSync(result);
    // Should not have the traversal path
    expect(files['../../etc/passwd']).toBeUndefined();
    // Should be sanitized to just 'etc/passwd'
    expect(files['etc/passwd']).toBeDefined();
  });

  it('should sanitize backslash traversal in TAR entries', async () => {
    const tar = createTar({ 'vendor/..\\evil/payload.txt': 'malicious' });
    const result = await ensureZipFormat(tar);

    const files = unzipSync(result);
    // Backslash traversal should be neutralized
    expect(files['vendor/..\\evil/payload.txt']).toBeUndefined();
    // Should be sanitized
    const keys = Object.keys(files);
    for (const key of keys) {
      expect(key).not.toContain('..');
    }
  });

  it('should handle empty TAR archive', async () => {
    // Just two zero blocks = empty archive
    const emptyTar = new Uint8Array(1024);
    // Add ustar magic so it's detected as TAR
    emptyTar.set(new TextEncoder().encode('ustar\0'), 257);

    const result = await ensureZipFormat(emptyTar);
    const files = unzipSync(result);
    expect(Object.keys(files)).toHaveLength(0);
  });

  it('should handle TAR with multiple files', async () => {
    const tar = createTar({
      'src/index.ts': 'export default {}',
      'package.json': '{"name": "test"}',
      'README.md': '# Hello',
    });
    const result = await ensureZipFormat(tar);

    const files = unzipSync(result);
    expect(Object.keys(files)).toHaveLength(3);
    expect(files['src/index.ts']).toBeDefined();
    expect(files['package.json']).toBeDefined();
    expect(files['README.md']).toBeDefined();
  });

  it('should handle Uint8Array input', async () => {
    const zip = zipSync({ 'a.txt': new TextEncoder().encode('a') });
    const result = await ensureZipFormat(new Uint8Array(zip));
    expect(result).toEqual(zip);
  });

  it('should handle ArrayBuffer input', async () => {
    const zip = zipSync({ 'a.txt': new TextEncoder().encode('a') });
    const result = await ensureZipFormat(zip.buffer as ArrayBuffer);
    // Content should match (may be different Uint8Array instance)
    expect(new Uint8Array(result)).toEqual(zip);
  });
});
