-- Add permissions column to tokens table
ALTER TABLE tokens ADD COLUMN permissions TEXT NOT NULL DEFAULT 'readonly';

-- Set all existing tokens to 'write' for backwards compatibility
UPDATE tokens SET permissions = 'write' WHERE permissions = 'readonly';

