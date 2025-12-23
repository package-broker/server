#!/usr/bin/env node

/**
 * Calculates the next version based on Conventional Commits
 * 
 * Rules:
 * - feat: minor bump
 * - fix: patch bump
 * - BREAKING CHANGE or feat!: major bump
 * - Other types: no bump (unless they have BREAKING CHANGE)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get current version from package.json
function getCurrentVersion() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

// Parse version string to [major, minor, patch]
function parseVersion(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return { major, minor, patch };
}

// Format version array to string
function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

// Get commits since last tag
function getCommitsSinceLastTag() {
  try {
    // Get the last tag
    const lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null || echo ""', {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..')
    }).trim();
    
    if (!lastTag) {
      // No tags yet, get all commits
      return execSync('git log --format=%B', {
        encoding: 'utf8',
        cwd: path.join(__dirname, '..')
      }).split('\n\n').filter(Boolean);
    }
    
    // Get commits since last tag
    return execSync(`git log ${lastTag}..HEAD --format=%B`, {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..')
    }).split('\n\n').filter(Boolean);
  } catch (error) {
    // If no commits, return empty array
    return [];
  }
}

// Parse commit message to determine bump type
function analyzeCommit(commitMessage) {
  const lines = commitMessage.split('\n');
  const header = lines[0];
  
  // Check for BREAKING CHANGE
  const hasBreakingChange = commitMessage.includes('BREAKING CHANGE:') || 
                            commitMessage.includes('BREAKING:') ||
                            header.includes('!');
  
  // Parse type from header (format: type(scope): subject)
  const match = header.match(/^(\w+)(?:\([^)]+\))?(!?):\s*(.+)$/);
  if (!match) {
    return null;
  }
  
  const [, type, breaking, subject] = match;
  
  if (hasBreakingChange || breaking === '!') {
    return 'major';
  }
  
  switch (type.toLowerCase()) {
    case 'feat':
      return 'minor';
    case 'fix':
      return 'patch';
    case 'perf':
      return 'patch';
    default:
      return null; // No version bump for other types
  }
}

// Calculate next version
function calculateNextVersion() {
  const currentVersion = getCurrentVersion();
  const version = parseVersion(currentVersion);
  const commits = getCommitsSinceLastTag();
  
  let bumpType = null;
  
  // Analyze all commits to determine the highest bump needed
  for (const commit of commits) {
    const commitBump = analyzeCommit(commit);
    if (!commitBump) continue;
    
    // Determine highest priority bump
    if (commitBump === 'major' || bumpType === 'major') {
      bumpType = 'major';
    } else if (commitBump === 'minor' || bumpType === 'minor') {
      bumpType = 'minor';
    } else if (commitBump === 'patch') {
      bumpType = bumpType || 'patch';
    }
  }
  
  // If no bump determined, return current version
  if (!bumpType) {
    return currentVersion;
  }
  
  // Apply bump
  if (bumpType === 'major') {
    version.major += 1;
    version.minor = 0;
    version.patch = 0;
  } else if (bumpType === 'minor') {
    version.minor += 1;
    version.patch = 0;
  } else if (bumpType === 'patch') {
    version.patch += 1;
  }
  
  return formatVersion(version);
}

// Main execution
if (require.main === module) {
  try {
    const nextVersion = calculateNextVersion();
    console.log(nextVersion);
  } catch (error) {
    console.error('Error calculating version:', error.message);
    process.exit(1);
  }
}

module.exports = { calculateNextVersion, getCurrentVersion };

