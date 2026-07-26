-- OnCall Pro — initial schema
-- Postgres 15+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ─────────────────────────────────────────────────────────────
-- Organizations (Master → Main Account → Sub Account → Provider)
-- ─────────────────────────────────────────────────────────────
CREATE TYPE org_level AS ENUM ('master', 'main_account', 'sub_account', 'provider');

CREATE TABLE organizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  level             org_level NOT NULL,
  parent_id         UUID REFERENCES organizations(id) ON DELETE CASCADE,
  account_number    TEXT,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  website           TEXT,
  primary_contact   TEXT,
  call_messages_url TEXT,
  logo_url          TEXT,
  primary_color     TEXT DEFAULT '#1B2333',
  accent_color      TEXT DEFAULT '#F5A623',
  name_override     TEXT,
  tagline           TEXT,
  favicon_url       TEXT,
  description       TEXT,
  message_html      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_parent ON organizations(parent_id);

-- Master has no parent; every other level must have one. Enforced in app layer
-- (Postgres CHECK constraints can't reference other rows), see routes/organizations.js.

-- ─────────────────────────────────────────────────────────────
-- Users (platform accounts) — org_role is null for Global Admins
-- ─────────────────────────────────────────────────────────────
CREATE TYPE platform_role AS ENUM ('admin', 'user');
CREATE TYPE org_role_type AS ENUM ('org_admin', 'user');

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  phone           TEXT,
  mobile          TEXT,
  department      TEXT,
  job_title       TEXT,
  office_location TEXT,
  platform_role   platform_role NOT NULL DEFAULT 'user',
  org_role        org_role_type,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_org ON users(organization_id);

-- ─────────────────────────────────────────────────────────────
-- People (on-call contacts — distinct from platform Users)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE people (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  primary_phone    TEXT NOT NULL,
  sms_number       TEXT NOT NULL,
  secondary_phone  TEXT,
  email            TEXT,
  department       TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  photo_url        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_people_org ON people(organization_id);

-- ─────────────────────────────────────────────────────────────
-- Calendars (belong to a sub-account org; optionally linked to Providers)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE calendars (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  location_ids     UUID[] DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calendars_org ON calendars(organization_id);

-- ─────────────────────────────────────────────────────────────
-- Assignments (one row per day per time slot — escalation or broadcast)
-- ─────────────────────────────────────────────────────────────
CREATE TYPE assignment_mode AS ENUM ('escalation', 'broadcast');

CREATE TABLE assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id      UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  mode             assignment_mode NOT NULL DEFAULT 'escalation',

  -- escalation mode
  primary_person_id   UUID REFERENCES people(id) ON DELETE SET NULL,
  secondary_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  tertiary_person_id  UUID REFERENCES people(id) ON DELETE SET NULL,
  default_person_id   UUID REFERENCES people(id) ON DELETE SET NULL,
  primary_timeout_min   INT DEFAULT 15,
  secondary_timeout_min INT DEFAULT 30,

  -- broadcast mode
  broadcast_pool   UUID[] DEFAULT '{}',
  accepted_by      UUID REFERENCES people(id) ON DELETE SET NULL,

  notes            TEXT,
  notify_slack     BOOLEAN NOT NULL DEFAULT true,
  notify_email     BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignments_calendar_date ON assignments(calendar_id, date);
CREATE INDEX idx_assignments_primary ON assignments(primary_person_id);

-- ─────────────────────────────────────────────────────────────
-- Shift swaps — two-stage approval (target accept → admin approve)
-- ─────────────────────────────────────────────────────────────
CREATE TYPE swap_status AS ENUM ('pending_target', 'pending_admin', 'approved', 'rejected', 'cancelled');
CREATE TYPE swap_role AS ENUM ('primary', 'secondary', 'tertiary');

CREATE TABLE shift_swap_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id     UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  swap_role         swap_role NOT NULL,
  requested_by      UUID NOT NULL REFERENCES people(id),
  target_person_id  UUID NOT NULL REFERENCES people(id),
  reason            TEXT,
  status            swap_status NOT NULL DEFAULT 'pending_target',
  admin_notes       TEXT,
  reviewed_by       UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_swaps_assignment ON shift_swap_requests(assignment_id);
CREATE INDEX idx_swaps_status ON shift_swap_requests(status);

-- ─────────────────────────────────────────────────────────────
-- Contact change requests (Regular User self-service, admin-approved)
-- ─────────────────────────────────────────────────────────────
CREATE TYPE change_request_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE contact_change_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  requested_by   UUID NOT NULL REFERENCES users(id),
  proposed_changes JSONB NOT NULL,
  status         change_request_status NOT NULL DEFAULT 'pending',
  reviewer_notes TEXT,
  reviewed_by    UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Audit log — append-only
-- ─────────────────────────────────────────────────────────────
CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'login');

CREATE TABLE audit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email       TEXT NOT NULL,
  action           audit_action NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        UUID,
  entity_name      TEXT,
  changes          JSONB,
  organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- Revoke UPDATE/DELETE at the app layer — no route ever issues them against audit_logs.
