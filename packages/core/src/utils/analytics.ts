/*
 * Cloudflare Composer Proxy
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * Analytics Engine utility for tracking application events
 * 
 * Provides type-safe event tracking to Cloudflare Analytics Engine.
 * Analytics Engine is optional - all functions are no-ops if binding is unavailable.
 */

export type EventType =
  | 'package_download'
  | 'package_metadata_request'
  | 'repository_sync_start'
  | 'repository_sync_success'
  | 'repository_sync_failure'
  | 'auth_login'
  | 'auth_token_used'
  | 'repository_created'
  | 'repository_updated'
  | 'repository_deleted'
  | 'token_created'
  | 'token_deleted';

export interface AnalyticsEvent {
  eventType: EventType;
  timestamp: number;
  requestId?: string;
  // Event-specific fields
  packageName?: string;
  version?: string;
  repoId?: string;
  size?: number;
  cacheHit?: boolean;
  packageCount?: number;
  strategy?: string;
  error?: string;
  userId?: string;
  tokenId?: string;
}

class Analytics {
  private analytics?: AnalyticsEngineDataset;

  /**
   * Initialize analytics with optional Analytics Engine binding
   */
  init(analytics?: AnalyticsEngineDataset): void {
    this.analytics = analytics;
  }

  /**
   * Write a data point to Analytics Engine
   * No-op if Analytics Engine is not configured
   */
  writeDataPoint(event: AnalyticsEvent): void {
    if (!this.analytics) {
      return; // No-op if Analytics Engine not configured
    }

    try {
      // Map event data to Analytics Engine format
      const blobs: string[] = [event.eventType];
      const doubles: number[] = [event.timestamp];
      const indexes: string[] = [];

      // Add event-specific blobs (strings for filtering/grouping)
      if (event.packageName) blobs.push(event.packageName);
      if (event.version) blobs.push(event.version);
      if (event.repoId) blobs.push(event.repoId);
      if (event.strategy) blobs.push(event.strategy);
      if (event.error) blobs.push(event.error);
      if (event.userId) blobs.push(event.userId);
      if (event.tokenId) blobs.push(event.tokenId);
      if (event.cacheHit !== undefined) blobs.push(event.cacheHit ? 'true' : 'false');

      // Add event-specific doubles (numbers for metrics)
      if (event.size !== undefined) doubles.push(event.size);
      if (event.packageCount !== undefined) doubles.push(event.packageCount);

      // Add request ID as index (for correlation)
      if (event.requestId) indexes.push(event.requestId);

      // Write to Analytics Engine (non-blocking, async)
      this.analytics.writeDataPoint({
        blobs,
        doubles,
        indexes,
      });
    } catch (error) {
      // Silently fail - analytics should never break the application
      // Errors are logged but don't throw
    }
  }

  /**
   * Track package download event
   */
  trackPackageDownload(params: {
    requestId?: string;
    packageName: string;
    version: string;
    repoId: string;
    size?: number;
    cacheHit: boolean;
  }): void {
    this.writeDataPoint({
      eventType: 'package_download',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      packageName: params.packageName,
      version: params.version,
      repoId: params.repoId,
      size: params.size,
      cacheHit: params.cacheHit,
    });
  }

  /**
   * Track package metadata request event
   */
  trackPackageMetadataRequest(params: {
    requestId?: string;
    cacheHit: boolean;
    packageCount?: number;
  }): void {
    this.writeDataPoint({
      eventType: 'package_metadata_request',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      cacheHit: params.cacheHit,
      packageCount: params.packageCount,
    });
  }

  /**
   * Track repository sync start event
   */
  trackRepositorySyncStart(params: {
    requestId?: string;
    repoId: string;
  }): void {
    this.writeDataPoint({
      eventType: 'repository_sync_start',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      repoId: params.repoId,
    });
  }

  /**
   * Track repository sync success event
   */
  trackRepositorySyncSuccess(params: {
    requestId?: string;
    repoId: string;
    packageCount: number;
    strategy: string;
  }): void {
    this.writeDataPoint({
      eventType: 'repository_sync_success',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      repoId: params.repoId,
      packageCount: params.packageCount,
      strategy: params.strategy,
    });
  }

  /**
   * Track repository sync failure event
   */
  trackRepositorySyncFailure(params: {
    requestId?: string;
    repoId: string;
    error: string;
  }): void {
    this.writeDataPoint({
      eventType: 'repository_sync_failure',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      repoId: params.repoId,
      error: params.error,
    });
  }

  /**
   * Track authentication login event
   */
  trackAuthLogin(params: {
    requestId?: string;
    userId: string;
    success: boolean;
  }): void {
    this.writeDataPoint({
      eventType: 'auth_login',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      userId: params.userId,
      error: params.success ? undefined : 'login_failed',
    });
  }

  /**
   * Track token authentication event
   */
  trackAuthTokenUsed(params: {
    requestId?: string;
    tokenId: string;
  }): void {
    this.writeDataPoint({
      eventType: 'auth_token_used',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      tokenId: params.tokenId,
    });
  }

  /**
   * Track repository created event
   */
  trackRepositoryCreated(params: {
    requestId?: string;
    repoId: string;
    userId?: string;
  }): void {
    this.writeDataPoint({
      eventType: 'repository_created',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      repoId: params.repoId,
      userId: params.userId,
    });
  }

  /**
   * Track repository updated event
   */
  trackRepositoryUpdated(params: {
    requestId?: string;
    repoId: string;
    userId?: string;
  }): void {
    this.writeDataPoint({
      eventType: 'repository_updated',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      repoId: params.repoId,
      userId: params.userId,
    });
  }

  /**
   * Track repository deleted event
   */
  trackRepositoryDeleted(params: {
    requestId?: string;
    repoId: string;
    userId?: string;
  }): void {
    this.writeDataPoint({
      eventType: 'repository_deleted',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      repoId: params.repoId,
      userId: params.userId,
    });
  }

  /**
   * Track token created event
   */
  trackTokenCreated(params: {
    requestId?: string;
    tokenId: string;
    userId?: string;
  }): void {
    this.writeDataPoint({
      eventType: 'token_created',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      tokenId: params.tokenId,
      userId: params.userId,
    });
  }

  /**
   * Track token deleted event
   */
  trackTokenDeleted(params: {
    requestId?: string;
    tokenId: string;
    userId?: string;
  }): void {
    this.writeDataPoint({
      eventType: 'token_deleted',
      timestamp: Math.floor(Date.now() / 1000),
      requestId: params.requestId,
      tokenId: params.tokenId,
      userId: params.userId,
    });
  }
}

// Create singleton instance
let analyticsInstance: Analytics | null = null;

/**
 * Get analytics instance
 */
export function getAnalytics(): Analytics {
  if (!analyticsInstance) {
    analyticsInstance = new Analytics();
  }
  return analyticsInstance;
}

/**
 * Initialize analytics with binding (called from worker initialization)
 */
export function initAnalytics(analytics?: AnalyticsEngineDataset): void {
  const instance = getAnalytics();
  instance.init(analytics);
}

