/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { describe, it, expect } from 'vitest';
import { matchesPackageFilter } from '../utils/repository-filter';

describe('matchesPackageFilter', () => {
  it('should return true when filter is null', () => {
    expect(matchesPackageFilter(null, 'vendor/package')).toBe(true);
  });

  it('should return true when filter is empty string', () => {
    expect(matchesPackageFilter('', 'vendor/package')).toBe(true);
  });

  it('should return true when filter is only whitespace/commas', () => {
    expect(matchesPackageFilter(' , , ', 'vendor/package')).toBe(true);
  });

  it('should match exact package name', () => {
    expect(matchesPackageFilter('vendor/package', 'vendor/package')).toBe(true);
  });

  it('should not match different package name', () => {
    expect(matchesPackageFilter('vendor/package', 'vendor/other')).toBe(false);
  });

  it('should match wildcard vendor/*', () => {
    expect(matchesPackageFilter('vendor/*', 'vendor/package')).toBe(true);
    expect(matchesPackageFilter('vendor/*', 'vendor/other')).toBe(true);
  });

  it('should not match wildcard for different vendor', () => {
    expect(matchesPackageFilter('vendor/*', 'other/package')).toBe(false);
  });

  it('should match prefix wildcard', () => {
    expect(matchesPackageFilter('mirasvit*', 'mirasvit-module')).toBe(true);
    expect(matchesPackageFilter('mirasvit*', 'mirasvit/foo')).toBe(true);
  });

  it('should not match prefix wildcard for non-matching prefix', () => {
    expect(matchesPackageFilter('mirasvit*', 'amasty/foo')).toBe(false);
  });

  it('should match multiple patterns (comma-separated)', () => {
    expect(matchesPackageFilter('vendor/a, other/*', 'vendor/a')).toBe(true);
    expect(matchesPackageFilter('vendor/a, other/*', 'other/b')).toBe(true);
    expect(matchesPackageFilter('vendor/a, other/*', 'unrelated/x')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(matchesPackageFilter('Vendor/*', 'vendor/package')).toBe(true);
    expect(matchesPackageFilter('vendor/*', 'Vendor/Package')).toBe(true);
  });

  it('should handle whitespace in patterns', () => {
    expect(matchesPackageFilter('  vendor/a , other/*  ', 'vendor/a')).toBe(true);
  });
});
