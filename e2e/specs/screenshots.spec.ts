import { test } from '../fixtures/test.fixture';
import { join } from 'path';

test.describe('Documentation Screenshots', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('@mocked should capture application screenshots', async ({
        loginPage,
        dashboardPage,
        packagesPage,
        apiMocker,
        page
    }) => {
        // 1. Mock API
        await apiMocker.mockAll();

        // 2. Login Page
        await loginPage.goto();
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: 'docs/img/login-view.png' });

        // 3. Login
        await loginPage.loginAsAdmin();
        await page.waitForLoadState('networkidle');

        // 4. Dashboard Page
        await dashboardPage.expectDashboardVisible();
        await page.waitForTimeout(500); // Wait for animations
        await page.screenshot({ path: 'docs/img/dashboard-view.png' });

        // 5. Packages Page
        await dashboardPage.navigateToPackages();
        await packagesPage.expectPackagesVisible();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500); // Wait for animations
        await page.screenshot({ path: 'docs/img/packages-view.png' });

        // 6. Tokens Page (optional, but good for completeness)
        await page.goto('/tokens'); // Assuming route is /tokens or navigate via dashboard
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'docs/img/tokens-view.png' });
    });
});
