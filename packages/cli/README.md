# Package Broker CLI

CLI tool to initialize Package Broker configuration in your project.

## Usage

```bash
npm install @package-broker/cli @package-broker/main
npx package-broker init
```

This command will:
- Copy `wrangler.toml` configuration template to your project
- Copy database migrations to `migrations/` directory
- Display next steps for setting up Cloudflare resources

## What's Next?

After running the init command, follow the displayed instructions to:

1. Configure your worker name and encryption key in `wrangler.toml`
2. Login to Cloudflare with `wrangler login`
3. Create required Cloudflare resources (D1, KV, R2)
4. Apply database migrations
5. Deploy your worker

## Documentation

For full documentation, visit: https://github.com/package-broker/server
