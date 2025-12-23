# E2E Tests

End-to-end tests for PACKAGE.broker using Playwright.

## Quick Start

### Remote Testing (Recommended)

**Remote testing always means integration testing** (real API calls to deployed backend).

Test against your deployed environment:

```bash
# Set environment variables
export TEST_BASE_URL=https://package-broker.lukasz-bajsarowicz.workers.dev
export TEST_ADMIN_EMAIL=admin@example.com
export TEST_ADMIN_PASSWORD=your-password

# Run integration tests against remote
npm run test:e2e:remote
```

This runs integration tests only - no mocked tests when testing remote deployments.

### Using Environment File

1. Copy the example file:
   ```bash
   cp .env.test.example .env.test
   ```

2. Edit `.env.test` with your credentials:
   ```bash
   TEST_BASE_URL=https://package-broker.lukasz-bajsarowicz.workers.dev
   TEST_ADMIN_EMAIL=admin@example.com
   TEST_ADMIN_PASSWORD=your-secure-password
   ```

3. Load environment and run tests:
   ```bash
   # If using dotenv (optional), uncomment dotenv import in playwright.config.ts
   # Otherwise, export variables manually:
   export $(cat .env.test | xargs)
   npm run test:e2e:remote
   ```

## Test Modes

### Mocked Tests (`@mocked`)
- **Fast, isolated tests** using API mocks
- No backend dependencies
- API calls are intercepted and mocked
- **Use for:** Local UI development, fast iteration, component behavior
- **Note:** Not for remote testing - use integration tests instead

```bash
npm run test:e2e:mocked
```

### Integration Tests (`@integration`)
- **Real backend tests** with actual API calls
- Requires accessible backend (local or remote)
- Tests full E2E workflows, database operations, artifact downloads
- **Use for:** Complete user flows, sync operations, download functionality, remote deployment validation

**Local full stack testing:**
```bash
TEST_BASE_URL=http://localhost:8787 npm run test:e2e:integration
```

**Remote deployment testing:**
```bash
TEST_BASE_URL=https://your-domain.com npm run test:e2e:remote
```

### All Tests (`@all`)
- Tests that run in both mocked and integration modes
- Automatically adapt based on test mode

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TEST_BASE_URL` | No | `http://localhost:8787` | Target URL for tests (local or remote) |
| `TEST_ADMIN_EMAIL` | No | `admin@example.com` | Admin user email for authentication |
| `TEST_ADMIN_PASSWORD` | No | `Password123!` | Admin user password for authentication |
| `SKIP_WEBSERVER` | No | Auto-detected | Set to `1` to skip local server startup |

### Environment Variable Examples

```bash
# Test against production
TEST_BASE_URL=https://package-broker.lukasz-bajsarowicz.workers.dev \
TEST_ADMIN_EMAIL=admin@example.com \
TEST_ADMIN_PASSWORD=SecurePass123 \
npm run test:e2e:remote

# Test against staging
TEST_BASE_URL=https://package-broker-staging.example.com \
TEST_ADMIN_EMAIL=admin@example.com \
TEST_ADMIN_PASSWORD=SecurePass123 \
npm run test:e2e:remote

# Test locally (if webServer is fixed)
TEST_BASE_URL=http://localhost:8787 npm run test:e2e
```

## Available Scripts

| Script | Description | Use Case |
|--------|-------------|----------|
| `npm run test:e2e` | Run all tests (uses TEST_BASE_URL or defaults to localhost) | General testing |
| `npm run test:e2e:mocked` | Run mocked tests only | Local UI development (fast) |
| `npm run test:e2e:integration` | Run integration tests only | Local full stack testing |
| `npm run test:e2e:remote` | Run integration tests against remote (skips webServer) | **Test deployed app** |
| `npm run test:e2e:remote:headed` | Run remote integration tests with browser UI visible | Debug remote issues |
| `npm run test:e2e:ui` | Open Playwright UI for test debugging | Interactive debugging |
| `npm run test:e2e:headed` | Run tests with visible browser | Local debugging |

