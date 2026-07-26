-- Status Alerts: platform-wide or org-scoped banners with one-time or
-- recurring (day-of-week + daily time range) activation windows.
-- is_currently_active is maintained by a periodic scheduler
-- (lib/statusAlertScheduler.js), not computed on every read, so the public
-- external-display endpoint can stay a cheap indexed lookup.

CREATE TYPE status_alert_type AS ENUM ('one_time', 'recurring');

CREATE TABLE status_alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message               TEXT NOT NULL CHECK (char_length(message) <= 120),
  organization_id       UUID REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = all organizations
  alert_type            status_alert_type NOT NULL DEFAULT 'one_time',

  start_at              TIMESTAMPTZ,  -- one_time window
  end_at                TIMESTAMPTZ,

  recurrence_days       INT[],        -- recurring: 0=Sunday..6=Saturday
  recurrence_start_time TIME,
  recurrence_end_time   TIME,
  recurrence_start_date DATE,
  recurrence_end_date   DATE,         -- null = indefinite

  is_enabled            BOOLEAN NOT NULL DEFAULT true,  -- manual kill switch
  is_currently_active   BOOLEAN NOT NULL DEFAULT false, -- maintained by the scheduler
  last_evaluated_at     TIMESTAMPTZ,

  created_by            UUID REFERENCES people(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (alert_type = 'one_time' AND start_at IS NOT NULL AND end_at IS NOT NULL)
    OR (alert_type = 'recurring' AND recurrence_days IS NOT NULL AND array_length(recurrence_days, 1) > 0
        AND recurrence_start_time IS NOT NULL AND recurrence_end_time IS NOT NULL AND recurrence_start_date IS NOT NULL)
  )
);

CREATE INDEX status_alerts_organization_id_idx ON status_alerts(organization_id);
CREATE INDEX status_alerts_is_currently_active_idx ON status_alerts(is_currently_active);
