/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

import type { SyncResult } from '../sync/types';

/**
 * Extended VCS provider interface that adds sync and URL-matching capabilities
 * beyond the base VcsProviderPort.
 */
export interface SyncableVcsProvider {
  readonly name: string;
  matchesUrl(url: string): boolean;
  verifyCredentials(url: string, credentialType: string, credentials: string): Promise<boolean>;
  syncRepository(
    url: string,
    credentials: Record<string, string>,
    credentialType: string,
    composerJsonPath?: string,
  ): Promise<SyncResult>;
}

/**
 * Registry for VCS providers. Resolves the correct provider based on repository URL.
 */
export class VcsProviderRegistry {
  private readonly providers: SyncableVcsProvider[] = [];

  register(provider: SyncableVcsProvider): void {
    // Avoid duplicate registration
    if (this.providers.some((p) => p.name === provider.name)) {
      return;
    }
    this.providers.push(provider);
  }

  /**
   * Find a provider that can handle the given URL.
   */
  resolve(url: string): SyncableVcsProvider | null {
    return this.providers.find((p) => p.matchesUrl(url)) || null;
  }

  /**
   * Get all registered provider names.
   */
  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }
}

/**
 * Singleton registry instance used across the application.
 */
let registryInstance: VcsProviderRegistry | null = null;

export function getVcsProviderRegistry(): VcsProviderRegistry {
  if (!registryInstance) {
    registryInstance = new VcsProviderRegistry();
  }
  return registryInstance;
}

/**
 * Reset the registry (for testing).
 */
export function resetVcsProviderRegistry(): void {
  registryInstance = null;
}
