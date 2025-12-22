-- Initial schema migration

-- Repositories table
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  vcs_type TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  auth_credentials TEXT NOT NULL,
  composer_json_path TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repositories_status ON repositories(status);
CREATE INDEX IF NOT EXISTS idx_repositories_last_synced ON repositories(last_synced_at);
CREATE INDEX IF NOT EXISTS idx_repositories_credential_type ON repositories(credential_type);
CREATE INDEX IF NOT EXISTS idx_repositories_vcs_type ON repositories(vcs_type);

-- Tokens table
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  rate_limit_max INTEGER DEFAULT 1000,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tokens_token_hash ON tokens(token_hash);

-- Artifacts table
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  file_key TEXT NOT NULL,
  size INTEGER,
  download_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_downloaded_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_artifacts_repo_id ON artifacts(repo_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_package_name ON artifacts(package_name);
CREATE INDEX IF NOT EXISTS idx_artifacts_last_downloaded ON artifacts(last_downloaded_at);
CREATE UNIQUE INDEX IF NOT EXISTS artifacts_repo_package_version ON artifacts(repo_id, package_name, version);

-- Packages table
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  dist_url TEXT NOT NULL,
  released_at INTEGER,
  readme_content TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_packages_repo_id ON packages(repo_id);
CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
CREATE UNIQUE INDEX IF NOT EXISTS packages_name_version_unique ON packages(name, version);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);


