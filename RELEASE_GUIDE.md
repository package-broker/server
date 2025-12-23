# Release Guide

This guide explains the automated release process for PACKAGE.broker using **Conventional Commits** for automatic version calculation.

## Release Strategy

We use **Conventional Commits** with automated versioning:

- ✅ **Automatic version calculation** - Based on commit types (feat = minor, fix = patch, BREAKING = major)
- ✅ **No manual version updates** - Versions are updated automatically when merging to `main`
- ✅ **Git tags for releases** - Immutable, clear history, triggers CI/CD
- ✅ **100% validation** - All checks must pass before any publishing

## Branch Strategy

- **`develop`** - Development branch for community contributions (no builds/images)
- **`main`** - Production branch (triggers releases on merge)

## Conventional Commits

All commits **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Commit Types

- **`feat`** - New feature (minor version bump)
- **`fix`** - Bug fix (patch version bump)
- **`docs`** - Documentation changes (no version bump)
- **`style`** - Code style changes (no version bump)
- **`refactor`** - Code refactoring (no version bump)
- **`perf`** - Performance improvements (patch version bump)
- **`test`** - Test changes (no version bump)
- **`build`** - Build system changes (no version bump)
- **`ci`** - CI/CD changes (no version bump)
- **`chore`** - Other changes (no version bump)
- **`revert`** - Revert a commit (version bump depends on reverted commit)

### Breaking Changes

To trigger a **major version bump**, include `BREAKING CHANGE:` in the commit body or use `!` after the type:

```
feat(api)!: remove deprecated endpoint

BREAKING CHANGE: The /api/v1/endpoint has been removed
```

Or:

```
feat!(api): remove deprecated endpoint
```

### Scopes

Optional, but recommended:
- `shared`, `core`, `ui`, `main`, `cli`, `server` - Package names
- `deps`, `release`, `config` - Other scopes

### Examples

```bash
# Minor version bump (new feature)
git commit -m "feat(core): add package filtering by version"

# Patch version bump (bug fix)
git commit -m "fix(ui): resolve login redirect issue"

# Major version bump (breaking change)
git commit -m "feat(api)!: change authentication method

BREAKING CHANGE: API now requires Bearer token instead of API key"

# No version bump (documentation)
git commit -m "docs: update installation guide"
```

## Automated Release Workflow

### Step 1: Work on `develop` Branch

1. **Create or switch to `develop` branch**:
   ```bash
   git checkout -b develop
   # or
   git checkout develop
   ```

2. **Make your changes and commit**:
   ```bash
   git add .
   git commit -m "feat(core): add new feature"
   git push origin develop
   ```

   **Note**: No builds or images are created on `develop` branch.

### Step 2: Create Pull Request

1. **Create PR from `develop` to `main`**:
   - Go to: https://github.com/package-broker/server/compare/main...develop
   - Click "Create Pull Request"

2. **PR Checks Run Automatically**:
   - ✅ **Validate Commit Messages** - Ensures all commits follow Conventional Commits
   - ✅ **CI Checks** - Lint, typecheck, test, build

3. **If commit validation fails**:
   - Fix commit messages using `git rebase -i` or amend commits
   - Push updated commits to the PR branch

### Step 3: Merge PR to `main`

When you merge the PR to `main`, the **Release on Merge** workflow automatically:

1. **Calculates next version** based on commits:
   - Analyzes all commits since last tag
   - Determines highest version bump needed
   - Example: If PR has `feat:` commits → minor bump

2. **Updates all package.json files** with new version

3. **Commits version updates** to `main`

4. **Creates and pushes tag** (e.g., `v1.2.3`)

5. **Triggers release workflow** which:
   - Validates everything (lint, typecheck, test, build)
   - Publishes NPM packages to GitHub Packages
   - Builds and publishes Docker images to GHCR
   - Creates GitHub Release with notes

### Step 4: Monitor Release

1. Go to: https://github.com/package-broker/server/actions
2. Watch the workflows:
   - **Release on Merge** - Calculates version and creates tag
   - **Release** - Validates, publishes packages and images

### Step 5: Verify Release

After workflows complete successfully:

1. **Check NPM Packages**:
   - Visit: https://github.com/orgs/package-broker/packages
   - Verify all packages are published with the correct version

