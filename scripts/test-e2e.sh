#!/bin/bash
set -e

echo "🧹 Cleaning up any existing servers..."
pkill -f "wrangler dev" || true
sleep 2

echo "🧪 Running E2E tests in mocked mode..."
npm run test:e2e:mocked -- --timeout=30000 --max-failures=3
