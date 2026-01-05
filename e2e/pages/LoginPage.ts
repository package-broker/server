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
  
  /**
   * Fill and submit login form without waiting for navigation.
   * Use this for testing error scenarios where login stays on the form.
   */
  async submitLogin(email: string, password: string): Promise<void> {
    await this.emailInput().waitFor({ state: 'visible' });
    await this.emailInput().fill(email);
    await this.passwordInput().fill(password);
    await this.submitButton().click();
  }

  /**
   * Fill, submit login form and wait for successful navigation (form disappears).
   * Use this for successful login scenarios.
   */
  async login(email: string, password: string): Promise<void> {
    await this.submitLogin(email, password);
    // Wait for login form to disappear (navigation may go to different URLs with deep linking)
    await this.loginForm().waitFor({ state: 'hidden', timeout: 10000 });
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
