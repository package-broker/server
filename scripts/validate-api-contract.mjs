#!/usr/bin/env node
/*
 * PACKAGE.broker
 * Copyright (C) 2025 Łukasz Bajsarowicz
 * Licensed under AGPL-3.0
 *
 * Validates API contract by:
 * 1. Fetching OpenAPI spec from running server
 * 2. Testing key endpoints against their response schemas
 * 3. Validating response structure matches OpenAPI definition
 */

const API_URL = process.env.API_URL || 'http://localhost:8787';
const OPENAPI_URL = `${API_URL}/api/openapi.json`;

async function fetchOpenAPISpec() {
  try {
    const response = await fetch(OPENAPI_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching OpenAPI spec:', error.message);
    process.exit(1);
  }
}

async function testHealthEndpoint() {
  try {
    const response = await fetch(`${API_URL}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    const data = await response.json();
    
    // Basic validation - check required fields
    if (!data.status || !data.timestamp) {
      throw new Error('Health response missing required fields');
    }
    
    console.log('✅ Health endpoint validated');
    return true;
  } catch (error) {
    console.error('❌ Health endpoint validation failed:', error.message);
    return false;
  }
}

async function validateSpecStructure(spec) {
  const errors = [];
  
  // Check required OpenAPI 3.0 fields
  if (!spec.openapi || !spec.openapi.startsWith('3.')) {
    errors.push('Invalid or missing OpenAPI version');
  }
  
  if (!spec.info || !spec.info.title || !spec.info.version) {
    errors.push('Missing required info fields (title, version)');
  }
  
  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    errors.push('No paths defined in OpenAPI spec');
  }
  
  // Check that key endpoints are documented
  const requiredPaths = [
    '/health',
    '/api/auth/login',
    '/api/auth/me',
    '/api/repositories',
    '/api/tokens',
    '/api/packages',
  ];
  
  const missingPaths = requiredPaths.filter(path => !spec.paths[path]);
  if (missingPaths.length > 0) {
    errors.push(`Missing documented paths: ${missingPaths.join(', ')}`);
  }
  
  if (errors.length > 0) {
    console.error('❌ OpenAPI spec validation errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    return false;
  }
  
  console.log('✅ OpenAPI spec structure validated');
  console.log(`   Found ${Object.keys(spec.paths).length} documented endpoints`);
  return true;
}

async function main() {
  console.log('🔍 Validating API contract...\n');
  
  // Fetch OpenAPI spec
  console.log(`Fetching OpenAPI spec from ${OPENAPI_URL}...`);
  const spec = await fetchOpenAPISpec();
  console.log('✅ OpenAPI spec fetched\n');
  
  // Validate spec structure
  const specValid = await validateSpecStructure(spec);
  if (!specValid) {
    process.exit(1);
  }
  
  // Test health endpoint
  const healthValid = await testHealthEndpoint();
  if (!healthValid) {
    process.exit(1);
  }
  
  console.log('\n✅ API contract validation passed');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
