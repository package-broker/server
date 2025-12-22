import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class TokensPage extends BasePage {
  readonly url = '/'; // Navigate via dashboard

  // Locators - using accessibility-first selectors
  readonly heading = () => this.getByTestId('tokens-heading');
  readonly addButton = () => this.getByTestId('generate-token-button');
  readonly tokenList = () => this.page.locator('[data-testid="token-item"]');

  // Assertions
  async expectTokensVisible(): Promise<void> {
    await expect(this.heading()).toBeVisible();
  }
}
