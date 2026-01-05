/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { createRoute, z } from '@hono/zod-openapi';
import {
    loginRequestSchema,
    loginResponseSchema,
    userResponseSchema,
    errorResponseSchema,
} from '@package-broker/shared';

// Route paths are relative to module mount at /api/auth
export const loginRouteDef = createRoute({
    method: 'post',
    path: '/login',
    summary: 'Authenticate user',
    description: 'Authenticate admin user and return session token',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: loginRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: loginResponseSchema,
                },
            },
            description: 'Login successful',
        },
        400: {
            content: {
                'application/json': {
                    schema: errorResponseSchema,
                },
            },
            description: 'Invalid request',
        },
        401: {
            content: {
                'application/json': {
                    schema: errorResponseSchema,
                },
            },
            description: 'Invalid credentials',
        },
        403: {
            content: {
                'application/json': {
                    schema: errorResponseSchema.extend({
                        code: z.string(),
                    }),
                },
            },
            description: '2FA required',
        },
    },
    tags: ['Authentication'],
});

export const logoutRouteDef = createRoute({
    method: 'post',
    path: '/logout',
    summary: 'Logout user',
    description: 'Invalidate session token',
    security: [{ Bearer: [] }],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        message: z.string(),
                    }),
                },
            },
            description: 'Logged out successfully',
        },
    },
    tags: ['Authentication'],
});

export const meRouteDef = createRoute({
    method: 'get',
    path: '/me',
    summary: 'Get current user',
    description: 'Get current authenticated user information',
    security: [{ Bearer: [] }],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        user: userResponseSchema,
                    }),
                },
            },
            description: 'User information',
        },
        401: {
            content: {
                'application/json': {
                    schema: errorResponseSchema,
                },
            },
            description: 'Not authenticated',
        },
        404: {
            content: {
                'application/json': {
                    schema: errorResponseSchema,
                },
            },
            description: 'User not found',
        },
    },
    tags: ['Authentication'],
});

export const checkAuthRequiredRouteDef = createRoute({
    method: 'get',
    path: '/check',
    summary: 'Check if authentication is required',
    description: 'Check if the instance requires authentication or initial setup',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        authRequired: z.boolean().openapi({
                            description: 'True if users exist (login required)',
                        }),
                        setupRequired: z.boolean().openapi({
                            description: 'True if no users exist (initial setup needed)',
                        }),
                    }),
                },
            },
            description: 'Authentication and setup requirement status',
        },
    },
    tags: ['Authentication'],
});
