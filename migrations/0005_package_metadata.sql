-- Add package metadata fields: description, license, package_type, homepage
ALTER TABLE packages ADD COLUMN description TEXT;
ALTER TABLE packages ADD COLUMN license TEXT;
ALTER TABLE packages ADD COLUMN package_type TEXT;
ALTER TABLE packages ADD COLUMN homepage TEXT;



