-- Lets a Person be linked to additional organizations beyond their primary
-- (people.organization_id, unchanged) — e.g. a technician who covers
-- multiple sites within the same nested Customer hierarchy
-- (organizations.parent_id, migrations/014_organization_hierarchy.sql).
-- Being linked here gives full scheduling reach: the person becomes
-- selectable as Primary/Secondary/Tertiary/Default on any calendar
-- belonging to their primary org OR any org linked here (see
-- routes/assignments.js's org-membership check and routes/people.js's
-- relationship endpoints).
CREATE TABLE person_organizations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES people(id) ON DELETE SET NULL,
  UNIQUE (person_id, organization_id)
);

CREATE INDEX idx_person_organizations_person ON person_organizations(person_id);
CREATE INDEX idx_person_organizations_org ON person_organizations(organization_id);
