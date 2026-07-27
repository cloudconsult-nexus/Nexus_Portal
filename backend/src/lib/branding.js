import pool from '../db/pool.js';
import { resolveAssetUrl } from './storage.js';

const BRANDING_FIELDS = [
  'name_override',
  'tagline',
  'logo_url',
  'favicon_url',
  'primary_color',
  'accent_color',
  'description',
  'message_html',
];

// Per-field inheritance: a Customer falls back to the TAS-wide settings for
// any field it hasn't overridden itself (e.g. keep the TAS's colors while
// setting just its own logo). Two levels only, now that the hierarchy is
// flat (Customer → tas_settings) rather than an arbitrary ancestor chain —
// see migrations/013_tas_customer_model.sql.
export async function getEffectiveBranding(organizationId) {
  const { rows: orgRows } = await pool.query('SELECT * FROM organizations WHERE id = $1', [organizationId]);
  const { rows: tasRows } = await pool.query('SELECT * FROM tas_settings LIMIT 1');
  const chain = [orgRows[0], tasRows[0]].filter(Boolean);

  const effective = {};
  const sourceIds = {};
  for (const field of BRANDING_FIELDS) {
    for (const row of chain) {
      if (row[field] != null) {
        effective[field] = row[field];
        sourceIds[field] = row.id;
        break;
      }
    }
  }
  if (effective.logo_url) effective.logo_url = await resolveAssetUrl(effective.logo_url);
  if (effective.favicon_url) effective.favicon_url = await resolveAssetUrl(effective.favicon_url);
  return { ...effective, sources: sourceIds };
}

// The instance-wide white-label display name used in outbound email (From
// header, subject lines) — same name_override-then-name fallback the UI's
// BrandedHeader uses, suffixed with the product name so a white-labeled
// deployment (e.g. "Pioneer TAS") still identifies itself as running Nexus
// Portal rather than just showing the client's own name.
export async function getProductName() {
  const { rows } = await pool.query('SELECT name, name_override FROM tas_settings LIMIT 1');
  const brand = rows[0]?.name_override || rows[0]?.name;
  return brand ? `${brand} Nexus Portal` : 'Nexus Portal';
}
