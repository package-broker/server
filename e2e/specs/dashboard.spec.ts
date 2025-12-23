import { test, expect } from '../fixtures/test.fixture';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ loginPage, dashboardPage, apiMocker, page }) => {
    // apiMocker.mockAll() is already called in the fixture
    await loginPage.goto();
    await page.waitForLoadState('networkidle');
    await loginPage.loginAsAdmin();
    await page.waitForLoadState('networkidle');
    await dashboardPage.expectDashboardVisible();
  });

  test('@all should display dashboard', async ({ dashboardPage }) => {
    await dashboardPage.expectDashboardVisible();
  });

  test('@all should display stats cards', async ({ dashboardPage }) => {
    await dashboardPage.expectStatsCardsVisible();
  });

  test('@all should display Quick Start section', async ({ dashboardPage }) => {
    await dashboardPage.expectQuickStartVisible();
  });

  test('@all should navigate to packages', async ({ dashboardPage, packagesPage }) => {
    await dashboardPage.navigateToPackages();
    await packagesPage.expectPackagesVisible();
  });

  test('@all should navigate to repositories', async ({ dashboardPage, repositoriesPage }) => {
    await dashboardPage.navigateToRepositories();
    await repositoriesPage.expectRepositoriesVisible();
  });

  test('@all should navigate to tokens', async ({ dashboardPage, tokensPage }) => {
    await dashboardPage.navigateToTokens();
    await tokensPage.expectTokensVisible();
  });
});
