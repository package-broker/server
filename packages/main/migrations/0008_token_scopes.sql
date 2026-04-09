CREATE TABLE token_scopes (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('repository', 'package_pattern')),
  scope_value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT token_scopes_unique UNIQUE(token_id, scope_type, scope_value)
);

CREATE INDEX idx_token_scopes_token_id ON token_scopes(token_id);