**Key principle:** Remote testing = Integration testing (always). Mocked tests are for local development only.

## Configuration

### Test Configuration

All test configuration is centralized in [`e2e/config/test-config.ts`](config/test-config.ts):

- Base URL: From `TEST_BASE_URL` environment variable
- Credentials: From `TEST_ADMIN_EMAIL` and `TEST_ADMIN_PASSWORD`
- Timeouts: Configurable per test type

### Playwright Configuration

See [`playwright.config.ts`](../../playwright.config.ts) for:
- Browser settings
- Timeout configuration
- webServer setup (auto-disabled for remote URLs)
- Test projects (mocked vs integration)

## Test Structure

```
e2e/
├── config/
│   └── test-config.ts          # Centralized test configuration
├── fixtures/
│   ├── test-data.ts            # Mock data for tests
│   └── test.fixture.ts         # Playwright test fixtures
├── pages/
│   ├── BasePage.ts             # Base page object class
│   ├── LoginPage.ts            # Login page object
│   ├── DashboardPage.ts        # Dashboard page object
│   ├── PackagesPage.ts         # Packages page object
│   ├── RepositoriesPage.ts     # Repositories page object
│   └── TokensPage.ts           # Tokens page object
├── specs/
│   ├── auth.spec.ts            # Authentication tests
│   ├── dashboard.spec.ts      # Dashboard tests
│   ├── packages.spec.ts       # Packages page tests
│   ├── repositories.spec.ts   # Repositories tests
│   └── tokens.spec.ts         # Tokens tests
├── support/
│   └── api-mocker.ts           # API mocking utilities
└── README.md                   # This file
```

## Timeouts

- **Test timeout:** 30 seconds per test
- **Global timeout:** 10 minutes for all tests
- **Action timeout:** 10 seconds for user actions
- **Navigation timeout:** 30 seconds for page navigation
- **Assertion timeout:** 5 seconds for expect statements

## Troubleshooting

### Server Won't Start (Local Testing)

If the webServer times out:

1. Check if port 8787 is already in use:
   ```bash
   lsof -ti:8787
   ```

2. Kill existing processes:
   ```bash
   pkill -f "wrangler dev"
   ```

3. Use remote testing instead:
   ```bash
   TEST_BASE_URL=https://your-domain.com npm run test:e2e:remote
   ```

### Tests Fail with Authentication Errors

1. Verify credentials are correct:
   ```bash
   echo $TEST_ADMIN_EMAIL
   echo $TEST_ADMIN_PASSWORD
   ```

2. Check that credentials match your deployment:
   - For remote: Check environment variables in Cloudflare Workers dashboard
   - For local: Check `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`

3. Test authentication manually:
   ```bash
   curl -X POST https://your-domain.com/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@example.com","password":"your-password"}'
   ```

### Tests Are Flaky

- Ensure server is fully started before running tests
- Check network connectivity to remote environment
- Verify test data matches current UI state
- Increase timeouts if needed (edit `test-config.ts`)

### Remote Environment Not Accessible

1. Verify the URL is correct:
   ```bash
   curl -I https://your-domain.com/health
   ```

2. Check CORS settings if testing from different origin

3. Verify authentication is configured correctly

## Best Practices

1. **Use environment variables** - Never hardcode credentials or URLs
2. **Test against remote** - More reliable than local webServer setup (uses integration tests)
3. **Use mocked tests locally** - For fast UI iteration during development
4. **Use integration tests** - For validating complete workflows and remote deployments
5. **Remote = Integration** - When testing remote, always use integration tests (real API calls)
6. **Document bugs** - Add issues to `/BUGS.md` instead of fixing during test work

## Page Object Model

All page interactions use the Page Object Model pattern:
- Locators use accessibility-first selectors (`data-testid`, `aria-*`, `getByRole`)
- No CSS class selectors or visual style selectors
- Reusable page objects for maintainability

See individual page files in `e2e/pages/` for examples.
