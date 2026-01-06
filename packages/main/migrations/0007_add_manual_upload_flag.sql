-- Add is_manual_upload flag to packages table
-- This field marks packages that were manually uploaded vs synced from repositories

ALTER TABLE packages ADD COLUMN is_manual_upload INTEGER DEFAULT 0 NOT NULL;

-- Index for filtering manual uploads
CREATE INDEX idx_packages_manual_upload ON packages(is_manual_upload);

