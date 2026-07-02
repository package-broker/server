#!/usr/bin/env node
import { mkdtemp, readFile, writeFile, rm, access, stat, mkdir } from 'node:fs/promises';
import { constants as fsConstants, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const brokerUrl = process.argv[2]?.replace(/\/$/, '');

if (!brokerUrl || brokerUrl === '--help' || brokerUrl === '-h') {
  console.error('Usage: scripts/real-source-e2e.mjs <broker-url>');
  process.exit(brokerUrl ? 0 : 2);
}

const adminEmail = process.env.REAL_SOURCE_E2E_ADMIN_EMAIL || 'real-source-e2e@example.test';
const adminPassword = process.env.REAL_SOURCE_E2E_ADMIN_PASSWORD || 'real-source-e2e-password';
const expectDevVersionFix = /^1|true|yes$/i.test(process.env.EXPECT_DEV_VERSION_FIX || '');
const keepTemp = /^1|true|yes$/i.test(process.env.REAL_SOURCE_E2E_KEEP_TEMP || '');
const composerTimeoutMs = Number(process.env.REAL_SOURCE_E2E_COMPOSER_TIMEOUT_MS || 180000);
const brokerHost = new URL(brokerUrl).host;
const runId = Date.now().toString(36);

const sources = [
  {
    id: 'packagist',
    label: 'Public Packagist mirroring',
    setup: 'packagist-mirroring',
    requires: [
      {
        id: 'packagist-stable',
        packageName: 'monolog/monolog',
        constraint: '^3.0',
        vendorFile: 'vendor/monolog/monolog/src/Monolog/Logger.php',
      },
    ],
  },
  {
    id: 'packagist-dev-version',
    label: 'Public Packagist dev branch version regression',
    setup: 'packagist-mirroring',
    softFailUnless: () => expectDevVersionFix,
    softFailMessage:
      'Known bug: dev branch dist mirroring can request /dist/m/.../1.9999999.9999999.9999999-dev.zip and 404. Set EXPECT_DEV_VERSION_FIX=true to make this a hard failure.',
    requires: [
      {
        id: 'packagist-dev-version',
        packageName: 'symfony/polyfill-ctype',
        constraint: '1.x-dev',
        vendorFile: 'vendor/symfony/polyfill-ctype/bootstrap.php',
      },
    ],
  },
  {
    id: 'mage-os',
    label: 'Mage-OS mirror',
    repository: {
      url: 'https://mirror.mage-os.org',
      vcs_type: 'composer',
      credential_type: 'none',
      auth_credentials: {},
      package_filter: 'magento/composer-root-update-plugin',
    },
    requires: [
      {
        id: 'mage-os-small-package',
        packageName: 'magento/composer-root-update-plugin',
        constraint: '2.0.6',
        ignorePlatformReqs: true,
        vendorFile: 'vendor/magento/composer-root-update-plugin/composer.json',
      },
    ],
  },
  {
    id: 'magento',
    label: 'Magento Composer Repository',
    enabled: () => Boolean(process.env.MAGENTO_PUBLIC_KEY && process.env.MAGENTO_PRIVATE_KEY),
    skipMessage: 'Skipping repo.magento.com source because Magento credentials are not available.',
    repository: {
      url: 'https://repo.magento.com',
      vcs_type: 'composer',
      credential_type: 'http_basic',
      auth_credentials: () => ({
        username: process.env.MAGENTO_PUBLIC_KEY,
        password: process.env.MAGENTO_PRIVATE_KEY,
      }),
      package_filter: 'magento/composer',
    },
    requires: [
      {
        id: 'magento-auth-package',
        packageName: 'magento/composer',
        constraint: '1.9.0',
        ignorePlatformReqs: true,
        vendorFile: 'vendor/magento/composer/composer.json',
      },
    ],
  },
];

let adminToken = '';
let apiToken = '';
let projectDir = '';
let lastComposerLog = '';
let failureContext = null;

process.on('unhandledRejection', (error) => {
  fail(error);
});

try {
  await waitForHealth();
  adminToken = await bootstrapAdmin();
  await enablePackagistMirroring();
  await createConfiguredRepositories();
  apiToken = await createApiToken();

  projectDir = await mkdtemp(join(tmpdir(), 'package-broker-real-source-e2e-'));
  await writeComposerProject(projectDir);

  for (const source of sources) {
    if (source.enabled && !source.enabled()) {
      warning(source.skipMessage);
      continue;
    }

    await runSource(source);
  }

  console.log('Real-source E2E completed.');
} catch (error) {
  await fail(error);
} finally {
  if (projectDir && !keepTemp) {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
  } else if (projectDir) {
    console.error(`Keeping temp Composer project: ${projectDir}`);
  }
}

async function runSource(source) {
  console.log(`\n== ${source.label} ==`);

  for (const requireSpec of source.requires) {
    failureContext = { source, requireSpec };

    try {
      await composerRequire(requireSpec);
      await assertVendorFile(requireSpec.vendorFile);
      const lock = await readComposerLock();
      assertLockContainsBrokerDist(lock, requireSpec.packageName);
      await assertBrokerPackageExists(requireSpec.packageName);
      console.log(`PASS ${source.id}: ${requireSpec.packageName}`);
    } catch (error) {
      if (source.softFailUnless && !source.softFailUnless()) {
        warning(`${source.softFailMessage}\nSoft-failed step: ${source.id} / ${requireSpec.packageName}\n${error.stack || error.message || error}`);
        continue;
      }
      throw error;
    } finally {
      failureContext = null;
    }
  }
}

async function waitForHealth() {
  const deadline = Date.now() + Number(process.env.REAL_SOURCE_E2E_HEALTH_TIMEOUT_MS || 90000);
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${brokerUrl}/health`);
      if (response.ok) {
        console.log(`Broker health is OK at ${brokerUrl}`);
        return;
      }
      lastError = new Error(`Health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1500);
  }

  throw new Error(`Broker did not become healthy at ${brokerUrl}: ${lastError?.message || 'timeout'}`);
}

