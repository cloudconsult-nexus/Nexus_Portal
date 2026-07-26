-- Unify Users + People into a single Person record with RBAC roles.
-- Pre-launch environment — no production data to preserve, but the
-- migration still moves any existing rows so local/staging seed data survives.

-- ─────────────────────────────────────────────────────────────
-- RBAC roles
-- ─────────────────────────────────────────────────────────────
CREATE TYPE person_role AS ENUM ('global_admin', 'org_admin', 'scheduler', 'technician', 'read_only');

-- ─────────────────────────────────────────────────────────────
-- Extend people into the unified Person record
-- ─────────────────────────────────────────────────────────────
ALTER TABLE people ADD COLUMN role person_role NOT NULL DEFAULT 'technician';
ALTER TABLE people ADD COLUMN login_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE people ADD COLUMN password_hash TEXT;
ALTER TABLE people ADD COLUMN job_title TEXT;
ALTER TABLE people ADD COLUMN last_active_at TIMESTAMPTZ;
ALTER TABLE people ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE people ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE people ADD COLUMN deleted_by UUID REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE people RENAME COLUMN sms_number TO sms_phone;

-- A schedulable Person may not need platform login, and a login-only Person
-- (e.g. a Global Admin with no phone) may not need contact numbers or an org.
ALTER TABLE people ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE people ALTER COLUMN primary_phone DROP NOT NULL;
ALTER TABLE people ALTER COLUMN sms_phone DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- Migrate existing users into people, mapping the old two-field
-- platform_role/org_role model onto the new single `role` enum.
-- ─────────────────────────────────────────────────────────────
INSERT INTO people (
  id, organization_id, name, primary_phone, sms_phone, secondary_phone, email,
  department, job_title, is_active, role, login_enabled, password_hash,
  last_active_at, created_at, updated_at
)
SELECT
  u.id, u.organization_id, u.display_name, u.phone, u.mobile, NULL, u.email,
  u.department, u.job_title, u.is_active,
  CASE
    WHEN u.platform_role = 'admin' THEN 'global_admin'
    WHEN u.org_role = 'org_admin' THEN 'org_admin'
    ELSE 'technician'
  END::person_role,
  true, u.password_hash, u.last_active_at, u.created_at, u.updated_at
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.email IS NOT NULL AND lower(p.email) = lower(u.email));

-- Enforce a unique login identity once merged data is in place.
CREATE UNIQUE INDEX idx_people_email_unique ON people (lower(email)) WHERE email IS NOT NULL AND is_deleted = false;

-- ─────────────────────────────────────────────────────────────
-- Repoint every FK that referenced users(id) onto people(id) — same UUIDs,
-- since the insert above preserved u.id.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE assignments DROP CONSTRAINT assignments_created_by_fkey;
ALTER TABLE assignments ADD CONSTRAINT assignments_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE shift_swap_requests DROP CONSTRAINT shift_swap_requests_reviewed_by_fkey;
ALTER TABLE shift_swap_requests ADD CONSTRAINT shift_swap_requests_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES people(id) ON DELETE SET NULL;

ALTER TABLE contact_change_requests DROP CONSTRAINT contact_change_requests_requested_by_fkey;
ALTER TABLE contact_change_requests ADD CONSTRAINT contact_change_requests_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES people(id);

ALTER TABLE contact_change_requests DROP CONSTRAINT contact_change_requests_reviewed_by_fkey;
ALTER TABLE contact_change_requests ADD CONSTRAINT contact_change_requests_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES people(id);

ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_user_id_fkey;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES people(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- Drop the old users table and its now-unused enums.
-- ─────────────────────────────────────────────────────────────
DROP TABLE users;
DROP TYPE platform_role;
DROP TYPE org_role_type;

-- ─────────────────────────────────────────────────────────────
-- Audit log: record old/new values distinctly, and add move/restore actions
-- for hierarchy moves and soft-delete recovery.
-- ─────────────────────────────────────────────────────────────
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'move';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'restore';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'role_change';

ALTER TABLE audit_logs ADD COLUMN old_values JSONB;
ALTER TABLE audit_logs ADD COLUMN new_values JSONB;
