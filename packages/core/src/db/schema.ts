import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';

// Repositories table
export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    url: text('url').notNull(),
    vcs_type: text('vcs_type').notNull(), // 'git', 'composer', 'artifact' - determines sync strategy
    credential_type: text('credential_type').notNull(), // 'http_basic', 'github_token', 'gitlab_token', etc.
    auth_credentials: text('auth_credentials').notNull(), // Encrypted JSON with credential-specific fields
    composer_json_path: text('composer_json_path'), // Supports glob patterns like '{lib,src}/**/composer.json'
    package_filter: text('package_filter'), // Comma-separated list of packages to sync (for repos with provider-includes)
    status: text('status').default('pending'), // 'active', 'error', 'pending', 'syncing'
    error_message: text('error_message'),
    last_synced_at: integer('last_synced_at'),
    created_at: integer('created_at').notNull(),
    org_id: text('org_id').references(() => organizations.id),
  },
  (table) => ({
    statusIdx: index('idx_repositories_status').on(table.status),
    lastSyncedIdx: index('idx_repositories_last_synced').on(table.last_synced_at),
    credentialTypeIdx: index('idx_repositories_credential_type').on(table.credential_type),
    vcsTypeIdx: index('idx_repositories_vcs_type').on(table.vcs_type),
  })
);

// Tokens table
export const tokens = sqliteTable(
  'tokens',
  {
    id: text('id').primaryKey(),
    description: text('description').notNull(),
    token_hash: text('token_hash').notNull(), // SHA-256 hash for high-entropy tokens
    permissions: text('permissions').notNull().default('readonly'), // 'readonly' | 'write'
    rate_limit_max: integer('rate_limit_max'), // requests per hour (null/0 = unlimited)
    created_at: integer('created_at').notNull(),
    expires_at: integer('expires_at'),
    last_used_at: integer('last_used_at'),
    tenant_id: text('tenant_id').references(() => tenants.id),
    org_id: text('org_id').references(() => organizations.id),
  },
  (table) => ({
    tokenHashIdx: index('idx_tokens_token_hash').on(table.token_hash),
  })
);

// Token scopes table (per-token access control)
export const tokenScopes = sqliteTable(
  'token_scopes',
  {
    id: text('id').primaryKey(),
    token_id: text('token_id')
      .notNull()
      .references(() => tokens.id, { onDelete: 'cascade' }),
    scope_type: text('scope_type').notNull(), // 'repository' | 'package_pattern'
    scope_value: text('scope_value').notNull(), // repo ID or glob like 'vendor/*'
    created_at: integer('created_at').notNull(),
  },
  (table) => ({
    tokenIdIdx: index('idx_token_scopes_token_id').on(table.token_id),
    uniqueScope: unique('token_scopes_unique').on(table.token_id, table.scope_type, table.scope_value),
  })
);

// Artifacts table
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    repo_id: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    package_name: text('package_name').notNull(),
    version: text('version').notNull(),
    file_key: text('file_key').notNull(), // R2/S3 key
    size: integer('size'), // bytes
    download_count: integer('download_count').default(0), // Number of downloads
    created_at: integer('created_at').notNull(),
    last_downloaded_at: integer('last_downloaded_at'),
  },
  (table) => ({
    repoIdIdx: index('idx_artifacts_repo_id').on(table.repo_id),
    packageNameIdx: index('idx_artifacts_package_name').on(table.package_name),
    lastDownloadedIdx: index('idx_artifacts_last_downloaded').on(table.last_downloaded_at),
    // Composite unique index for fast lookup in dist route
    uniqueArtifactIdx: unique('artifacts_repo_package_version').on(
      table.repo_id,
      table.package_name,
      table.version
    ),
  })
);

// Package metadata table (for UI queries)
export const packages = sqliteTable(
  'packages',
  {
    id: text('id').primaryKey(),
    repo_id: text('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    dist_url: text('dist_url').notNull(),
    source_dist_url: text('source_dist_url'), // Original source repository URL for on-demand mirroring
    dist_reference: text('dist_reference'), // Reference/hash for mirror URL substitution (commit hash for git, generated hash for others)
    description: text('description'),
    license: text('license'), // JSON string for array support
    package_type: text('package_type'), // "library", "magento2-module", etc.
    homepage: text('homepage'),
    released_at: integer('released_at'),
    readme_content: text('readme_content'),
    metadata: text('metadata'), // Complete upstream package metadata as JSON
    is_manual_upload: integer('is_manual_upload').default(0).notNull(), // Flag for manually uploaded packages
    created_at: integer('created_at').notNull(),
  },
  (table) => ({
    repoIdIdx: index('idx_packages_repo_id').on(table.repo_id),
    nameIdx: index('idx_packages_name').on(table.name),
    manualUploadIdx: index('idx_packages_manual_upload').on(table.is_manual_upload),
    // Unique constraint to prevent duplicate package+version entries per repository
    uniqueRepoPackageVersionIdx: unique('packages_repo_name_version_unique').on(
      table.repo_id,
      table.name,
      table.version
    ),
  })
);

// Users table (formerly admin_users)
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    password_hash: text('password_hash').notNull(), // bcrypt or argon2 hash
    role: text('role').default('admin').notNull(), // 'admin' | 'viewer'
    status: text('status').default('active').notNull(), // 'active' | 'invited' | 'blocked'
    two_factor_secret: text('two_factor_secret'),
    two_factor_enabled: integer('two_factor_enabled', { mode: 'boolean' }).default(false),
    recovery_codes: text('recovery_codes'), // Encrypted JSON array of recovery codes
    invite_token: text('invite_token'), // Token for setting initial password
    invite_expires_at: integer('invite_expires_at'), // Expiration timestamp for invite
    created_at: integer('created_at').notNull(),
    last_login_at: integer('last_login_at'),
  },
  (table) => ({
    emailIdx: index('idx_users_email').on(table.email),
    inviteTokenIdx: index('idx_users_invite_token').on(table.invite_token),
  })
);

// Organizations table
export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    owner_user_id: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    created_at: integer('created_at').notNull(),
  },
  (table) => ({
    slugUnique: unique('organizations_slug_unique').on(table.slug),
  })
);

// Tenants table
export const tenants = sqliteTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    created_at: integer('created_at').notNull(),
  },
  (table) => ({
    orgIdIdx: index('idx_tenants_org_id').on(table.org_id),
    orgSlugUnique: unique('tenants_org_slug_unique').on(table.org_id, table.slug),
  })
);

// Organization members table
export const organizationMembers = sqliteTable(
  'organization_members',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
    created_at: integer('created_at').notNull(),
  },
  (table) => ({
    orgIdIdx: index('idx_org_members_org_id').on(table.org_id),
    userIdIdx: index('idx_org_members_user_id').on(table.user_id),
    orgUserUnique: unique('org_members_org_user_unique').on(table.org_id, table.user_id),
  })
);

// Tenant packages table
export const tenantPackages = sqliteTable(
  'tenant_packages',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    package_pattern: text('package_pattern').notNull(),
    access_level: text('access_level').notNull().default('read'),
    created_at: integer('created_at').notNull(),
  },
  (table) => ({
    tenantIdIdx: index('idx_tenant_packages_tenant_id').on(table.tenant_id),
    tenantPatternUnique: unique('tenant_packages_tenant_pattern_unique').on(
      table.tenant_id,
      table.package_pattern
    ),
  })
);

// NO activity_log table - use Cloudflare Workers logs for debugging
// Workers logs are limited to last X entries and don't require database storage
