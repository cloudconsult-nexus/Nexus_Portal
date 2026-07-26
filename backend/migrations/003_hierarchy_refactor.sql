-- Generalize the organizations table into a proper hierarchy-node table:
-- add the Department level, rename level -> node_type with clearer naming,
-- and add soft delete so nodes are recoverable per the CRUD spec.

-- ─────────────────────────────────────────────────────────────
-- node_type: rename org_level, rename 'master' for clarity, add 'department'
-- between sub_account and provider.
-- ─────────────────────────────────────────────────────────────
ALTER TYPE org_level RENAME VALUE 'master' TO 'master_organization';
ALTER TYPE org_level ADD VALUE 'department' AFTER 'sub_account';
ALTER TYPE org_level RENAME TO node_type;

ALTER TABLE organizations RENAME COLUMN level TO node_type;

-- ─────────────────────────────────────────────────────────────
-- Soft delete, matching the Person model.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE organizations ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN deleted_by UUID REFERENCES people(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- Prevent duplicate account numbers under the same parent.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX idx_organizations_parent_account_number
  ON organizations (parent_id, account_number)
  WHERE account_number IS NOT NULL AND is_deleted = false;

-- ─────────────────────────────────────────────────────────────
-- Providers may belong to multiple organizations (many-to-many),
-- on top of the primary hierarchy placement in organizations.parent_id.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE provider_organizations (
  provider_id      UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, organization_id)
);
