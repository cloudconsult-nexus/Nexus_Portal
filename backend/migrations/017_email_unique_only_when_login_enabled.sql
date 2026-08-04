-- Two people are allowed to share an email address as long as at most one
-- of them can actually log in. Login resolution (routes/auth.js) looks a
-- person up by `lower(email)` with no other disambiguator, so uniqueness
-- must still hold among login_enabled accounts — otherwise which of the two
-- accounts a shared-email login resolves to becomes undefined. A
-- not-yet-activated invitee (login_enabled = false) can't hit that lookup
-- at all, so sharing an email with an active person is safe until they're
-- activated themselves, at which point this same index blocks it.
DROP INDEX idx_people_email_unique;
CREATE UNIQUE INDEX idx_people_email_unique ON people (lower(email))
  WHERE email IS NOT NULL AND is_deleted = false AND login_enabled = true;
