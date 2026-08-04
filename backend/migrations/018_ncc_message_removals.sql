-- Tracks messages hidden from the portal's Customer Messages view without
-- ever touching the underlying NCC (Thrio) record — NCC stays the source of
-- truth, this is purely "don't show me this one again" state on our side.
-- workitem_id is Thrio's own id (e.g. "CAa2ff644a3d61b0690948ff194903171e"),
-- not a foreign key to anything in our schema — Thrio is external.
CREATE TABLE ncc_message_removals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workitem_id  TEXT NOT NULL UNIQUE,
  removed_by   UUID REFERENCES people(id) ON DELETE SET NULL,
  removed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
