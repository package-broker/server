-- Add source_dist_url column to packages table for on-demand artifact mirroring
ALTER TABLE packages ADD COLUMN source_dist_url TEXT;
