-- Add file_key column to artifacts table for R2/S3 storage key tracking
ALTER TABLE artifacts ADD COLUMN file_key TEXT;
