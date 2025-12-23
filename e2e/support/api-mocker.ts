import { Page } from '@playwright/test';
import { mockPackages, mockStats, mockRepositories, mockTokens } from '../fixtures/test-data';
import { testConfig } from '../config/test-config';

export class ApiMocker {
  constructor(
    private readonly page: Page,
    private readonly active: boolean
  ) { }

  async mockAll(): Promise<void> {
    if (!this.active) return;

    await this.mockAuth();
    await this.mockStats();
    await this.mockPackages();
    await this.mockRepositories();
    await this.mockTokens();
  }

  async mockAuth(): Promise<void> {
    if (!this.active) return;

    await this.page.route('**/api/auth/check', (route) =>
      route.fulfill({ json: { authRequired: true } })
    );

    await this.page.route('**/api/auth/login', async (route) => {
      const body = await route.request().postDataJSON();
      if (body?.email === testConfig.credentials.email &&
        body?.password === testConfig.credentials.password) {
        await route.fulfill({ json: { token: 'mock-token-123' } });
      } else {
        await route.fulfill({ status: 401, json: { message: 'Invalid credentials' } });
      }
    });

    await this.page.route('**/api/auth/me', (route) => {
      route.fulfill({
        json: {
          user: {
            id: 'test-admin-id',
            email: testConfig.credentials.email,
            role: 'admin',
            status: 'active',
            created_at: Date.now()
          }
        }
      });
    });
  }

  async mockStats(stats = mockStats): Promise<void> {
    if (!this.active) return;

    await this.page.route(/\/api\/stats$/, (route) => {
      route.fulfill({ json: stats });
    });
  }

  async mockPackages(packages = mockPackages): Promise<void> {
    if (!this.active) return;

    await this.page.route(/\/api\/packages/, (route) => route.fulfill({ json: packages }));
  }

  async mockRepositories(repos = mockRepositories): Promise<void> {
    if (!this.active) return;

    await this.page.route(/\/api\/repositories/, (route) => route.fulfill({ json: repos }));
  }

  async mockTokens(tokens = mockTokens): Promise<void> {
    if (!this.active) return;

    await this.page.route('**/api/tokens*', (route) => route.fulfill({ json: tokens }));
  }

  async mockDownloadSuccess(): Promise<void> {
    if (!this.active) return;

    await this.page.route('**/dist/**', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
        body: Buffer.from('mock-zip-content'),
      })
    );
  }

  async mockDownloadFailure(status = 500): Promise<void> {
    await this.page.route('**/dist/**', (route) =>
      route.fulfill({ status, json: { error: 'Download failed' } })
    );
  }
}
