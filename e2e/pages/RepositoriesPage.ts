import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class RepositoriesPage extends BasePage {
  readonly url = '/'; // Navigate via dashboard

  // Locators - using accessibility-first selectors
  readonly heading = () => this.getByTestId('repositories-heading');
  readonly addButton = () => this.getByTestId('add-repository-button');
  readonly repositoryList = () => this.page.locator('[data-testid="repository-item"]');

  // Assertions
  async expectRepositoriesVisible(): Promise<void> {
    await expect(this.heading()).toBeVisible();
  }
}
