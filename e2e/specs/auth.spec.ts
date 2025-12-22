import { test, expect } from '../fixtures/test.fixture';

test.describe('Authentication', () => {
  test.beforeEach(async ({ loginPage, apiMocker, page }) => {
    await apiMocker.mockAuth();
    await loginPage.goto();
    await page.waitForLoadState('networkidle');
  });

  test('@all should display login form', async ({ loginPage }) => {
    await loginPage.expectLoginFormVisible();
  });

  test('@all should login with valid credentials', async ({ loginPage, dashboardPage }) => {
    await loginPage.loginAsAdmin();
    await dashboardPage.expectDashboardVisible();
  });

  test('@all should show error with invalid credentials', async ({ loginPage }) => {
    await loginPage.login('wrong@example.com', 'wrongpass');
    await loginPage.expectErrorMessage('Invalid');
  });

  test('@all should redirect to login when not authenticated', async ({ page, loginPage }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Should show login form
    await loginPage.expectLoginFormVisible();
  });
});
