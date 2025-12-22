-- Add package_filter column for filtering packages to sync
-- Used by repositories with provider-includes (like Magento Marketplace)
-- Contains comma-separated list of package names to sync

ALTER TABLE repositories ADD COLUMN package_filter TEXT;



