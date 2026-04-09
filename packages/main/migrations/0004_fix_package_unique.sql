-- Fix: Change unique constraint from (name, version) to (repo_id, name, version)
CREATE TABLE packages_new (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  dist_url TEXT NOT NULL,
  source_dist_url TEXT,
  dist_reference TEXT,
  description TEXT,
  license TEXT,
  package_type TEXT,
  homepage TEXT,
  released_at INTEGER,
  readme_content TEXT,
  metadata TEXT,
  is_manual_upload INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT INTO packages_new SELECT * FROM packages;
DROP TABLE packages;
ALTER TABLE packages_new RENAME TO packages;

CREATE INDEX idx_packages_repo_id ON packages(repo_id);
CREATE INDEX idx_packages_name ON packages(name);
CREATE INDEX idx_packages_manual_upload ON packages(is_manual_upload);
CREATE UNIQUE INDEX packages_repo_name_version_unique ON packages(repo_id, name, version);
