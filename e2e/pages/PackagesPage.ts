import { expect, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class PackagesPage extends BasePage {
  readonly url = '/'; // Navigate via dashboard

  // Locators - using accessibility-first selectors
  readonly heading = () => this.getByTestId('packages-heading');
  readonly searchInput = () => this.getByTestId('package-search-input');
  readonly packageCards = () => this.getByTestId('package-card');
  readonly loadingSpinner = () => this.getByTestId('packages-loading');
  readonly emptyState = () => this.getByTestId('packages-empty');
  readonly packagesList = () => this.getByTestId('packages-list');

  packageCard(name: string): Locator {
    return this.page.locator('[data-testid="package-card"][data-package-name="' + name + '"]');
  }

  versionRows(): Locator {
    return this.getByTestId('version-row');
  }

  versionRow(version: string): Locator {
    return this.page.locator('[data-testid="version-row"][data-version="' + version + '"]');
  }

  showAllButton(): Locator {
    return this.getByTestId('show-all-versions-button');
  }

  downloadButton(version: string): Locator {
    return this.versionRow(version).getByTestId('download-button');
  }

  // Actions
  async search(query: string): Promise<void> {
    await this.searchInput().fill(query);
    await this.page.waitForTimeout(300); // Debounce
  }

  async expandPackage(name: string): Promise<void> {
    const card = this.packageCard(name);
    await card.waitFor({ state: 'visible' });

    // Toggle only if not already expanded
    const header = card.getByTestId('package-header').first();
    await header.waitFor({ state: 'visible' });

    const isExpanded = await header.getAttribute('aria-expanded') === 'true';

    if (!isExpanded) {
      await card.getByTestId('package-expand-toggle').first().click({ force: true });
      await expect(header).toHaveAttribute('aria-expanded', 'true');
    }

    // Wait for at least one version row to be visible
    await this.versionRows().first().waitFor({ state: 'visible' });
  }

  async showAllVersions(): Promise<void> {
    await this.showAllButton().click();
  }

  async downloadVersion(version: string): Promise<void> {
    const button = this.downloadButton(version);
    await button.waitFor({ state: 'visible' });
    await button.click();
  }

  async getDisplayedVersions(): Promise<string[]> {
    const rows = await this.versionRows().all();
    const versions: string[] = [];
    for (const row of rows) {
      // Get the version text from the first span (version number)
      const versionText = await row.locator('span').first().textContent();
      if (versionText) {
        const match = versionText.match(/(\d+\.\d+\.\d+)/);
        if (match) {
          versions.push(match[1]);
        }
      }
    }
    return versions;
  }

  // Assertions
  async expectPackagesVisible(): Promise<void> {
    await expect(this.heading()).toBeVisible();
  }

  async expectPackageCount(count: number): Promise<void> {
    await expect(this.packageCards()).toHaveCount(count);
  }

  async expectVersionCount(count: number): Promise<void> {
    await expect(this.versionRows()).toHaveCount(count);
  }

  async expectShowAllVisible(): Promise<void> {
    await expect(this.showAllButton()).toBeVisible();
  }

  async expectShowAllHidden(): Promise<void> {
    await expect(this.showAllButton()).not.toBeVisible();
  }

  async expectVersionsSortedDescending(): Promise<void> {
    const versions = await this.getDisplayedVersions();
    const sorted = [...versions].sort((a, b) => {
      // Simple semver comparison
      const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
      const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
      return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
    });
    expect(versions).toEqual(sorted);
  }
}
