# Go-Live Checklist for Open Source Release

This document outlines the findings from the comprehensive audit of the `package-broker` project. It serves as a checklist to ensure the project is ready for public release.

## 🚨 Critical Blockers (Must Fix)

- [ ] **Root README.md**: The `server/` directory (repository root) is missing a `README.md`. This is critical for any open source project. It must include:
    - Project description and value proposition.
    - Quick start / Installation instructions.
    - specialized badges (Tests, License, etc.).
    - Links to full documentation (`https://package.broker`).
- [ ] **Package READMEs**: The following core packages are missing `README.md` files:
    - `packages/core`
    - `packages/ui`
    - `packages/main` (Note: `package.json` references it in `files`, but it doesn't exist)
    - *Action*: Create basic READMEs for these packages describing their purpose and usage.

## ⚠️ Major Issues (Should Fix)

- [ ] **Vulnerabilities**: `npm audit` reports 8 moderate severity vulnerabilities related to `esbuild` and `vite`.
    - *Action*: Run `npm audit fix` or update dependencies to resolve these specific warnings.
- [ ] **Documentation Cleanup**: The directory `docs/docs/_legacy` exists.
    - *Action*: Review and delete or integrate legacy documentation before publishing the site.
- [ ] **Verify `packages/main` Usage**: Clarify the role of `@package-broker/main`. It is used in `wrangler.example.toml` as the main entry point (`packages/main/src/index.ts`), but Dockerfile uses `adapter-node`. Ensure consistency in how users are expected to run the application (Worker vs Node/Docker).

## ℹ️ Minor Improvements

- [ ] **Testing**: Ensure all tests pass (`npm test` in `server`).
- [ ] **Linter**: Ensure `npm run lint` passes across all workspaces.
- [ ] **Docker Verification**: Manually verify the built Docker image starts and functions correctly with `adapter-node`.
- [ ] **Example Configs**: Setup CI to verify `wrangler.example.toml` validity if possible.

## ✅ Verification Steps

- [ ] **Name Check**: Verified no occurrences of "Cloudflare Composer Proxy" or "cloudflare-composer-proxy" in source code or docs. (PASSED)
- [ ] **Secrets Check**: Verified `wrangler.example.toml` uses placeholders for keys and IDs. (PASSED)
- [ ] **License**: verified `LICENSE` is AGPL-3.0. (PASSED)
- [ ] **Contributing**: verified `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` exist and are populated. (PASSED)
