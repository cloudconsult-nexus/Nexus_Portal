-- Nothing in the schema stores a timezone anywhere today — not on
-- organizations, calendars, or tas_settings — so assignments.date/
-- start_time/end_time are plain wall-clock values with no defined zone.
-- Needed for the NCC on-call lookup endpoint (routes/nccOnCall.js), which
-- has to convert a real UTC timestamp into "what local date/time is this"
-- before it can match against those columns. One zone for the whole
-- deployment (matches the one-TAS-per-deployment model), admin-editable
-- on the existing TAS Settings page.
ALTER TABLE tas_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
