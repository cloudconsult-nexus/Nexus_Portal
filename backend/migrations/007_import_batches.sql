-- Bulk import tracking. Row-level state is what makes rollback and the
-- import summary real server-side facts instead of something inferred from
-- a single INSERT transaction: committing an import records exactly which
-- entity each row produced (created_entity_id), so rollback can delete
-- precisely those rows, and the summary is just a count by status.

CREATE TYPE import_batch_status AS ENUM ('validated', 'committed', 'rolled_back');
CREATE TYPE import_row_status AS ENUM ('valid', 'invalid', 'duplicate', 'created', 'failed');
CREATE TYPE import_entity_type AS ENUM ('organization', 'person', 'calendar', 'assignment');

CREATE TABLE import_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       import_entity_type NOT NULL,
  organization_id   UUID REFERENCES organizations(id),
  status            import_batch_status NOT NULL DEFAULT 'validated',
  total_rows        INT NOT NULL DEFAULT 0,
  valid_rows        INT NOT NULL DEFAULT 0,
  invalid_rows      INT NOT NULL DEFAULT 0,
  created_by        UUID REFERENCES people(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at      TIMESTAMPTZ,
  rolled_back_at    TIMESTAMPTZ
);

CREATE TABLE import_batch_rows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number          INT NOT NULL,
  raw_data            JSONB NOT NULL,
  status              import_row_status NOT NULL,
  errors              JSONB NOT NULL DEFAULT '[]',
  created_entity_id   UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX import_batch_rows_batch_id_idx ON import_batch_rows(batch_id);
CREATE INDEX import_batches_organization_id_idx ON import_batches(organization_id);
