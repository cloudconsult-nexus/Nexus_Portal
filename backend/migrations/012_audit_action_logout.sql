-- The audit logging framework now records logout (POST /auth/logout), the
-- counterpart to the existing 'login' action — add the missing enum value.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'logout';
