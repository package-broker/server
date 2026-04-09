/* PACKAGE.broker - Copyright (C) 2025 Łukasz Bajsarowicz - Licensed under AGPL-3.0 */

import type { RouteHandler } from '@hono/zod-openapi';
import { GitHubOrgImporter } from '../../services/GitHubOrgImporter';
import type { importGithubOrgRouteDef } from './import.routes';

export const importGithubOrg: RouteHandler<typeof importGithubOrgRouteDef> = async (c) => {
  const body = c.req.valid('json');
  const importer = new GitHubOrgImporter(body.github_org, body.auth_token);
  const result = await importer.discover({
    dryRun: body.dry_run,
    filter: body.package_filter,
  });

  // Return 502 when GitHub API completely failed (errors present, no packages found)
  if (result.errors.length > 0 && result.packages.length === 0) {
    return c.json({ error: 'Bad Gateway', message: result.errors.join('; ') }, 502);
  }

  return c.json(result, 200);
};
