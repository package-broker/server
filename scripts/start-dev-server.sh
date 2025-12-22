#!/bin/bash
set -e

# Build UI first
cd packages/ui
npm run build
cd ../..

# Start wrangler dev server
npx wrangler dev --local --port 8787
