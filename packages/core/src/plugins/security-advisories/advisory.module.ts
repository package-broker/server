/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { listAdvisoriesRoute, checkPackageRoute } from './advisory.routes';
import { listAdvisories, checkPackageAdvisories } from './advisory.handlers';

const securityModule = new OpenAPIHono();

securityModule.openapi(listAdvisoriesRoute, listAdvisories as any);
securityModule.openapi(checkPackageRoute, checkPackageAdvisories as any);

export default securityModule;
