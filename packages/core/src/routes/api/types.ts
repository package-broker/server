/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { Context } from 'hono';

/**
 * Helper type for OpenAPI route handlers
 * When a route is registered with app.openapi(), c.req.valid() becomes available
 * This type assertion allows TypeScript to recognize it
 */
export type OpenAPIContext<TEnv extends Record<string, any> = any, TJson = any, TParam = Record<string, string>, TQuery = Record<string, string>> = Context<TEnv> & {
  req: Context<TEnv>['req'] & {
    valid: {
      (key: 'json'): TJson;
      (key: 'param'): TParam;
      (key: 'query'): TQuery;
      (key: string): any;
    };
  };
};