async function bootstrapAdmin() {
  const check = await api('/api/auth/check');
  if (check.setupRequired) {
    await api('/api/setup', {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    });
    console.log('Initial admin setup completed.');
  }

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: adminPassword },
  });

  if (!login.token) {
    throw new Error('Login did not return an admin session token.');
  }

  return login.token;
}

async function enablePackagistMirroring() {
  const result = await api('/api/settings/packagist-mirroring', {
    method: 'PUT',
    admin: true,
    body: { enabled: true },
  });

  if (result.packagist_mirroring_enabled !== true) {
    throw new Error('Packagist mirroring was not enabled.');
  }
}

async function createConfiguredRepositories() {
  const existing = await api('/api/repositories', { admin: true });
  const existingByUrl = new Map(existing.map((repo) => [repo.url.replace(/\/$/, ''), repo]));

  for (const source of sources) {
    if (!source.repository || (source.enabled && !source.enabled())) {
      continue;
    }

    const payload = {
      ...source.repository,
      auth_credentials:
        typeof source.repository.auth_credentials === 'function'
          ? source.repository.auth_credentials()
          : source.repository.auth_credentials,
    };
    const repoKey = payload.url.replace(/\/$/, '');
    const repo = existingByUrl.get(repoKey) || await api('/api/repositories', {
      method: 'POST',
      admin: true,
      body: payload,
    });

    await api(`/api/repositories/${encodeURIComponent(repo.id)}/sync`, {
      method: 'POST',
      admin: true,
    });
    console.log(`Repository ready: ${source.id} (${payload.url})`);
  }
}

async function createApiToken() {
  const tokenResponse = await api('/api/tokens', {
    method: 'POST',
    admin: true,
    body: {
      description: `real-source-e2e-${runId}`,
      permissions: 'readonly',
      rate_limit_max: null,
    },
  });

  if (!tokenResponse.token) {
    throw new Error('Token API did not return a Composer token.');
  }

  return tokenResponse.token;
}

async function writeComposerProject(dir) {
  await mkdir(join(dir, '.composer-home'), { recursive: true });
  await mkdir(join(dir, '.composer-cache'), { recursive: true });
  await writeFile(join(dir, '.composer-home', 'composer.json'), '{}');
  await writeFile(join(dir, 'composer.json'), JSON.stringify({
    name: 'package-broker/real-source-e2e-consumer',
    description: 'Temporary consumer project for PACKAGE.broker real-source E2E.',
    type: 'project',
    'minimum-stability': 'dev',
    'prefer-stable': true,
    repositories: [
      { type: 'composer', url: brokerUrl },
      { packagist: false },
    ],
    config: {
      'secure-http': brokerUrl.startsWith('https://'),
      'allow-plugins': false,
      'preferred-install': 'dist',
    },
  }, null, 2));
}

async function composerRequire(requireSpec) {
  const args = [
    'require',
    `${requireSpec.packageName}:${requireSpec.constraint}`,
    '--update-with-all-dependencies',
    '--prefer-dist',
    '--no-interaction',
    '--no-progress',
    '--no-plugins',
    '-vvv',
  ];

  if (requireSpec.ignorePlatformReqs) {
    args.push('--ignore-platform-reqs');
  }

  const env = {
    ...process.env,
    COMPOSER_HOME: join(projectDir, '.composer-home'),
    COMPOSER_CACHE_DIR: join(projectDir, '.composer-cache'),
    COMPOSER_AUTH: JSON.stringify({
      'http-basic': {
        [brokerHost]: {
          username: 'token',
          password: apiToken,
        },
      },
    }),
    COMPOSER_ALLOW_SUPERUSER: '1',
  };

  const output = await retryCommand('composer', args, {
    cwd: projectDir,
    env,
    timeoutMs: composerTimeoutMs,
    attempts: 3,
  });

  assertNoComposerFallback(output);
  assertComposerDownloadedThroughBroker(output, requireSpec.packageName);
}

async function retryCommand(command, args, options) {
  let lastError;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await runCommand(command, args, options);
    } catch (error) {
      lastError = error;
      if (attempt >= options.attempts) {
        break;
      }
      warning(`${command} ${args.join(' ')} failed on attempt ${attempt}; retrying once more after a short delay.`);
      await sleep(3000 * attempt);
    }
  }
  throw lastError;
}

