-- Add metadata column to store complete upstream package metadata as JSON
ALTER TABLE packages ADD COLUMN metadata TEXT;

