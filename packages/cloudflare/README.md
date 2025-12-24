# @package-broker/cloudflare

Interactive CLI tool for deploying PACKAGE.broker to Cloudflare Workers with one command.

## Installation

```bash
npm install @package-broker/cloudflare @package-broker/main
```

## Usage

```bash
npx package-broker-cloudflare init
```

The CLI will:
- Prompt for tier selection (free/paid)
- Prompt for worker name
- Generate encryption key
- Create Cloudflare resources (D1, KV, R2, Queue if paid)
- Set encryption key as Cloudflare secret
- Generate `wrangler.toml` with all IDs populated
- Copy migration files
- Optionally deploy the Worker

## Features

- **Interactive setup**: Guided prompts for configuration
- **Idempotent**: Safe to re-run if resources already exist
- **Automatic resource creation**: D1, KV, R2, and Queue (paid tier)
- **Secret management**: Encryption key set as Cloudflare secret (not in wrangler.toml)
- **Migration handling**: Automatically copies and applies migrations
- **Tier-aware**: Different configuration for free vs paid tiers

## Requirements

- Node.js 18+
- Cloudflare account
- Authenticated with `wrangler login` or `CLOUDFLARE_API_TOKEN` environment variable

## See Also

- [Quickstart Guide](../../../docs/docs/getting-started/quickstart-cloudflare.md)
- [GitHub Template Repository](https://github.com/package-broker/cloudflare-template) (alternative deployment method)

