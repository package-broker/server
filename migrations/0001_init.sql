-- Create repositories table
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
CREATE INDEX IF NOT EXISTS idx_repositories_vcs_type ON repositories(vcs_type);

-- Create tokens table
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

-- Create packages table
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  dist_url TEXT NOT NULL,
  released_at INTEGER,
  readme_content TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(name, version)
);

CREATE INDEX IF NOT EXISTS idx_packages_repo_id ON packages(repo_id);
CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);

-- Create artifacts table
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  file_key TEXT,
  size INTEGER,
  download_count INTEGER DEFAULT 0,
  last_downloaded_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(repo_id, package_name, version)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_repo_id ON artifacts(repo_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_package_name ON artifacts(package_name);
