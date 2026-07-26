-- Reporting integration framework: a platform-wide catalog of embedded
-- external dashboards (Looker/Metabase/Power BI/Tableau/etc.), each tagged
-- with which roles may see it. Not org-scoped like branding — one catalog,
-- filtered by role, matching the Reports page's existing shape.

CREATE TABLE report_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  embed_url         TEXT NOT NULL,
  sso_enabled       BOOLEAN NOT NULL DEFAULT false,
  sso_shared_secret TEXT,
  token_param       TEXT NOT NULL DEFAULT 'token',
  visible_to_roles  TEXT[] NOT NULL DEFAULT ARRAY['global_admin'],
  sort_order        INT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID REFERENCES people(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
