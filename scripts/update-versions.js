#!/usr/bin/env node

/**
 * Updates version in all package.json files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

/**
 * Get all workspace package names from packages/ directory.
 */
function getWorkspacePackageNames() {
  const names = new Set();
  const packages = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(packagesDir, dirent.name, 'package.json'));

  for (const pkgPath of packages) {
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) names.add(pkg.name);
    }
  }

  // Include root package
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (rootPkg.name) names.add(rootPkg.name);

  return names;
}

/**
 * Update a dependency map, replacing workspace package references with the new version.
 */
function updateWorkspaceDeps(deps, workspaceNames, newVersion) {
  if (!deps) return false;
  let changed = false;
  for (const [name, range] of Object.entries(deps)) {
    if (workspaceNames.has(name)) {
      const newRange = `^${newVersion}`;
      if (deps[name] !== newRange) {
        deps[name] = newRange;
        changed = true;
      }
    }
  }
  return changed;
}

function updatePackageVersion(packagePath, newVersion, workspaceNames) {
  const packageJsonPath = path.join(packagePath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const oldVersion = packageJson.version;
  packageJson.version = newVersion;

  // Also update workspace cross-references in dependencies
  updateWorkspaceDeps(packageJson.dependencies, workspaceNames, newVersion);
  updateWorkspaceDeps(packageJson.devDependencies, workspaceNames, newVersion);
  updateWorkspaceDeps(packageJson.peerDependencies, workspaceNames, newVersion);

  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf8'
  );

  console.log(`Updated ${path.relative(rootDir, packageJsonPath)}: ${oldVersion} -> ${newVersion}`);
  return true;
}

function updateAllVersions(newVersion) {
  console.log(`Updating all package versions to ${newVersion}...\n`);

  // Collect workspace package names first (before modifying files)
  const workspaceNames = getWorkspacePackageNames();
  console.log(`Found ${workspaceNames.size} workspace packages: ${[...workspaceNames].join(', ')}\n`);

  // Update root package.json
  updatePackageVersion(rootDir, newVersion, workspaceNames);

  // Update all package.json files in packages/
  const packages = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(packagesDir, dirent.name));

  let updatedCount = 0;
  for (const packagePath of packages) {
    if (updatePackageVersion(packagePath, newVersion, workspaceNames)) {
      updatedCount++;
    }
  }

  console.log(`\nUpdated ${updatedCount + 1} package.json files (versions + workspace deps)`);
}

// Main execution
if (require.main === module) {
  const newVersion = process.argv[2];
  
  if (!newVersion) {
    console.error('Usage: node update-versions.js <version>');
    console.error('Example: node update-versions.js 1.2.3');
    process.exit(1);
  }
  
  // Validate version format
  if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
    console.error(`Invalid version format: ${newVersion}`);
    console.error('Version must be in format: MAJOR.MINOR.PATCH (e.g., 1.2.3)');
    process.exit(1);
  }
  
  try {
    updateAllVersions(newVersion);
  } catch (error) {
    console.error('Error updating versions:', error.message);
    process.exit(1);
  }
}

module.exports = { updateAllVersions };

