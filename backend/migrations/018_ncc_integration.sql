-- Phase 5.2 (CLAUDE.md "Target spec: TAS Client Portal") — NCC (Nextiva
-- Contact Center, built on Thrio, login.thrio.com) message/customer
-- integration, OUTBOUND direction only (Nexus Portal calling out to NCC to
-- fetch/write messages and customers). This is a different credential and
-- a different direction from the INBOUND on-call-lookup workstream
-- (NCC_API_KEY, middleware/serviceAuth.js, routes/onCall.js) — that one is
-- NCC calling into the Portal with a service key; this one is the Portal
-- calling out to NCC with a human-session Basic-auth login (no service-key
-- option exists yet on this API, per Patrick Hoye/Nextiva engineering).
--
-- Credential scoping — resolved design (open item in the build brief:
-- "we need a place ... to store which org/customer maps to which NCC
-- credentials and domain ... don't hardcode a single set"):
--
-- Thrio logins are per-tenant, and a `token-with-authorities` response
-- carries a tenant-specific `location` domain alongside the token. It's
-- not yet confirmed with Nextiva whether a TAS runs ONE Thrio tenant
-- shared across all its Customers, or whether some Customers have their
-- own separate Thrio tenant. Rather than guess and hardcode either shape,
-- this models both, using the exact fallback pattern already established
-- for branding (CLAUDE.md: "Branding/white-labeling falls back 2 levels:
-- Customer -> TAS-wide tas_settings"):
--   1. A Customer's own row in ncc_org_config, if it has credentials set
--      (a Customer with its own distinct Thrio tenant), OR
--   2. tas_settings' instance-wide NCC credentials (the common case: one
--      Thrio tenant for the whole TAS), OR
--   3. Not configured at all (NCC integration inactive for that Customer).
-- See services/ncc-client/config.js, which implements this resolution
-- order. CONFIRM with Patrick which shape actually matches Nextiva's
-- tenant model before this is relied on for more than the debug pipe.

-- ─────────────────────────────────────────────────────────────
-- TAS-wide default Thrio tenant credentials — the common case. Nullable:
-- a fresh install has NCC integration off until a Global Admin configures
-- it (routes/nccConfig.js), same as CUSTOMER_MESSAGING_URL/NCC_API_KEY
-- being unset today.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE tas_settings ADD COLUMN ncc_username_encrypted TEXT;
ALTER TABLE tas_settings ADD COLUMN ncc_password_encrypted TEXT;
ALTER TABLE tas_settings ADD COLUMN ncc_location_domain TEXT; -- cached from the most recent successful auth; not itself a secret
ALTER TABLE tas_settings ADD COLUMN ncc_last_token_issued_at TIMESTAMPTZ;
ALTER TABLE tas_settings ADD COLUMN ncc_last_token_expires_at TIMESTAMPTZ; -- best-effort estimate; see services/ncc-client/auth.js — Thrio's real TTL is unconfirmed as of this build
ALTER TABLE tas_settings ADD COLUMN ncc_last_auth_error TEXT;
ALTER TABLE tas_settings ADD COLUMN ncc_last_auth_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────
-- Per-Customer NCC config: optional credential override (own Thrio
-- tenant) PLUS the NCC<->Portal customer identity mapping, which every
-- Customer using the integration needs regardless of which credential
-- tier authenticates the calls that create/read it.
--
-- ncc_customer_id is deliberately the same field name/shape the inbound
-- on-call-lookup workstream will eventually need for the same purpose
-- (CLAUDE.md build brief: "this is also what the inbound on-call-lookup
-- workstream depends on -- keep the field consistent across both") --
-- don't rename it per-workstream later without updating both.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE ncc_org_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  -- Encrypted at rest (AES-256-GCM, lib/secretsCrypto.js), NULL unless
  -- this Customer overrides the TAS-wide default with its own tenant.
  ncc_username_encrypted    TEXT,
  ncc_password_encrypted    TEXT,
  ncc_location_domain       TEXT,
  ncc_last_token_issued_at  TIMESTAMPTZ,
  ncc_last_token_expires_at TIMESTAMPTZ,
  ncc_last_auth_error       TEXT,
  ncc_last_auth_at          TIMESTAMPTZ,

  -- NCC's own customer record id for this Portal Customer, once known
  -- (matched to an existing NCC customer, or set after a successful
  -- Create Customer push). NULL until then -- a Customer can have NCC
  -- credentials configured (at either tier) before this is populated.
  ncc_customer_id           TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ncc_org_config_org ON ncc_org_config(organization_id);
