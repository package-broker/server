/**
 * Centralized test configuration
 * All test credentials and URLs should come from environment variables
 */

export const testConfig = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:8787',
  credentials: {
    email: process.env.TEST_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.TEST_ADMIN_PASSWORD || 'Password123!',
  },
  timeout: {
    test: 30000,
    navigation: 30000,
    action: 10000,
  },
  isRemote: () => {
    const url = testConfig.baseUrl;
    // Remote if it's not localhost (simpler check)
    return !url.includes('localhost');
  },
};
