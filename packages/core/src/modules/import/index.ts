/* PACKAGE.broker - Copyright (C) 2025 Łukasz Bajsarowicz - Licensed under AGPL-3.0 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './import.routes';
import * as handlers from './import.handlers';

const importModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

importModule.openapi(routes.importGithubOrgRouteDef, handlers.importGithubOrg as any);

export default importModule;
