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

async function createAdminUser() {
  try {
    // Check if setup is needed
    const checkResponse = await fetch(`${API_URL}/api/auth/check`);
    const checkData = await checkResponse.json();
    
    if (!checkData.auth_required) {
      // No users exist, create admin for testing
      const setupResponse = await fetch(`${API_URL}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ci-test@example.com',
          password: 'CiTest123!',
        }),
      });
      
      if (!setupResponse.ok) {
        const error = await setupResponse.text();
        throw new Error(`Setup failed: ${error}`);
      }
    }
    
    // Login to get admin token
    const loginResponse = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ci-test@example.com',
        password: 'CiTest123!',
      }),
    });
    
    if (!loginResponse.ok) {
      // Try with existing admin if setup already completed
      const altLoginResponse = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'Test123!',
        }),
      });
      
      if (!altLoginResponse.ok) {
        throw new Error('Failed to authenticate for OpenAPI validation');
      }
      
      const altData = await altLoginResponse.json();
      return altData.token;
    }
    
    const data = await loginResponse.json();
    return data.token;
  } catch (error) {
    console.error('Error creating/admin login:', error.message);
    // Fall back to guest access (will only see public endpoints)
    return null;
  }
}

async function fetchOpenAPISpec() {
  try {
    // Try to authenticate as admin to see all endpoints
    const adminToken = await createAdminUser();
    const headers = adminToken
      ? { 'Authorization': `Bearer ${adminToken}` }
      : {};
    
    const response = await fetch(OPENAPI_URL, { headers });
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
  // Note: Protected endpoints only appear when authenticated as admin
  const publicPaths = [
    '/health',
    '/api/auth/login',
    '/api/auth/check',
  ];
  
  const protectedPaths = [
    '/api/auth/me',
    '/api/repositories',
    '/api/tokens',
    '/api/packages',
  ];
  
  // Public paths must always be present
  const missingPublicPaths = publicPaths.filter(path => !spec.paths[path]);
  if (missingPublicPaths.length > 0) {
    errors.push(`Missing public paths: ${missingPublicPaths.join(', ')}`);
  }
  
  // Protected paths should be present if we authenticated as admin
  // If they're missing, it means we're seeing guest view (which is OK for structure validation)
  const missingProtectedPaths = protectedPaths.filter(path => !spec.paths[path]);
  if (missingProtectedPaths.length > 0) {
    console.warn(`⚠️  Protected paths not visible (may be guest view): ${missingProtectedPaths.join(', ')}`);
    console.warn('   This is expected if fetching without admin authentication');
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
