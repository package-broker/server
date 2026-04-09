import { describe, expect, it } from 'vitest';
import { packages } from '../db/schema';

describe('packages schema uniqueness', () => {
  it('includes repo_id in the package version unique constraint', () => {
    const extraConfigSymbol = Object.getOwnPropertySymbols(packages).find(
      (symbol) => String(symbol) === 'Symbol(drizzle:ExtraConfigBuilder)'
    );

    expect(extraConfigSymbol).toBeDefined();

    const extraConfigBuilder = (
      packages as unknown as Record<symbol, (table: typeof packages) => unknown>
    )[extraConfigSymbol as symbol];

    expect(extraConfigBuilder).toBeTypeOf('function');

    const extraConfig = extraConfigBuilder(packages) as Record<
      string,
      { name?: string; columns?: Array<{ name: string }> }
    >;

    const uniqueConstraint = extraConfig.uniqueRepoPackageVersionIdx;

    expect(uniqueConstraint).toBeDefined();
    expect(uniqueConstraint.name).toBe('packages_repo_name_version_unique');
    expect(uniqueConstraint.columns?.map((column) => column.name)).toEqual([
      'repo_id',
      'name',
      'version',
    ]);
  });
});
