import { expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { testConfig } from '../config/test-config';

export class LoginPage extends BasePage {
  readonly url = '/';

  // Locators - using accessibility-first selectors
  readonly emailInput = () => this.page.getByLabel('Email', { exact: false });
  readonly passwordInput = () => this.page.getByLabel('Password', { exact: false });
  readonly submitButton = () => this.page.getByRole('button', { name: /sign in/i });
  readonly errorMessage = () => this.page.getByRole('alert');
  readonly loginForm = () => this.getByTestId('login-form');

  // Actions
  async login(email: string, password: string): Promise<void> {
    await this.emailInput().waitFor({ state: 'visible' });
    await this.emailInput().fill(email);
    await this.passwordInput().fill(password);
    await this.submitButton().click();
    // Wait for navigation after login
    await this.page.waitForURL('**/', { timeout: 10000 });
  }

  async loginAsAdmin(): Promise<void> {
    await this.login(testConfig.credentials.email, testConfig.credentials.password);
  }

  // Assertions
  async expectLoginFormVisible(): Promise<void> {
    await expect(this.loginForm()).toBeVisible();
    await expect(this.emailInput()).toBeVisible();
    await expect(this.passwordInput()).toBeVisible();
  }

  async expectErrorMessage(message: string): Promise<void> {
    await expect(this.errorMessage()).toContainText(message);
  }
}
