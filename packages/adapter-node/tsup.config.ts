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

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    noExternal: ['@package-broker/core', '@package-broker/shared'],
    clean: true,
    esbuildPlugins: [cloudflarePlugin],
});
