-- Historical no-op: is_manual_upload is already part of the packages schema
-- in 0001_initial.sql (snapshot) and the packages rebuild in
-- 0004_fix_package_unique.sql, so re-adding the column breaks fresh databases.
-- Databases that applied the original version of this migration have it
-- recorded in d1_migrations and never re-run it.

CREATE INDEX IF NOT EXISTS idx_packages_manual_upload ON packages(is_manual_upload);
