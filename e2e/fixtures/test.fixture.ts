import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { PackagesPage } from '../pages/PackagesPage';
import { RepositoriesPage } from '../pages/RepositoriesPage';
import { TokensPage } from '../pages/TokensPage';
import { ApiMocker } from '../support/api-mocker';

// Extend test options
type TestMode = 'mocked' | 'integration';

interface TestOptions {
  testMode: TestMode;
}

interface TestFixtures {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  packagesPage: PackagesPage;
  repositoriesPage: RepositoriesPage;
  tokensPage: TokensPage;
  apiMocker: ApiMocker;
  isMocked: boolean;
  isIntegration: boolean;
}

export const test = base.extend<TestFixtures & TestOptions>({
  // Default test mode from project config
  testMode: [
    (async ({ }, use, testInfo) => {
      const mode = (testInfo.project?.use as any)?.testMode || 'mocked';
      console.log(`TestFixture: Resolved testMode using testInfo: ${mode}`);
      await use(mode as TestMode);
    },
      { option: true }),
  ],

  // Mode helpers
  isMocked: async ({ testMode }, use) => {
    await use(testMode === 'mocked');
  },
  isIntegration: async ({ testMode }, use) => {
    await use(testMode === 'integration');
  },

  // API Mocker (only active in mocked mode)
  apiMocker: async ({ page, testMode }, use) => {
    console.log(`TestFixture: Initializing ApiMocker with testMode=${testMode}`);
    const mocker = new ApiMocker(page, testMode === 'mocked');
    await use(mocker);
  },

  // Page Objects
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  packagesPage: async ({ page }, use) => {
    await use(new PackagesPage(page));
  },
  repositoriesPage: async ({ page }, use) => {
    await use(new RepositoriesPage(page));
  },
  tokensPage: async ({ page }, use) => {
    await use(new TokensPage(page));
  },
});

export { expect };
