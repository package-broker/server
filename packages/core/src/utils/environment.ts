/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 */

/**
 * Environment detection utilities
 * Used to determine if we're running in Cloudflare Workers or Node.js
 */

/**
 * Check if we're running in Cloudflare Workers environment
 * Cloudflare Workers don't have Node.js process object
 */
export function isCloudflareWorkers(): boolean {
  // In Cloudflare Workers, process is undefined or doesn't have versions.node
  return typeof process === 'undefined' || !process.versions?.node;
}

/**
 * Check if SSH key support is available
 * SSH requires child_process which is only available in Node.js
 */
export function isSshSupported(): boolean {
  if (isCloudflareWorkers()) {
    return false;
  }

  // In Node.js, process.versions.node exists and child_process is available
  // We can't actually import child_process here (would break Workers bundle), 
  // so we check for Node.js environment indicators
  try {
    return typeof process !== 'undefined' && 
           typeof process.versions !== 'undefined' && 
           typeof process.versions.node !== 'undefined';
  } catch {
    return false;
  }
}

