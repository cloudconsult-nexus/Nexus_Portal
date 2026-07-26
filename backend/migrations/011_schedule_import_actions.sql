-- Schedule (assignment) bulk import gains update/delete alongside the
-- existing create-only flow. old_values snapshots the pre-image for
-- update/delete rows — populated at validate time for the preview diff,
-- refreshed at commit time for accurate rollback — mirroring the
-- old_values/new_values shape audit_logs already uses.

ALTER TYPE import_row_status ADD VALUE IF NOT EXISTS 'updated';
ALTER TYPE import_row_status ADD VALUE IF NOT EXISTS 'deleted';

CREATE TYPE import_batch_action AS ENUM ('create', 'update', 'delete');
ALTER TABLE import_batches ADD COLUMN action import_batch_action NOT NULL DEFAULT 'create';
ALTER TABLE import_batch_rows ADD COLUMN old_values JSONB;
