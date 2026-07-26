-- The reporting integration framework logs a 'view' audit action every time
-- a user opens an embedded report (GET /report-mappings/:id/embed), but the
-- audit_action enum only had create/update/delete/login/move/restore/
-- role_change — add the missing value.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'view';
