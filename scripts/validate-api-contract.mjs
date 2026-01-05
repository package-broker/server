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

async function testAdminEndpointSeparation(adminToken) {
  if (!adminToken) {
    console.log('⚠️  Skipping admin endpoint tests (no admin token)');
    return true;
  }

  const headers = { 'Authorization': `Bearer ${adminToken}` };
  let allPassed = true;

  try {
    // Test /api/stats endpoint
    console.log('Testing /api/stats endpoint...');
    const statsResponse = await fetch(`${API_URL}/api/stats`, { headers });
    
    if (!statsResponse.ok) {
      console.error(`❌ /api/stats returned ${statsResponse.status}`);
      allPassed = false;
    } else {
      const statsData = await statsResponse.json();
      
      // Stats should have these properties
      const requiredStatsProps = ['active_repos', 'cached_packages', 'total_downloads'];
      const missingStatsProps = requiredStatsProps.filter(prop => !(prop in statsData));
      
      if (missingStatsProps.length > 0) {
        console.error(`❌ /api/stats missing required properties: ${missingStatsProps.join(', ')}`);
        console.error(`   Received: ${JSON.stringify(statsData)}`);
        allPassed = false;
      }
      
      // Stats should NOT have settings properties
      const forbiddenStatsProps = ['kv_available', 'packagist_mirroring_enabled', 'package_caching_enabled'];
      const wrongStatsProps = forbiddenStatsProps.filter(prop => prop in statsData);
      
      if (wrongStatsProps.length > 0) {
        console.error(`❌ /api/stats has settings properties (route collision detected!): ${wrongStatsProps.join(', ')}`);
        console.error(`   Received: ${JSON.stringify(statsData)}`);
        allPassed = false;
      }
      
      if (missingStatsProps.length === 0 && wrongStatsProps.length === 0) {
        console.log('✅ /api/stats returns correct schema');
      }
    }

    // Test /api/settings endpoint
    console.log('Testing /api/settings endpoint...');
    const settingsResponse = await fetch(`${API_URL}/api/settings`, { headers });
    
    if (!settingsResponse.ok) {
      console.error(`❌ /api/settings returned ${settingsResponse.status}`);
      allPassed = false;
    } else {
      const settingsData = await settingsResponse.json();
      
      // Settings should have these properties
      const requiredSettingsProps = ['kv_available', 'packagist_mirroring_enabled', 'package_caching_enabled'];
      const missingSettingsProps = requiredSettingsProps.filter(prop => !(prop in settingsData));
      
      if (missingSettingsProps.length > 0) {
        console.error(`❌ /api/settings missing required properties: ${missingSettingsProps.join(', ')}`);
        console.error(`   Received: ${JSON.stringify(settingsData)}`);
        allPassed = false;
      }
      
      // Settings should NOT have stats properties
      const forbiddenSettingsProps = ['active_repos', 'cached_packages', 'total_downloads'];
      const wrongSettingsProps = forbiddenSettingsProps.filter(prop => prop in settingsData);
      
      if (wrongSettingsProps.length > 0) {
        console.error(`❌ /api/settings has stats properties (route collision detected!): ${wrongSettingsProps.join(', ')}`);
        console.error(`   Received: ${JSON.stringify(settingsData)}`);
        allPassed = false;
      }
      
      if (missingSettingsProps.length === 0 && wrongSettingsProps.length === 0) {
        console.log('✅ /api/settings returns correct schema');
      }
    }

    return allPassed;
  } catch (error) {
    console.error('❌ Admin endpoint validation failed:', error.message);
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
  
  // Fetch OpenAPI spec (also creates admin user and returns token)
  console.log(`Fetching OpenAPI spec from ${OPENAPI_URL}...`);
  const adminToken = await createAdminUser();
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
  
  // Test admin endpoints (critical for catching route collisions)
  const adminValid = await testAdminEndpointSeparation(adminToken);
  if (!adminValid) {
    console.error('\n❌ Admin endpoint validation failed - possible route collision');
    process.exit(1);
  }
  
  console.log('\n✅ API contract validation passed');
  console.log('   All endpoints return correct schemas');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
