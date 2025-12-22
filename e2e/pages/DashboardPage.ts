import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
  readonly url = '/';

  // Locators - using accessibility-first selectors
  readonly heading = () => this.getByTestId('dashboard-heading');
  readonly statsCardsContainer = () => this.getByTestId('stats-cards');
  readonly statCard = (title: string) => this.getByTestId(`stat-card-${title.toLowerCase().replace(/\s+/g, '-')}`);
  readonly quickStartSection = () => this.getByTestId('quick-start-section');
  readonly composerCliCommand = () => this.getByTestId('composer-cli-command');
  readonly composerJsonCode = () => this.getByTestId('composer-json-code');

  // Navigation - using data-testid
  readonly navRepositories = () => this.getByTestId('nav-repositories');
  readonly navPackages = () => this.getByTestId('nav-packages');
  readonly navTokens = () => this.getByTestId('nav-tokens');
  readonly navDashboard = () => this.getByTestId('nav-dashboard');

  // Actions
  async navigateToRepositories(): Promise<void> {
    await this.navRepositories().click();
    await this.page.waitForURL('**/repositories');
  }

  async navigateToPackages(): Promise<void> {
    await this.navPackages().click();
    await this.page.waitForURL('**/packages');
  }

  async navigateToTokens(): Promise<void> {
    await this.navTokens().click();
    await this.page.waitForURL('**/tokens');
  }

  // Assertions
  async expectDashboardVisible(): Promise<void> {
    await expect(this.heading()).toBeVisible();
  }

  async expectStatsCardsVisible(): Promise<void> {
    await expect(this.statsCardsContainer()).toBeVisible();
    await expect(this.statCard('active-repositories')).toBeVisible();
    await expect(this.statCard('cached-packages')).toBeVisible();
    await expect(this.statCard('total-downloads')).toBeVisible();
  }

  async expectQuickStartVisible(): Promise<void> {
    await expect(this.quickStartSection()).toBeVisible();
    await expect(this.composerCliCommand()).toBeVisible();
    await expect(this.composerJsonCode()).toBeVisible();
  }
}
