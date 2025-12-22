import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createJobProcessor } from '../jobs/processor';
import { syncRepository } from '../sync/repository-sync';
import { createDatabase } from '../db';
import { repositories, tokens, artifacts } from '../db/schema';

vi.mock('../sync/repository-sync');
vi.mock('../db');
vi.mock('../utils/logger', () => ({
    getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

describe('Job Processor', () => {
    const mockEnv = {
        DB: {} as any,
        KV: {} as any,
        ENCRYPTION_KEY: 'key',
    };

    const mockDb = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        limit: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (createDatabase as any).mockReturnValue(mockDb);
    });

    describe('Factory', () => {
        it('should create QueueJobProcessor when queue is available', () => {
            const queueEnv = {
                ...mockEnv,
                QUEUE: { send: vi.fn() } as any,
            };
            const processor = createJobProcessor(queueEnv);
            expect(processor.constructor.name).toBe('QueueJobProcessor');
        });

        it('should create SyncJobProcessor when queue is missing', () => {
            const processor = createJobProcessor(mockEnv);
            expect(processor.constructor.name).toBe('SyncJobProcessor');
        });
    });

    describe('QueueJobProcessor', () => {
        it('should send job to queue', async () => {
            const sendMock = vi.fn();
            const queueEnv = { ...mockEnv, QUEUE: { send: sendMock } as any };
            const processor = createJobProcessor(queueEnv);

            await processor.enqueue({ type: 'sync_repository', repoId: '123' });
            expect(sendMock).toHaveBeenCalledWith({ type: 'sync_repository', repoId: '123' });
        });
    });

    describe('SyncJobProcessor', () => {
        it('should process update_token_last_used', async () => {
            const processor = createJobProcessor(mockEnv);
            const timestamp = 1234567890;
            await processor.enqueue({ type: 'update_token_last_used', tokenId: 'token1', timestamp });

            expect(mockDb.update).toHaveBeenCalledWith(tokens);
            expect(mockDb.set).toHaveBeenCalledWith({ last_used_at: timestamp });
        });

        it('should process update_artifact_download', async () => {
            const processor = createJobProcessor(mockEnv);
            mockDb.limit.mockResolvedValueOnce([{ id: 'art1', download_count: 5 }]);

            await processor.enqueue({
                type: 'update_artifact_download',
                artifactId: 'art1',
                timestamp: 1234567890,
            });

            expect(mockDb.update).toHaveBeenCalledWith(artifacts);
            expect(mockDb.set).toHaveBeenCalledWith({
                download_count: 6,
                last_downloaded_at: 1234567890,
            });
        });

        it('should process sync_repository', async () => {
            const syncOptions = { storage: {} as any, proxyBaseUrl: 'url' };
            const processor = createJobProcessor(mockEnv, { syncOptions });

            (syncRepository as any).mockResolvedValue({ success: true, packages: [] });

            await processor.enqueue({ type: 'sync_repository', repoId: 'repo1' });

            expect(syncRepository).toHaveBeenCalledWith(
                'repo1',
                expect.objectContaining({ DB: mockEnv.DB }),
                syncOptions
            );
        });

        it('should skip sync_repository if options missing', async () => {
            const processor = createJobProcessor(mockEnv); // No syncOptions
            await processor.enqueue({ type: 'sync_repository', repoId: 'repo1' });
            expect(syncRepository).not.toHaveBeenCalled();
        });
    });
});
