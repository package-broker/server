#!/bin/sh
set -e

# Fail fast if ENCRYPTION_KEY is not set
if [ -z "$ENCRYPTION_KEY" ]; then
  echo "ERROR: ENCRYPTION_KEY environment variable is required"
  echo "Generate one with: openssl rand -base64 32"
  exit 1
fi

# Validate DB_URL stays within /data (prevent path traversal via env var)
DB_PATH="${DB_URL:-/data/db.sqlite}"
REAL_PATH=$(realpath -m "$DB_PATH" 2>/dev/null || echo "$DB_PATH")
case "$REAL_PATH" in
  /data/*) ;;
  *) echo "ERROR: DB_URL must resolve to a path under /data/"; exit 1 ;;
esac

# Auto-run migrations on first start
if [ ! -f "$DB_PATH" ] || [ ! -s "$DB_PATH" ]; then
  echo "Initializing database at $DB_PATH..."
  mkdir -p "$(dirname "$DB_PATH")"
  node packages/adapter-node/scripts/migrate.cjs "$DB_PATH"
  echo "Database initialized successfully"
else
  echo "Running pending migrations..."
  node packages/adapter-node/scripts/migrate.cjs "$DB_PATH"
fi

exec "$@"
