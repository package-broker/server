/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { matchesPackageFilter } from '../utils/package-filter';

export interface TokenScope {
  scope_type: 'repository' | 'package_pattern';
  scope_value: string;
}

export class TokenScopeService {
  private scopes: TokenScope[];
  private isUnscoped: boolean;

  constructor(scopes: TokenScope[]) {
    this.scopes = scopes;
    this.isUnscoped = scopes.length === 0;
  }

  /** Legacy tokens with no scopes can access everything */
  canAccessPackage(packageName: string): boolean {
    if (this.isUnscoped) return true;
    return this.scopes.some(
      (s) => s.scope_type === 'package_pattern' && matchesPackageFilter(packageName, s.scope_value)
    );
  }

  canAccessPackageFromRepo(packageName: string, repoId: string): boolean {
    if (this.isUnscoped) return true;
    const repoMatch = this.scopes.some(
      (s) => s.scope_type === 'repository' && s.scope_value === repoId
    );
    const patternMatch = this.scopes.some(
      (s) => s.scope_type === 'package_pattern' && matchesPackageFilter(packageName, s.scope_value)
    );
    return repoMatch || patternMatch;
  }

  getAuthorizedRepoIds(): string[] | null {
    if (this.isUnscoped) return null; // null = all repos
    return this.scopes
      .filter((s) => s.scope_type === 'repository')
      .map((s) => s.scope_value);
  }

  getPackagePatterns(): string[] | null {
    if (this.isUnscoped) return null;
    return this.scopes
      .filter((s) => s.scope_type === 'package_pattern')
      .map((s) => s.scope_value);
  }
}
