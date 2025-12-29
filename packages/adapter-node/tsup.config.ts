import { defineConfig } from 'tsup';
import path from 'path';

const cloudflarePlugin = {
    name: 'cloudflare-workers-mock',
    setup(build) {
        build.onResolve({ filter: /^cloudflare:workers$/ }, args => {
            return { path: path.resolve(__dirname, 'src/mocks/cloudflare-workers.ts') }
        });
    },
};


// Node.js built-in modules that should not be bundled
const nodeBuiltins = [
    'util', 'path', 'fs', 'os', 'crypto', 'stream', 'events', 'buffer',
    'url', 'querystring', 'http', 'https', 'net', 'tls', 'dns', 'zlib',
    'child_process', 'cluster', 'module', 'process', 'assert', 'string_decoder',
    'timers', 'punycode', 'readline', 'repl', 'tty', 'vm', 'worker_threads'
];

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    noExternal: ['@package-broker/core', '@package-broker/shared'],
    external: nodeBuiltins,
    clean: true,
    esbuildPlugins: [cloudflarePlugin],
    // Inject require shim into ALL output files (entry + chunks)
    // This is necessary because chunks use require() during module loading
    banner: {
        js: `
import { createRequire } from 'module';
if (typeof globalThis.require === 'undefined') {
  globalThis.require = createRequire(import.meta.url);
}
`.trim(),
    },
});
