import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadFromSource } from '../utils/download';

describe('Download Utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should download successfully', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            body: 'mock-body',
        } as any);

        const response = await downloadFromSource('https://example.com/foo.zip', 'none', {});
        expect(response.ok).toBe(true);
        expect(fetch).toHaveBeenCalledWith('https://example.com/foo.zip', expect.objectContaining({
            headers: expect.objectContaining({
                'Accept': 'application/zip, application/octet-stream, */*',
            }),
        }));
    });

    it('should retry on failure', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
            } as any);

        global.fetch = fetchMock;

        await downloadFromSource('https://example.com/retry.zip', 'none', {});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should throw on 404', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        } as any);

        await expect(downloadFromSource('https://example.com/404.zip', 'none', {}))
            .rejects.toThrow('Failed to download artifact: HTTP 404');
    });

    it('should throw authentication error on 401', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
        } as any);

        await expect(downloadFromSource('https://example.com/401.zip', 'none', {}))
            .rejects.toThrow('Authentication failed');
    });
});