async function runCommand(command, args, { cwd, env, timeoutMs }) {
  const logFile = join(tmpdir(), `package-broker-real-source-e2e-${runId}-${sanitizeFileName(args.join('-'))}.log`);
  lastComposerLog = logFile;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = createWriteStream(logFile);
    const chunks = [];
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      log.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      chunks.push(chunk);
      log.write(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      log.end();
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      log.end();
      const output = Buffer.concat(chunks).toString('utf8');
      if (code === 0) {
        resolve(output);
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} ${args.join(' ')} failed with ${reason}. Log: ${logFile}\n${tail(output)}`));
    });
  });
}

function assertNoComposerFallback(output) {
  const fallbackPattern = /Failed downloading|trying the next URL/i;
  if (fallbackPattern.test(output)) {
    throw new Error(`Composer attempted fallback to another URL.\n${tail(output)}`);
  }
}

function assertComposerDownloadedThroughBroker(output, packageName) {
  const relevantLines = output
    .split(/\r?\n/)
    .filter((line) => /Downloading|Loading|Reading|Writing/i.test(line) && line.includes(packageName.split('/')[0]));
  const attemptedDownloadLines = output
    .split(/\r?\n/)
    .filter((line) => /Downloading .*\.zip|Following redirect|Writing .* into cache/i.test(line));

  if (attemptedDownloadLines.length > 0 && !attemptedDownloadLines.some((line) => line.includes(brokerHost))) {
    throw new Error(`Composer download output did not show broker host ${brokerHost}.\n${tail(attemptedDownloadLines.join('\n') || relevantLines.join('\n') || output)}`);
  }
}

async function assertVendorFile(relativePath) {
  try {
    await access(join(projectDir, relativePath), fsConstants.R_OK);
  } catch {
    throw new Error(`Expected installed vendor file is missing: ${relativePath}`);
  }
}

async function readComposerLock() {
  const lockPath = join(projectDir, 'composer.lock');
  try {
    const contents = await readFile(lockPath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Could not read composer.lock: ${error.message}`);
  }
}

function assertLockContainsBrokerDist(lock, packageName) {
  const installed = [...(lock.packages || []), ...(lock['packages-dev'] || [])].filter((pkg) => pkg.name === packageName);
  if (installed.length === 0) {
    throw new Error(`composer.lock does not contain ${packageName}`);
  }

  const hasBrokerMirror = installed.some((pkg) => {
    const distUrl = pkg.dist?.url || '';
    const mirrors = Array.isArray(pkg.dist?.mirrors) ? pkg.dist.mirrors : [];
    return distUrl.includes(brokerHost) || mirrors.some((mirror) => String(mirror.url || '').includes(brokerHost));
  });

  if (!hasBrokerMirror) {
    throw new Error(`composer.lock for ${packageName} does not contain broker dist URL or mirror host ${brokerHost}`);
  }
}

async function assertBrokerPackageExists(packageName) {
  const result = await api(`/api/packages?search=${encodeURIComponent(packageName)}&limit=100`, { admin: true });
  const packages = Array.isArray(result.data) ? result.data : [];
  if (!packages.some((pkg) => pkg.name === packageName)) {
    throw new Error(`Broker package API does not list mirrored package ${packageName}`);
  }
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.admin) {
    headers.Authorization = `Bearer ${adminToken}`;
  }

  const response = await fetch(`${brokerUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`${method} ${path} returned HTTP ${response.status}: ${text}`);
  }

  return json;
}

async function fail(error) {
  console.error('\nReal-source E2E failed.');
  if (failureContext) {
    console.error(`Source: ${failureContext.source.id}`);
    console.error(`Package: ${failureContext.requireSpec.packageName}`);
  }
  console.error(error?.stack || error?.message || error);

  await printFileTail('Composer output', lastComposerLog);
  await printFileTail('Broker log', process.env.BROKER_LOG_FILE);

  if (process.env.BROKER_DOCKER_CONTAINER) {
    await runBestEffort('docker', ['logs', '--tail', '200', process.env.BROKER_DOCKER_CONTAINER]);
  }

  process.exitCode = 1;
}

async function printFileTail(label, file) {
  if (!file) {
    return;
  }
  try {
    const fileStat = await stat(file);
    if (!fileStat.isFile()) {
      return;
    }
    const contents = await readFile(file, 'utf8');
    console.error(`\n--- ${label}: ${file} (tail) ---`);
    console.error(tail(contents, 200));
  } catch {
    // Ignore missing logs.
  }
}

async function runBestEffort(command, args) {
  try {
    const output = await runCommand(command, args, {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 30000,
    });
    console.error(`\n--- ${command} ${args.join(' ')} ---`);
    console.error(output);
  } catch (error) {
    console.error(`Could not collect ${command} ${args.join(' ')}: ${error.message}`);
  }
}

function tail(value, lines = 120) {
  return String(value || '').split(/\r?\n/).slice(-lines).join('\n');
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 120);
}

function warning(message) {
  console.warn(`::warning::${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
