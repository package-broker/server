import { test, expect } from '../fixtures/test.fixture';

test.describe('Repositories Page', () => {
  test.beforeEach(async ({ loginPage, dashboardPage, repositoriesPage, apiMocker, page }) => {
    await apiMocker.mockAll();
    await loginPage.goto();
    await page.waitForLoadState('networkidle');
    await loginPage.loginAsAdmin();
    await page.waitForLoadState('networkidle');
    await dashboardPage.expectDashboardVisible();
    await dashboardPage.navigateToRepositories();
    await page.waitForLoadState('networkidle');
    await repositoriesPage.expectRepositoriesVisible();
  });

  test('@all should display repositories page', async ({ repositoriesPage }) => {
    await repositoriesPage.expectRepositoriesVisible();
  });
});
