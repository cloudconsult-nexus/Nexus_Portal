-- primary_color/accent_color had column-level DEFAULTs since 001_init.sql,
-- meaning every organization row was always "set" even though no UI ever
-- exposed a way to actually choose a color before now. That defeats
-- effective-branding inheritance (routes/organizations.js
-- GET /:id/effective-branding): a Sub Account could never fall back to its
-- Master Organization's accent color because it already had its own default
-- baked in at creation. Since no row could have been an intentional choice
-- of exactly these values, clearing rows still sitting on the untouched
-- default is safe, then future rows are created NULL like every other
-- branding field (name_override, tagline, logo_url).
UPDATE organizations SET primary_color = NULL WHERE primary_color = '#1B2333';
UPDATE organizations SET accent_color = NULL WHERE accent_color = '#F5A623';
ALTER TABLE organizations ALTER COLUMN primary_color DROP DEFAULT;
ALTER TABLE organizations ALTER COLUMN accent_color DROP DEFAULT;
