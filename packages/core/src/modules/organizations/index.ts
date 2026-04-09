/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings, AppVariables } from '../../factory';
import * as routes from './organizations.routes';
import * as handlers from './organizations.handlers';

const organizationsModule = new OpenAPIHono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Organization CRUD
organizationsModule.openapi(routes.listOrganizationsRouteDef, handlers.listOrganizations as any);
organizationsModule.openapi(routes.createOrganizationRouteDef, handlers.createOrganization as any);
organizationsModule.openapi(routes.getOrganizationRouteDef, handlers.getOrganization as any);
organizationsModule.openapi(routes.updateOrganizationRouteDef, handlers.updateOrganization as any);
organizationsModule.openapi(routes.deleteOrganizationRouteDef, handlers.deleteOrganization as any);

// Organization members
organizationsModule.openapi(routes.listMembersRouteDef, handlers.listMembers as any);
organizationsModule.openapi(routes.addMemberRouteDef, handlers.addMember as any);
organizationsModule.openapi(routes.updateMemberRouteDef, handlers.updateMember as any);
organizationsModule.openapi(routes.removeMemberRouteDef, handlers.removeMember as any);

export default organizationsModule;
