-- Cleanup migration: Remove packages with numeric-only versions
-- These are incorrect versions stored due to a bug where array indices were used instead of semantic versions
-- This affects all packages synced from Packagist p2 API

-- Delete packages where version is a pure number (0-9+)
-- This matches the bug where versions were stored as "0", "1", "2", etc. instead of "3.9.0", "3.8.1", etc.
DELETE FROM packages
WHERE version GLOB '[0-9]*' 
  AND version NOT GLOB '*[^0-9]*'
  AND length(version) <= 10; -- Safety check: only delete versions that are pure numbers up to 10 digits

-- Also delete associated artifacts for these packages
DELETE FROM artifacts
WHERE (package_name, version) IN (
  SELECT package_name, version 
  FROM packages 
  WHERE version GLOB '[0-9]*' 
    AND version NOT GLOB '*[^0-9]*'
    AND length(version) <= 10
);

