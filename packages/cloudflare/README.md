# @package-broker/cloudflare

CLI tool for deploying PACKAGE.broker to Cloudflare Workers with one command. Supports both interactive and CI/CD modes.

## Installation

```bash
npm install @package-broker/cloudflare @package-broker/main
```

## Usage

### Interactive Mode (Default)

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

### CI/CD Mode

For non-interactive deployment in GitHub Actions or other CI environments:

```bash
npx package-broker-cloudflare deploy --ci --json \
  --worker-name my-worker \
  --tier free \
  --domain app.example.com
```

**Required Environment Variables** (CI mode):
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token with required permissions
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID
- `ENCRYPTION_KEY` - Base64-encoded encryption key

**Optional Environment Variables**:
- `WORKER_NAME` - Worker name (overrides `--worker-name` flag)
- `CLOUDFLARE_TIER` - `free` or `paid` (overrides `--tier` flag)
- `DOMAIN` - Custom domain (overrides `--domain` flag)
- `SKIP_UI_BUILD` - Set to `true` to skip UI build step
- `SKIP_MIGRATIONS` - Set to `true` to skip migration application

**Flags**:
- `--ci` - Enable CI mode (non-interactive, no prompts)
- `--json` - Output JSON result for machine parsing
- `--worker-name <name>` - Worker name
- `--tier <free|paid>` - Cloudflare tier
- `--domain <domain>` - Custom domain (e.g., `app.example.com`)
- `--skip-ui-build` - Skip UI build step
- `--skip-migrations` - Skip migration application

**JSON Output** (when using `--json`):
```json
{
  "worker_url": "https://my-worker.workers.dev",
  "database_id": "abc123...",
  "kv_namespace_id": "def456...",
  "r2_bucket_name": "my-worker-artifacts",
  "queue_name": "my-worker-queue"
}
```

## Features

- **Interactive setup**: Guided prompts for configuration
- **CI/CD mode**: Non-interactive deployment with JSON output for automation
- **Idempotent**: Safe to re-run if resources already exist
- **Automatic resource creation**: D1, KV, R2, and Queue (paid tier)
- **Secret management**: Encryption key set as Cloudflare secret (not in wrangler.toml)
- **Migration handling**: Automatically copies and applies migrations
- **Tier-aware**: Different configuration for free vs paid tiers
- **Wrangler version pinning**: Enforces `wrangler@^4.54.0` as dependency

## Requirements

- Node.js 18+
- Cloudflare account
- Authenticated with `wrangler login` (interactive mode) or `CLOUDFLARE_API_TOKEN` environment variable (CI mode)

## Troubleshooting

### Invalid Routes Error

If you see an error like:
```
[ERROR] Invalid Routes:
  example.com/*:
```

This occurs when using custom domains. The `custom_domain = true` route type requires the pattern **without** the `/*` suffix. If you're using an older version, update to the latest:

```bash
npm update @package-broker/cloudflare
```

### Login Screen Instead of Setup Wizard

On a fresh installation, you should see the Setup wizard (to create the first admin user). If you see the Login screen instead:

1. Check the API response:
   ```bash
   curl -s https://your-domain.com/api/auth/check | jq .
   ```
   
2. Expected response for fresh install:
   ```json
   {"authRequired": false, "setupRequired": true}
   ```

3. If you see `{"auth_required": false}` (snake_case, missing `setupRequired`), you're running an old version. Update packages and redeploy.

### Resources Created But Not Bound

If D1/KV/R2 resources are created but the Worker can't access them:

1. Check the `wrangler.toml` has correct IDs:
   ```bash
   grep -E "database_id|kv_namespaces|r2_buckets" wrangler.toml
   ```

2. Verify bindings in Cloudflare Dashboard: Workers & Pages → Your Worker → Settings → Bindings

3. Redeploy to apply binding changes:
   ```bash
   npx wrangler deploy
   ```

### Local Development Testing

For debugging deployment issues, test locally before pushing to CI:

```bash
# Set credentials
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export ENCRYPTION_KEY="test-encryption-key-32-chars-min"

# Build from source
cd /path/to/package-broker/server
npm run build

# Deploy with local code
node packages/cloudflare/dist/index.js deploy --ci \
  --worker-name test-worker \
  --tier free

# Or use wrangler directly with existing wrangler.toml
npx wrangler deploy
```

This gives immediate feedback without CI delays or NPM publishing.

## See Also

- [Quickstart Guide](../../../docs/docs/getting-started/quickstart-cloudflare.md)
- [GitHub Template Repository](https://github.com/package-broker/cloudflare-template) (alternative deployment method)
- [GitHub Action](https://github.com/package-broker/cloudflare-deploy-action) (uses this CLI in CI mode)


