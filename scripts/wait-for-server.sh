#!/bin/bash
set -e

MAX_ATTEMPTS=60
ATTEMPT=0
URL="http://localhost:8787/health"

echo "Waiting for server to be ready at $URL..."

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  if curl -s -f "$URL" > /dev/null 2>&1; then
    echo "Server is ready!"
    exit 0
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done

echo "Server failed to start after $MAX_ATTEMPTS attempts"
exit 1
