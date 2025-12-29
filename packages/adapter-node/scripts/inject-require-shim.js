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

// Use dynamic import to avoid duplicate import issues
// This will work even if createRequire is imported elsewhere in the bundle
const shimCode = `// Require shim for ESM context (injected by post-build script)
// This allows CommonJS dependencies bundled by tsup to use require() for Node.js built-ins
if (typeof globalThis.require === 'undefined') {
  const { createRequire } = await import('module');
  globalThis.require = createRequire(import.meta.url);
}
`;
content = shimCode + content;

// Write back to file
writeFileSync(entryFile, content, 'utf8');
console.log('✅ Injected require shim into entry file');
