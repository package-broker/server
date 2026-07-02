/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revalidateStalePackage } from '../routes/package-revalidation';

vi.mock('../utils/logger', () => ({
    getLogger: () => ({
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    }),
}));

describe('revalidateStalePackage', () => {
    const packageName = 'magento/product-community-edition';
    const repoRow = { id: 'repo-1', url: 'https://repo.example.com', vcs_type: 'composer' };
    const upstreamData = { packages: { [packageName]: [{ version: '2.4.7-p10' }] } };

    let mockDb: any;
    let mockCache: {
        get: ReturnType<typeof vi.fn>;
        put: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
    };
    let loadPackageFromRepo: ReturnType<typeof vi.fn>;
    let storePackages: ReturnType<typeof vi.fn>;

    const runRevalidation = (overrides: Partial<Parameters<typeof revalidateStalePackage>[0]> = {}) =>
        revalidateStalePackage({
            db: mockDb,
            cache: mockCache as any,
            packageName,
            repoIds: ['repo-1'],
            encryptionKey: 'key',
            proxyBaseUrl: 'https://broker.example.com',
            loadPackageFromRepo: loadPackageFromRepo as any,
            storePackages: storePackages as any,
            ...overrides,
        });

    beforeEach(() => {
        mockDb = {
            select: vi.fn().mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([repoRow]),
                }),
            }),
        };
        mockCache = {
            get: vi.fn().mockResolvedValue(null),
            put: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
        };
        loadPackageFromRepo = vi.fn().mockResolvedValue(upstreamData);
        storePackages = vi.fn().mockResolvedValue({ transformed: {}, storedCount: 1, errors: [] });
    });

    it('refreshes changed metadata from the original repo and purges the cached response', async () => {
        await runRevalidation();

        expect(loadPackageFromRepo).toHaveBeenCalledWith(repoRow, packageName, 'key');
        expect(storePackages).toHaveBeenCalledWith(
            upstreamData,
            'repo-1',
            'https://broker.example.com',
            mockDb
        );
        expect(mockCache.delete).toHaveBeenCalledWith(`p2:${packageName}`);
        expect(mockCache.delete).toHaveBeenCalledWith(`p2:${packageName}:metadata`);
    });

    it('records a content hash so unchanged upstream data is not re-stored', async () => {
        await runRevalidation();

        const hashKey = `p2:${packageName}:repo-1:content-hash`;
        const [key, storedHash] = mockCache.put.mock.calls[0];
        expect(key).toBe(hashKey);

        // Second cycle: upstream returns identical content, hash matches
        mockCache.get.mockResolvedValue(storedHash);
        storePackages.mockClear();
        mockCache.delete.mockClear();

        await runRevalidation();

        expect(storePackages).not.toHaveBeenCalled();
        expect(mockCache.delete).not.toHaveBeenCalled();
    });

    it('does not store or purge when upstream has no data', async () => {
        loadPackageFromRepo.mockResolvedValue(null);

        await runRevalidation();

        expect(storePackages).not.toHaveBeenCalled();
        expect(mockCache.put).not.toHaveBeenCalled();
        expect(mockCache.delete).not.toHaveBeenCalled();
    });

    it('dedupes concurrent revalidations of the same package', async () => {
        let release!: () => void;
        loadPackageFromRepo.mockImplementation(
            () => new Promise((resolve) => {
                release = () => resolve(null);
            })
        );

        const first = runRevalidation();
        const second = runRevalidation();
        await second; // returns immediately - already in flight

        expect(loadPackageFromRepo).toHaveBeenCalledTimes(1);
        release();
        await first;

        // After completion the package can be revalidated again
        loadPackageFromRepo.mockResolvedValue(null);
        await runRevalidation();
        expect(loadPackageFromRepo).toHaveBeenCalledTimes(2);
    });

    it('only contacts the repos the stored rows came from', async () => {
        const whereMock = vi.fn().mockResolvedValue([repoRow]);
        mockDb.select = vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({ where: whereMock }),
        });

        await runRevalidation({ repoIds: ['repo-1'] });

        // The repos query is scoped to the given ids, not the full table
        expect(whereMock).toHaveBeenCalled();
        expect(loadPackageFromRepo).toHaveBeenCalledTimes(1);
        expect(loadPackageFromRepo).toHaveBeenCalledWith(repoRow, packageName, 'key');
    });
});
