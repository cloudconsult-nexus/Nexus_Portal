-- Phase 5.1 — TAS Client Portal alignment: flatten the 5-level generic
-- hierarchy (Master Org → Main Account → Sub Account → Department →
-- Provider) into a flat TAS → Customer model, and collapse the 5-tier role
-- model (Global Admin / Org Admin / Scheduler / Technician / Read Only)
-- into 3 tiers (Global Admin / Customer Admin / User), with schedule-edit
-- authority becoming a per-user grant instead of a separate role tier.
-- See CLAUDE.md's "Target spec: TAS Client Portal" section for the source.
--
-- This environment already has live data (one master_organization row,
-- "Pioneer TAS", with one main_account child, "Main Office") that must
-- survive reshaped, not be dropped.

-- ─────────────────────────────────────────────────────────────
-- TAS-level settings — what used to live on the single
-- master_organization row now becomes real instance-wide config,
-- since a TAS instance is implicit (one deployed Portal = one TAS)
-- rather than a node in the same tree as its Customers.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE tas_settings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL DEFAULT 'TAS Client Portal',
  logo_url          TEXT,
  favicon_url       TEXT,
  primary_color     TEXT,
  accent_color      TEXT,
  name_override     TEXT,
  tagline           TEXT,
  description       TEXT,
  message_html      TEXT,
  phone             TEXT,
  email             TEXT,
  website           TEXT,
  address           TEXT,
  primary_contact   TEXT,
  call_messages_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Carry forward the existing master_organization row's branding, if any.
-- Must exclude soft-deleted rows and prefer the most recently touched one —
-- an environment can accumulate more than one master_organization row (a
-- soft-deleted test org plus the real one), and picking the wrong one here
-- silently loses the real branding before the DELETE below removes the row
-- entirely.
INSERT INTO tas_settings (
  name, logo_url, favicon_url, primary_color, accent_color, name_override,
  tagline, description, message_html, phone, email, website, address,
  primary_contact, call_messages_url
)
SELECT
  name, logo_url, favicon_url, primary_color, accent_color, name_override,
  tagline, description, message_html, phone, email, website, address,
  primary_contact, call_messages_url
FROM organizations
WHERE node_type = 'master_organization' AND is_deleted = false
ORDER BY updated_at DESC
LIMIT 1;

-- A fresh install (no master_organization row ever created) still needs
-- exactly one settings row for the app to treat as a singleton.
INSERT INTO tas_settings (name)
SELECT 'TAS Client Portal'
WHERE NOT EXISTS (SELECT 1 FROM tas_settings);

-- ─────────────────────────────────────────────────────────────
-- organizations: flatten into a plain Customer table. Every surviving
-- row is a Customer — no more node types, no more parent/child nesting.
-- ─────────────────────────────────────────────────────────────

-- Detach the master_organization row(s)' direct children first so
-- deleting the master row doesn't cascade-delete them.
UPDATE organizations SET parent_id = NULL
WHERE parent_id IN (SELECT id FROM organizations WHERE node_type = 'master_organization');

DELETE FROM organizations WHERE node_type = 'master_organization';

-- Catch-all: flatten anything still nested (sub_account/department/provider
-- rows under a main_account, if any existed) — the target model has no
-- valid nesting left at all.
UPDATE organizations SET parent_id = NULL WHERE parent_id IS NOT NULL;

DROP INDEX IF EXISTS idx_organizations_parent_account_number;
DROP INDEX IF EXISTS idx_organizations_parent;

ALTER TABLE organizations DROP COLUMN node_type;
DROP TYPE node_type;
ALTER TABLE organizations DROP COLUMN parent_id;

-- Spec: "Customer Admin ... defines whether contact edits require Global
-- Admin approval" — per-Customer, direct-edit vs. approval-routed.
ALTER TABLE organizations ADD COLUMN contact_edit_requires_approval BOOLEAN NOT NULL DEFAULT false;

-- Providers linking across multiple organizations contradicts the spec's
-- "no on-call resources shared across Customers" requirement, and nothing
-- in the app ever read from this table.
DROP TABLE IF EXISTS provider_organizations;

-- ─────────────────────────────────────────────────────────────
-- Role model: 5 tiers → 3. Schedule-edit authority becomes a grant on
-- the person, not a separate role tier (spec: "User ... view/edit
-- schedule if granted"). Capture it from the pre-migration role value
-- before the type rewrite discards the old labels.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE people ADD COLUMN can_edit_schedule BOOLEAN NOT NULL DEFAULT false;
UPDATE people SET can_edit_schedule = true WHERE role = 'scheduler';

CREATE TYPE person_role_new AS ENUM ('global_admin', 'customer_admin', 'user');

ALTER TABLE people ALTER COLUMN role DROP DEFAULT;
ALTER TABLE people
  ALTER COLUMN role TYPE person_role_new
  USING (
    CASE role::text
      WHEN 'org_admin' THEN 'customer_admin'
      WHEN 'scheduler' THEN 'user'
      WHEN 'technician' THEN 'user'
      WHEN 'read_only' THEN 'user'
      ELSE role::text
    END
  )::person_role_new;
ALTER TABLE people ALTER COLUMN role SET DEFAULT 'user';

DROP TYPE person_role;
ALTER TYPE person_role_new RENAME TO person_role;

-- Same remap for the two other places role names are stored as plain
-- text/text[] rather than the enum, so stale values don't cause failures
-- later (an invitation with role='org_admin' would try to set a person's
-- role to a value the enum no longer has).
UPDATE invitations SET role = CASE role
  WHEN 'org_admin' THEN 'customer_admin'
  WHEN 'scheduler' THEN 'user'
  WHEN 'technician' THEN 'user'
  WHEN 'read_only' THEN 'user'
  ELSE role
END;

UPDATE report_mappings SET visible_to_roles = (
  SELECT array_agg(DISTINCT CASE r
    WHEN 'org_admin' THEN 'customer_admin'
    WHEN 'scheduler' THEN 'user'
    WHEN 'technician' THEN 'user'
    WHEN 'read_only' THEN 'user'
    ELSE r
  END)
  FROM unnest(visible_to_roles) AS r
);
