# Docker Image Testing in CI

## Problem

Previously, our CI pipeline had a critical gap:

1. **Source code was tested** - We ran lint, typecheck, unit tests, and E2E tests on the source code
2. **Docker images were built and published** - But never actually run/tested
3. **Bundling issues went undetected** - Runtime errors in the bundled production code (like "Dynamic require of 'util' is not supported") were only discovered when users tried to run the Docker image locally

## Why This Happened

- The bundled output (what goes into Docker) is different from the source code
- Bundlers (tsup/esbuild) can introduce issues that don't exist in source
- ESM/CommonJS interop issues only appear in the bundled output
- The production bundle wasn't being validated

## Solution

We've added **Docker image smoke tests** to both CI workflows:

### 1. CI Workflow (`ci.yml`)
- Runs on every PR and push to `main`
- Builds the Docker image
- Runs the container and verifies it starts successfully
- Checks for runtime errors in container logs

### 2. Release Workflow (`release.yml`)
- Runs as part of the validation step (before publishing)
- Same smoke test to ensure the release candidate works
- Prevents shipping broken Docker images

## What Gets Tested

The Docker smoke test:
1. ✅ Builds the Docker image using the production Dockerfile
2. ✅ Starts the container with production-like environment variables
3. ✅ Waits for the server to start (checks for "Server listening" log)
4. ✅ Detects fatal errors (SyntaxError, TypeError, "Dynamic require", etc.)
5. ✅ Validates the bundled code actually runs

## Benefits

- **Catches bundling issues early** - Before they reach users
- **Validates production bundle** - Tests what actually gets shipped
- **Fast feedback** - Fails CI if Docker image is broken
- **Prevents regressions** - Ensures Docker images always work

## Example Issues This Catches

- ❌ "Dynamic require of 'util' is not supported" (ESM bundling issues)
- ❌ "SyntaxError: Identifier 'createRequire' has already been declared" (duplicate imports)
- ❌ Missing dependencies in production bundle
- ❌ Runtime errors in bundled code
- ❌ Container startup failures

## Running Locally

You can run the same test locally:

```bash
# Build the image
docker build -f Dockerfile.server -t package-broker-server:test .

# Run the container
docker run -d \
  -p 3000:3000 \
  -e DB_DRIVER=sqlite \
  -e DB_URL="file:/tmp/test.db" \
  -e STORAGE_DRIVER=fs \
  -e STORAGE_FS_PATH="/tmp/storage" \
  -e CACHE_DRIVER=memory \
  -e QUEUE_DRIVER=memory \
  package-broker-server:test

# Check logs
docker logs <container-id>

# Clean up
docker rm -f <container-id>
```

## Future Improvements

- Add health check endpoint and test it
- Test API endpoints (not just startup)
- Test on multiple architectures (amd64, arm64)
- Add performance/load testing
- Test with different environment configurations
