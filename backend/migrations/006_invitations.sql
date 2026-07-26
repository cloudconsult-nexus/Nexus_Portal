-- Real invitation tracking. Previously invite state was purely inferred from
-- people.login_enabled/is_active plus a stateless JWT with no server-side
-- record — meaning "expired" couldn't be queried, and "revoke" wasn't
-- possible since nothing short-circuited an otherwise-still-valid token.
-- This table is the source of truth: status is checked at accept time
-- (not just the JWT's own exp), so revoking or resending actually takes
-- effect immediately.

CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'revoked');

CREATE TABLE invitations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  organization_id   UUID REFERENCES organizations(id),
  email             TEXT NOT NULL,
  name              TEXT NOT NULL,
  role              TEXT NOT NULL,
  token_hash        TEXT NOT NULL,
  status            invitation_status NOT NULL DEFAULT 'pending',
  invited_by        UUID REFERENCES people(id),
  expires_at        TIMESTAMPTZ NOT NULL,
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX invitations_person_id_idx ON invitations(person_id);
CREATE INDEX invitations_status_idx ON invitations(status);
CREATE INDEX invitations_token_hash_idx ON invitations(token_hash);
