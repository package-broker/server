import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncRepository } from '../sync/repository-sync';
import { createD1Database as createDatabase } from '../db';
import { decryptCredentials } from '../utils/encryption';
import { syncGitHubRepository } from '../sync/github-sync';
import { syncComposerRepository } from '../sync/strategies/composer-repo';

vi.mock('../db');
vi.mock('../utils/encryption');
vi.mock('../sync/github-sync');
vi.mock('../sync/strategies/composer-repo');
vi.mock('../utils/logger', () => ({
    getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../utils/analytics', () => ({
    getAnalytics: () => ({
        trackRepositorySyncStart: vi.fn(),
        trackRepositorySyncSuccess: vi.fn(),
        trackRepositorySyncFailure: vi.fn(),
    }),
}));

describe('Repository Sync', () => {
    const mockEnv = {
        DB: {} as any,
        KV: { delete: vi.fn().mockResolvedValue(undefined) } as any, // Fix: mockResolvedValue needed for .catch()
        ENCRYPTION_KEY: 'test-key',
    };

    const mockOptions = {
        storage: {} as any,
        proxyBaseUrl: 'https://proxy.example.com',
    };

    const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (createDatabase as any).mockReturnValue(mockDb);
    });

    it('should sync GitHub repository successfully', async () => {
        // Mock repo found (first call) and no existing packages (subsequent calls)
        mockDb.limit
            .mockResolvedValueOnce([{
                id: 'repo1',
                vcs_type: 'git',
                url: 'https://github.com/owner/repo',
                auth_credentials: 'encrypted',
                credential_type: 'token',
            }])
            .mockResolvedValue([]); // For storePackages check

        (decryptCredentials as any).mockResolvedValue(JSON.stringify({ token: '123' }));
        (syncGitHubRepository as any).mockResolvedValue({
            success: true,
            packages: [{ name: 'vendor/package', version: '1.0.0' }],
        });

        const result = await syncRepository('repo1', mockEnv, mockOptions);

        expect(result.success).toBe(true);
        expect(result.packages).toHaveLength(1);
        expect(syncGitHubRepository).toHaveBeenCalledWith(
            expect.objectContaining({ owner: 'owner', repo: 'repo' })
        );
        expect(mockDb.update).toHaveBeenCalled(); // Status updates
        expect(mockEnv.KV.delete).toHaveBeenCalled(); // Cache invalidation
    });

    it('should handle repo not found', async () => {
        mockDb.limit.mockResolvedValueOnce([]);

        const result = await syncRepository('missing', mockEnv, mockOptions);

        expect(result.success).toBe(false);
        expect(result.error).toBe('repo_not_found');
    });

    it('should sync Composer repository successfully', async () => {
        mockDb.limit
            .mockResolvedValueOnce([{
                id: 'repo2',
                vcs_type: 'composer',
                url: 'https://repo.packagist.org',
                auth_credentials: 'encrypted',
                credential_type: 'none',
            }])
            .mockResolvedValue([]); // For storePackages check

        (decryptCredentials as any).mockResolvedValue(JSON.stringify({}));
        (syncComposerRepository as any).mockResolvedValue({
            success: true,
            packages: [{ name: 'vendor/pkg', version: '2.0.0' }],
        });

        const result = await syncRepository('repo2', mockEnv, mockOptions);

        expect(result.success).toBe(true);
        expect(syncComposerRepository).toHaveBeenCalledWith(
            'https://repo.packagist.org',
            'none',
            {},
            undefined
        );
    });

    it('should handle sync failure', async () => {
        mockDb.limit.mockResolvedValueOnce([{
            id: 'repo1',
            vcs_type: 'git',
            url: 'https://github.com/owner/fail',
            auth_credentials: 'encrypted',
        }]);

        (decryptCredentials as any).mockResolvedValue('{}');
        (syncGitHubRepository as any).mockResolvedValue({
            success: false,
            error: 'API Error',
        });

        const result = await syncRepository('repo1', mockEnv, mockOptions);

        expect(result.success).toBe(false);
        expect(result.error).toBe('API Error');
        // Verify status updated to error
        expect(mockDb.update).toHaveBeenCalled();
        expect(mockDb.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    });
});
