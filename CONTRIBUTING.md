# Contributing to PACKAGE.broker

Thank you for your interest in contributing to PACKAGE.broker. We welcome contributions from the community to help make the project better.

## getting Started

1.  **Fork the repository** on GitHub.
2.  **Clone your fork** locally:
    ```bash
    git clone https://github.com/your-username/server.git
    cd package-broker
    ```
3.  **Install dependencies**:
    ```bash
    npm install
    ```
4.  **Set up your environment**:
    - Copy `.dev.vars.example` to `.dev.vars` (if available) or set up your `wrangler.toml` vars.
    - Create a local D1 database: `npx wrangler d1 create package-broker-db`.
    - Apply migrations: `npx wrangler d1 migrations apply package-broker-db --local`.

## Architecture Overview

PACKAGE.broker supports two deployment modes:

1. **Cloudflare Workers** (`packages/main`)
   - Entry point: `packages/main/src/index.ts`
   - Uses: D1, R2, KV, Queue
   - Setup: Use `wrangler.toml` configuration
   - Start: `npm run dev` (uses wrangler)

2. **Node.js / Docker** (`packages/adapter-node`)
   - Entry point: `packages/adapter-node/dist/index.cjs`
   - Uses: SQLite/PostgreSQL, S3/R2, Memory/Redis
   - Setup: Use environment variables
   - Start: `node packages/adapter-node/dist/index.cjs`

Both modes share:
- `packages/core` - Business logic and API routes
- `packages/ui` - React dashboard
- `packages/shared` - Common types and utilities

Choose the deployment mode that fits your infrastructure.

## Development Workflow

- **Branching**: Create a new branch for your feature or bugfix (e.g., `feature/awesome-new-feature` or `fix/login-bug`).
- **Code Style**: Run `npm run typecheck` to ensure type safety.
- **Testing**:
    - **Unit Tests**: Run `npm test` to run Vitest unit tests.
    - **Type Checking**: Run `npm run typecheck` to ensure type safety.
    - **E2E Tests**: (Optional) Run `npm run test:e2e` for end-to-end testing with Playwright.

## Submitting a Pull Request

1.  Ensure all tests pass and type checking is clean.
2.  Push your branch to your fork.
3.  Open a Pull Request against the `main` branch of the original repository.
4.  Provide a clear description of your changes and reference any related issues.

## Reporting Bugs

Please use the [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md) to report bugs. Be sure to include:
- A clear description of the issue.
- Steps to reproduce.
- Expected vs. actual behavior.
- Logs or screenshots if applicable.

## Feature Requests

Have an idea? use the [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md) to suggest new features.

Thank you for contributing!
