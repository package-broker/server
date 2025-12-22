import { defineConfig, devices } from '@playwright/test';

// Optionally load .env.test if dotenv is installed
// Uncomment if you want automatic .env.test loading:
// import dotenv from 'dotenv';
// dotenv.config({ path: '.env.test' });

const baseURL = process.env.TEST_BASE_URL || 'http://localhost:8787';
const isRemote = (baseURL.startsWith('http://') && !baseURL.includes('localhost')) ||
                 baseURL.startsWith('https://');

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['list']],
  timeout: 30 * 1000, // 30 seconds per test
  expect: {
    timeout: 5 * 1000, // 5 seconds for assertions
  },
  globalTimeout: 10 * 60 * 1000, // 10 minutes total for all tests

  use: {
    baseURL: baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10 * 1000, // 10 seconds for actions
    navigationTimeout: 30 * 1000, // 30 seconds for navigation
  },

  projects: [
    // Mocked mode - fast, isolated tests
    {
      name: 'mocked',
      use: {
        ...devices['Desktop Chrome'],
        testMode: 'mocked',
      },
      grep: /@mocked|@all/,
    },
    // Integration mode - real backend tests
    {
      name: 'integration',
      use: {
        ...devices['Desktop Chrome'],
        testMode: 'integration',
      },
      grep: /@integration|@all/,
    },
  ],

  // Web server configuration
  // Skip webServer when:
  // 1. SKIP_WEBSERVER=1 is explicitly set
  // 2. Testing against remote environment (non-localhost URL)
  webServer: process.env.SKIP_WEBSERVER === '1' || isRemote
    ? undefined  // Skip webServer for remote testing or when explicitly skipped
    : {
        command: 'npm run dev',
        url: 'http://localhost:8787/health',
        reuseExistingServer: true,
        timeout: 180 * 1000, // 3 minutes to start
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
