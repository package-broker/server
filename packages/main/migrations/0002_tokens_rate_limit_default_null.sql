-- Tokens: make rate_limit_max default NULL (unlimited)
-- D1/SQLite doesn't support altering column defaults directly, so rebuild the table.

PRAGMA foreign_keys=OFF;
BEGIN;

CREATE TABLE IF NOT EXISTS tokens_new (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT 'readonly',
  rate_limit_max INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER
);

INSERT INTO tokens_new (id, description, token_hash, permissions, rate_limit_max, created_at, expires_at, last_used_at)
SELECT id, description, token_hash, permissions, rate_limit_max, created_at, expires_at, last_used_at
FROM tokens;

DROP TABLE tokens;
ALTER TABLE tokens_new RENAME TO tokens;

CREATE INDEX IF NOT EXISTS idx_tokens_token_hash ON tokens(token_hash);

COMMIT;
PRAGMA foreign_keys=ON;


