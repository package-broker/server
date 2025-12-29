#!/usr/bin/env node
/**
 * Post-build script to inject require shim into the entry point
 * This avoids duplicate imports that occur when using tsup banner
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const entryFile = join(distDir, 'index.js');

// Read the current entry file
let content = readFileSync(entryFile, 'utf8');

// Check if require shim is already present
if (content.includes('globalThis.require = createRequire')) {
  console.log('✅ Require shim already present in entry file');
  process.exit(0);
}

// Check if createRequire is already imported at the top
// We look for it in the first few lines to avoid false positives
const firstLines = content.split('\n').slice(0, 20).join('\n');
const hasCreateRequireImport = firstLines.includes("import { createRequire }") || 
                               firstLines.includes('import { createRequire }');

// Use synchronous import to set up require BEFORE any other code runs
// This must execute synchronously because bundled chunks use require() during module loading
const shimCode = `import { createRequire } from 'module';
// Require shim for ESM context (injected by post-build script)
// This must be set up synchronously before any imports execute
// because bundled CommonJS dependencies use require() during module loading
if (typeof globalThis.require === 'undefined') {
  globalThis.require = createRequire(import.meta.url);
}
`;
content = shimCode + content;

// Write back to file
writeFileSync(entryFile, content, 'utf8');
console.log('✅ Injected require shim into entry file');
