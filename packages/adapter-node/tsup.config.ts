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
    // Note: We don't add a banner here because dependencies already handle
    // their own require() shims. The external: nodeBuiltins ensures Node.js
    // built-ins are not bundled, allowing require() calls to work.
    // If a dependency needs require(), it should provide its own shim.
});
