-- Onboarding hardening (account lockout, TOTP MFA enrollment, terms
-- acceptance on first login) and the Calendar coverage-type field the
-- master prompt calls for at creation time.

ALTER TABLE people ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN locked_until TIMESTAMPTZ;
ALTER TABLE people ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE people ADD COLUMN mfa_secret TEXT;
ALTER TABLE people ADD COLUMN terms_accepted_at TIMESTAMPTZ;

CREATE TYPE coverage_type AS ENUM ('24x7', 'business_hours', 'after_hours', 'custom');
ALTER TABLE calendars ADD COLUMN coverage_type coverage_type NOT NULL DEFAULT '24x7';
