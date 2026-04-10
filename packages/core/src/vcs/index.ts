/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

export { GitHubProvider } from './github-provider';
export { GitLabProvider } from './gitlab-provider';
export { BitbucketProvider } from './bitbucket-provider';
export {
  VcsProviderRegistry,
  getVcsProviderRegistry,
  resetVcsProviderRegistry,
  type SyncableVcsProvider,
} from './registry';

import { getVcsProviderRegistry } from './registry';
import { GitHubProvider } from './github-provider';
import { GitLabProvider } from './gitlab-provider';
import { BitbucketProvider } from './bitbucket-provider';

/**
 * Initialize the VCS provider registry with all built-in providers.
 * Call this once during application startup.
 */
export function registerBuiltinVcsProviders(): void {
  const registry = getVcsProviderRegistry();
  registry.register(new GitHubProvider());
  registry.register(new GitLabProvider());
  registry.register(new BitbucketProvider());
}
