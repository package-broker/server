import { test, expect } from '../fixtures/test.fixture';

test.describe('Packages Page', () => {
  test.beforeEach(async ({ loginPage, dashboardPage, packagesPage, apiMocker, page }) => {
    await apiMocker.mockAll();
    await loginPage.goto();
    await page.waitForLoadState('networkidle');
    await loginPage.loginAsAdmin();
    await page.waitForLoadState('networkidle');
    await dashboardPage.expectDashboardVisible();
    await dashboardPage.navigateToPackages();
    await page.waitForLoadState('networkidle');
    await packagesPage.expectPackagesVisible();
  });

  test('@all should display packages list', async ({ packagesPage }) => {
    await packagesPage.expectPackageCount(2); // 2 unique package names
  });

  test('@all should search packages', async ({ packagesPage }) => {
    await packagesPage.search('amasty');
    await packagesPage.expectPackageCount(1);
  });

  test('@all should expand package to show versions', async ({ packagesPage }) => {
    await packagesPage.expandPackage('amasty/base');
    await packagesPage.expectVersionCount(5); // Default limit
  });

  test('@all should display only 5 latest versions by default', async ({ packagesPage }) => {
    await packagesPage.search('amasty/base');
    await packagesPage.expandPackage('amasty/base');
    await packagesPage.expectVersionCount(5);
    await packagesPage.expectShowAllVisible();
  });

  test('@all should show all versions when clicking Show All', async ({ packagesPage }) => {
    await packagesPage.search('amasty/base');
    await packagesPage.expandPackage('amasty/base');
    await packagesPage.showAllVersions();
    await packagesPage.expectVersionCount(30);
  });

  test('@all should sort versions by semantic version (highest first)', async ({ packagesPage }) => {
    await packagesPage.search('amasty/base');
    await packagesPage.expandPackage('amasty/base');
    await packagesPage.expectVersionsSortedDescending();
  });

  test('@all should hide Show All button when <= 5 versions', async ({ packagesPage }) => {
    await packagesPage.search('vendor/single');
    await packagesPage.expandPackage('vendor/single');
    await packagesPage.expectVersionCount(1);
    await packagesPage.expectShowAllHidden();
  });

  // Mocked-only tests (fast, isolated)
  test('@mocked should handle download success', async ({ packagesPage, apiMocker, page }) => {
    await apiMocker.mockDownloadSuccess();
    await packagesPage.search('amasty/base');
    await packagesPage.expandPackage('amasty/base');
    // Get the first displayed version
    const versions = await packagesPage.getDisplayedVersions();
    if (versions.length > 0) {
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
      await packagesPage.downloadVersion(versions[0]);
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
    }
  });

  test('@mocked should handle download failure gracefully', async ({ packagesPage, apiMocker }) => {
    await apiMocker.mockDownloadFailure(500);
    await packagesPage.expandPackage('amasty/base');
    // Error handling would be tested here
  });

  // Integration-only tests (requires real backend)
  test('@integration should download and mirror artifact', async ({ packagesPage, isIntegration, page }) => {
    test.skip(!isIntegration, 'Requires real backend');

    await packagesPage.expandPackage('amasty/base');
    const versions = await packagesPage.getDisplayedVersions();
    if (versions.length > 0) {
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      await packagesPage.downloadVersion(versions[0]);
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
    }
  });
});
