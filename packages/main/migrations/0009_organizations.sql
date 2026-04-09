CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  CONSTRAINT organizations_slug_unique UNIQUE(slug)
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT tenants_org_slug_unique UNIQUE(org_id, slug)
);

CREATE TABLE organization_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  CONSTRAINT org_members_org_user_unique UNIQUE(organization_id, user_id)
);

CREATE TABLE tenant_packages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_pattern TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'read',
  created_at INTEGER NOT NULL,
  CONSTRAINT tenant_packages_tenant_pattern_unique UNIQUE(tenant_id, package_pattern)
);

CREATE INDEX idx_tenants_org_id ON tenants(org_id);
CREATE INDEX idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX idx_tenant_packages_tenant_id ON tenant_packages(tenant_id);

-- Add org references to existing tables
ALTER TABLE tokens ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE tokens ADD COLUMN organization_id TEXT REFERENCES organizations(id);
ALTER TABLE repositories ADD COLUMN org_id TEXT REFERENCES organizations(id);
