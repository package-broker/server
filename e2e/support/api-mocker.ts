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
    await this.mockSettings();
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

    await this.page.route('**/api/stats', (route) => {
      route.fulfill({ json: stats });
    });
  }

  async mockPackages(packages = mockPackages): Promise<void> {
    if (!this.active) return;

    await this.page.route('**/api/packages*', (route) => {
      const url = new URL(route.request().url());
      const search = url.searchParams.get('search');
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);

      let filtered = packages;
      if (search) {
        filtered = packages.filter((p) => p.name.includes(search));
      }

      // Get unique package names for pagination
      const uniqueNames = [...new Set(filtered.map(p => p.name))];
      const total = uniqueNames.length;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;
      const paginatedNames = uniqueNames.slice(offset, offset + limit);

      // Get all versions for paginated package names
      const data = filtered.filter(p => paginatedNames.includes(p.name));

      route.fulfill({
        json: {
          data,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
      });
    });
  }

  async mockRepositories(repos = mockRepositories): Promise<void> {
    if (!this.active) return;

    await this.page.route('**/api/repositories*', (route) => route.fulfill({ json: repos }));
  }

  async mockTokens(tokens = mockTokens): Promise<void> {
    if (!this.active) return;

    await this.page.route('**/api/tokens*', (route) => route.fulfill({ json: tokens }));
  }

  async mockSettings(settings = { kv_available: true, packagist_mirroring_enabled: false }): Promise<void> {
    if (!this.active) return;

    await this.page.route('**/api/settings', (route) => route.fulfill({ json: settings }));
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
