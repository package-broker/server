import { test, expect } from '../fixtures/test.fixture';

test.describe('Tokens Page', () => {
  test.beforeEach(async ({ loginPage, dashboardPage, tokensPage, apiMocker, page }) => {
    await apiMocker.mockAll();
    await loginPage.goto();
    await page.waitForLoadState('networkidle');
    await loginPage.loginAsAdmin();
    await page.waitForLoadState('networkidle');
    await dashboardPage.expectDashboardVisible();
    await dashboardPage.navigateToTokens();
    await page.waitForLoadState('networkidle');
    await tokensPage.expectTokensVisible();
  });

  test('@all should display tokens page', async ({ tokensPage }) => {
    await tokensPage.expectTokensVisible();
  });
});
