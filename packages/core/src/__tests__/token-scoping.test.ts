import { describe, it, expect } from 'vitest';
import { TokenScopeService } from '../services/TokenScopeService';
import { matchesPackageFilter } from '../utils/package-filter';

describe('matchesPackageFilter', () => {
  it('should match exact package name', () => {
    expect(matchesPackageFilter('vendor/pkg', 'vendor/pkg')).toBe(true);
    expect(matchesPackageFilter('vendor/pkg', 'vendor/other')).toBe(false);
  });

  it('should match vendor/* glob pattern', () => {
    expect(matchesPackageFilter('vendor/pkg-a', 'vendor/*')).toBe(true);
    expect(matchesPackageFilter('vendor/pkg-b', 'vendor/*')).toBe(true);
    expect(matchesPackageFilter('other/pkg', 'vendor/*')).toBe(false);
  });

  it('should match comma-separated patterns', () => {
    expect(matchesPackageFilter('vendor/pkg', 'vendor/*, other/pkg')).toBe(true);
    expect(matchesPackageFilter('other/pkg', 'vendor/*, other/pkg')).toBe(true);
    expect(matchesPackageFilter('unknown/pkg', 'vendor/*, other/pkg')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(matchesPackageFilter('Vendor/Pkg', 'vendor/*')).toBe(true);
    expect(matchesPackageFilter('vendor/pkg', 'Vendor/*')).toBe(true);
  });
});

describe('TokenScopeService', () => {
  it('should allow all packages when token has no scopes (legacy)', () => {
    const service = new TokenScopeService([]);
    expect(service.canAccessPackage('vendor/pkg')).toBe(true);
    expect(service.canAccessPackageFromRepo('vendor/pkg', 'repo-123')).toBe(true);
  });

  it('should filter packages by pattern scope', () => {
    const service = new TokenScopeService([
      { scope_type: 'package_pattern', scope_value: 'fastwhitecat/*' },
    ]);
    expect(service.canAccessPackage('fastwhitecat/module-a')).toBe(true);
    expect(service.canAccessPackage('other/module-b')).toBe(false);
  });

  it('should filter packages by repository scope', () => {
    const service = new TokenScopeService([
      { scope_type: 'repository', scope_value: 'repo-abc123' },
    ]);
    expect(service.canAccessPackageFromRepo('vendor/pkg', 'repo-abc123')).toBe(true);
    expect(service.canAccessPackageFromRepo('vendor/pkg', 'repo-other')).toBe(false);
  });

  it('should allow access when either repo or pattern matches', () => {
    const service = new TokenScopeService([
      { scope_type: 'repository', scope_value: 'repo-1' },
      { scope_type: 'package_pattern', scope_value: 'vendor/*' },
    ]);
    // Matches via repo scope
    expect(service.canAccessPackageFromRepo('unknown/pkg', 'repo-1')).toBe(true);
    // Matches via pattern scope
    expect(service.canAccessPackageFromRepo('vendor/pkg', 'repo-other')).toBe(true);
    // Matches neither
    expect(service.canAccessPackageFromRepo('unknown/pkg', 'repo-other')).toBe(false);
  });

  it('should return null for authorized repo IDs when unscoped', () => {
    const service = new TokenScopeService([]);
    expect(service.getAuthorizedRepoIds()).toBeNull();
  });

  it('should return authorized repo IDs when scoped', () => {
    const service = new TokenScopeService([
      { scope_type: 'repository', scope_value: 'repo-1' },
      { scope_type: 'repository', scope_value: 'repo-2' },
      { scope_type: 'package_pattern', scope_value: 'vendor/*' },
    ]);
    expect(service.getAuthorizedRepoIds()).toEqual(['repo-1', 'repo-2']);
  });

  it('should deny canAccessPackage when only repo scopes exist (no patterns)', () => {
    const service = new TokenScopeService([
      { scope_type: 'repository', scope_value: 'repo-1' },
    ]);
    // canAccessPackage only checks pattern scopes, not repo scopes
    expect(service.canAccessPackage('vendor/pkg')).toBe(false);
  });

  it('should return null for package patterns when unscoped', () => {
    const service = new TokenScopeService([]);
    expect(service.getPackagePatterns()).toBeNull();
  });

  it('should return package patterns when scoped', () => {
    const service = new TokenScopeService([
      { scope_type: 'package_pattern', scope_value: 'vendor/*' },
      { scope_type: 'package_pattern', scope_value: 'other/specific-pkg' },
    ]);
    expect(service.getPackagePatterns()).toEqual(['vendor/*', 'other/specific-pkg']);
  });
});
