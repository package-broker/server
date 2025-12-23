/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { describe, it, expect, vi } from 'vitest';
import { p2PackageRoute } from '../routes/composer';
import type { Context } from 'hono';

// Mock logger
vi.mock('../utils/logger', () => ({
    getLogger: () => ({
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    }),
}));

// Mock analytics
vi.mock('../utils/analytics', () => ({
    getAnalytics: () => ({
        trackPackageMetadataRequest: vi.fn(),
    }),
}));

// Mock DB - limited since we focus on KV path
vi.mock('../db', () => ({
    createD1Database: () => ({
        select: () => ({
            from: () => ({
                where: () => Promise.resolve([]), // Return empty result
            }),
        }),
    }),
}));

describe('p2PackageRoute', () => {
    it('should handle double-encoded string in KV cache gracefully', async () => {
        // Scenario: KV contains a JSON string that evaluates to a STRING, not an object/array.
        // This causes "foreach() argument must be of type array|object, string given" in Composer.
        const badCacheContent = JSON.stringify("malformed-or-string-content");
        // badCacheContent is "\"malformed-or-string-content\""

        const mockKv = {
            get: vi.fn().mockImplementation(async (key) => {
                if (key.endsWith(':metadata')) return JSON.stringify({ lastModified: Date.now() });
                return badCacheContent;
            }),
            delete: vi.fn().mockResolvedValue(undefined),
        };

        const mockContext = {
            req: {
                param: (key: string) => {
                    if (key === 'vendor') return 'pdepend';
                    if (key === 'package') return 'pdepend~dev.json';
                    return undefined;
                },
                header: () => undefined,
                url: 'http://localhost/p2/pdepend/pdepend~dev.json',
            },
            env: {
                KV: mockKv,
                DB: {},
            },
            executionCtx: {
                waitUntil: vi.fn(),
            },
            get: (key: string) => {
                if (key === 'database') {
                    return {
                        select: vi.fn().mockReturnValue({
                            from: vi.fn().mockReturnValue({
                                where: vi.fn().mockResolvedValue([]),
                            }),
                        }),
                    };
                }
                if (key === 'requestId') return 'req-123';
                return undefined;
            },
            // Ensure c.json is a spy we can check
            json: vi.fn((data, status) => new Response(JSON.stringify(data), { status })),
        } as unknown as Context;

        await p2PackageRoute(mockContext);

        // With the fix, the invalid cache should be ignored (treated as miss) and DELETED.
        expect(mockKv.delete).toHaveBeenCalledWith('p2:pdepend/pdepend~dev');

        // Execution proceeds. Since our mock KV returns garbage for settings too, 
        // mirroringEnabled will likely be false (checks if value === 'true' or null).
        // So it should eventually return 404 via c.json().
        // We check that it did NOT crash and proceeded past cache check.
        expect(mockContext.json).toHaveBeenCalled();
    });
});
