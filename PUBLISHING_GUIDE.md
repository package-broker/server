# Publishing Setup Guide

> **📖 For release instructions, see [RELEASE_GUIDE.md](./RELEASE_GUIDE.md)**

This guide provides technical details about the publishing setup for **GitHub Packages** (`npm.pkg.github.com`) under the `@package-broker` scope.

## 1. Prerequisites

### GitHub Repository Configuration

1. **Go to Repository Settings**:
   - Navigate to `https://github.com/package-broker/server`
   - Click **Settings** > **Actions** > **General**

2. **Workflow Permissions**:
   - Scroll down to **Workflow permissions**
   - Select **Read and write permissions**
   - Click **Save**
   - *Reason: This allows the `GITHUB_TOKEN` to push packages and create GitHub Releases.*

## 2. Package Configuration

All packages are configured with the correct scope and publish config:

* **Scope:** All package names use `@package-broker/`:
  - `@package-broker/shared`
  - `@package-broker/core`
  - `@package-broker/ui`
  - `@package-broker/main`
  - `@package-broker/cli`
  - `@package-broker/node-server`

* **Publish Config:** Each `package.json` includes:
  ```json
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
  ```

## 3. Workflow Configuration

The release workflow (`.github/workflows/release.yml`) handles all publishing automatically:

* **Trigger**: Pushes to tags matching `v*.*.*` (e.g., `v1.0.0`)
* **Authentication**: Uses `GITHUB_TOKEN` automatically (no secrets needed)
* **Process**:
  1. Validates code (lint, typecheck, test, build)
  2. Publishes NPM packages to GitHub Packages
  3. Builds and publishes Docker images to GHCR
  4. Creates GitHub Release

## 4. How Publishing Works

When you create a release tag:

1. **Validation runs first** - All checks must pass:
   - Lint all code
   - Typecheck all packages
   - Build all packages
   - Run all unit tests
   - Verify version consistency

2. **Publishing happens only if validation passes**:
   - All NPM packages are published to GitHub Packages
   - Docker images are built and pushed to GHCR
   - GitHub Release is created with notes

3. **If anything fails**:
   - Nothing is published
   - You can fix issues and retry

## 5. Troubleshooting

### GitHub Packages Authentication Fails

**Error**: `npm ERR! code E401` when publishing to GitHub Packages

**Solutions**:
1. Verify workflow has `packages: write` permission
2. Check repository settings > Actions > General > Workflow permissions
3. Ensure `GITHUB_TOKEN` is available (automatically provided by GitHub Actions)

### Package Already Exists

**Error**: `npm ERR! code E403` - Package already exists

**Solutions**:
1. Bump version number in all `package.json` files
2. Ensure tag version matches package version (without 'v' prefix)
3. Check existing packages at: https://github.com/orgs/package-broker/packages

### Version Mismatch Error

**Error**: Version mismatch between tag and package.json files

**Solutions**:
1. Ensure all `package.json` files have the same version
2. Tag version must match package version (e.g., tag `v1.0.0` → packages `1.0.0`)
3. Update all packages before creating the tag

## 6. Security Notes

- **Automatic Authentication**: Uses `GITHUB_TOKEN` - no manual token management needed
- **Repository-Scoped**: Publishing is tied to the specific repository
- **Audit Trail**: All publishes are logged in GitHub Packages
- **Immutable Releases**: Once published, packages cannot be modified (must bump version)

## 7. Viewing Published Packages

After a successful release:

- **GitHub Packages**: https://github.com/orgs/package-broker/packages
- **Docker Images**: https://github.com/orgs/package-broker/packages?container_name=server
- **Releases**: https://github.com/package-broker/server/releases

## 8. References

- [GitHub Packages Documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
- [GitHub Actions Workflows](https://docs.github.com/en/actions/using-workflows)
- [Release Guide](./RELEASE_GUIDE.md) - Step-by-step release instructions