2. **Check Docker Images**:
   - Visit: https://github.com/orgs/package-broker/packages?container_name=server
   - Verify images are available with the new version tag

3. **Check GitHub Release**:
   - Visit: https://github.com/package-broker/server/releases
   - Verify release notes are generated correctly

## Version Calculation Rules

The version is calculated automatically based on commits since the last tag:

- **Major bump** (1.0.0 → 2.0.0): If any commit has `BREAKING CHANGE:` or `feat!:` or `fix!:` etc.
- **Minor bump** (1.0.0 → 1.1.0): If any commit has type `feat:`
- **Patch bump** (1.0.0 → 1.0.1): If any commit has type `fix:` or `perf:`
- **No bump**: If only `docs:`, `style:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:` commits

**Note**: If no version bump is needed (only non-versioned commits), the release workflow is skipped.

## Manual Release (Alternative)

If you need to create a release manually (e.g., for hotfixes):

1. **Update versions manually** (if needed):
   ```bash
   node scripts/update-versions.js 1.2.3
   git add packages/*/package.json package.json
   git commit -m "chore(release): bump version to 1.2.3"
   git push origin main
   ```

2. **Create and push tag**:
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. **Release workflow triggers automatically**

## Pre-release Checklist

Before merging PR to `main`, ensure:

- [ ] All commits follow Conventional Commits format
- [ ] PR checks pass (commit validation, CI)
- [ ] All tests pass locally (`npm test`)
- [ ] All packages build successfully (`npm run build`)
- [ ] Linting passes (`npm run lint`)
- [ ] Type checking passes (`npm run typecheck`)

## Troubleshooting

### Commit Validation Fails in PR

**Error**: "Some commit messages do not follow Conventional Commits format"

**Solution**:
1. Check which commits failed validation
2. Fix commit messages using interactive rebase:
   ```bash
   git rebase -i HEAD~N  # N = number of commits to fix
   # Change 'pick' to 'reword' for commits to fix
   # Edit commit messages to follow format
   git push --force-with-lease origin your-branch
   ```

### Version Not Bumped After Merge

**Issue**: Merged PR but no release was created

**Possible reasons**:
1. Only non-versioned commits (docs, style, etc.) - This is expected
2. Workflow failed - Check Actions tab for errors
3. No commits since last tag - Version calculation found no changes

**Solution**: Check the "Calculate Next Version" step in the workflow logs

### Docker Build Fails

**Error**: "Dockerfile not found" or Docker build errors

**Solutions**:
1. **Dockerfile Missing**: Create a `Dockerfile` in the repository root
2. Verify Docker build works locally: `docker build -t test .`
3. Check workflow logs for specific error messages

**Note**: If you don't have a Dockerfile yet, you can temporarily disable Docker publishing by removing the `publish-docker` job from `release.yml`.

### Package Already Published

**Error**: "Package already exists"

**Solutions**:
1. The version was already published
2. Check if a previous release used this version
3. The automated workflow should prevent this, but if it happens, bump the version manually

## Workflow Details

### PR Checks Workflow (`pr-checks.yml`)

- **Trigger**: On PR to `main`
- **Validates**: All commit messages follow Conventional Commits
- **Blocks merge**: If validation fails

### Release on Merge Workflow (`release-on-merge.yml`)

- **Trigger**: On push to `main` (after PR merge)
- **Calculates**: Next version from commits
- **Updates**: All package.json files
- **Creates**: Git tag
- **Triggers**: Release workflow

### Release Workflow (`release.yml`)

- **Trigger**: On tag push (e.g., `v1.2.3`)
- **Validates**: Lint, typecheck, test, build, version consistency
- **Publishes**: NPM packages to GitHub Packages
- **Builds**: Docker images and pushes to GHCR
- **Creates**: GitHub Release with notes

## Best Practices

1. **Always use Conventional Commits**: Makes version calculation accurate
2. **Use descriptive commit messages**: Helps with release notes
3. **Test locally before PR**: Run `npm test` and `npm run build`
4. **Review PR checks**: Ensure all validations pass before merging
5. **Monitor workflows**: Watch for any failures after merging

## Security Notes

- All releases are built from the exact code in the tag
- No manual intervention is possible during the release process
- All checks must pass before any publishing occurs
- Docker images are built with BuildKit cache for faster builds
- Images are signed and stored in GitHub Container Registry
