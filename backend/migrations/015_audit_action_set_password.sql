-- A Global Admin can now set a person's password directly (routes/people.js's
-- POST /:id/set-password and POST / with a password), bypassing the email
-- invite — logged distinctly from 'create'/'update' since it's a sensitive
-- credential action, not a routine field edit.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'set_password';
