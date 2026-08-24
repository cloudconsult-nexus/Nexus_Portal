import pool from '../../db/pool.js';
import { encryptSecret, decryptSecret } from '../../lib/secretsCrypto.js';

// Resolves + persists NCC (Thrio) credentials and per-Customer bookkeeping.
// See migrations/018_ncc_integration.sql for the two-tier fallback this
// implements (Customer override -> TAS-wide default -> not configured) and
// the reasoning behind it — that tiering is an open question for Nextiva
// to confirm, not a settled requirement, so keep this the ONE place that
// resolution order lives rather than re-implementing it elsewhere.

// Real DB errors (e.g. unreachable Postgres) should propagate; this is
// only used to turn a `undefined`/`null` field into "not configured" here.
function hasCreds(row) {
  return !!(row && row.ncc_username_encrypted && row.ncc_password_encrypted);
}

function decryptRow(row) {
  return {
    username: decryptSecret(row.ncc_username_encrypted),
    password: decryptSecret(row.ncc_password_encrypted),
    locationDomain: row.ncc_location_domain || null,
  };
}

// Returns null if NCC integration isn't configured for this Customer at
// either tier. Otherwise: { scope, organizationId, username, password,
// locationDomain, nccCustomerId }. `scope` + `organizationId` (org scope
// only) are what auth.js keys its token cache on and what config.js's own
// record*/set* functions below need to know where to write back to.
export async function resolveNccCredentials(organizationId) {
  const { rows: orgRows } = await pool.query(
    `SELECT ncc_username_encrypted, ncc_password_encrypted, ncc_location_domain, ncc_customer_id
     FROM ncc_org_config WHERE organization_id = $1`,
    [organizationId]
  );
  const orgRow = orgRows[0];
  if (hasCreds(orgRow)) {
    return { scope: 'organization', organizationId, nccCustomerId: orgRow.ncc_customer_id || null, ...decryptRow(orgRow) };
  }

  const { rows: tasRows } = await pool.query(
    `SELECT ncc_username_encrypted, ncc_password_encrypted, ncc_location_domain FROM tas_settings LIMIT 1`
  );
  const tasRow = tasRows[0];
  if (hasCreds(tasRow)) {
    // nccCustomerId is always per-Customer, even when auth falls back to
    // the TAS-wide credential tier — it's a separate lookup here since it
    // only ever lives on ncc_org_config (see migration comment).
    return {
      scope: 'tas_settings',
      organizationId,
      nccCustomerId: orgRow?.ncc_customer_id || null,
      ...decryptRow(tasRow),
    };
  }

  return null;
}

// Non-secret status for the debug/config routes — never includes the
// decrypted username/password.
export async function getNccStatus(organizationId) {
  const { rows: orgRows } = await pool.query(
    `SELECT (ncc_username_encrypted IS NOT NULL) AS has_override,
            ncc_location_domain, ncc_customer_id, ncc_last_auth_at, ncc_last_auth_error,
            ncc_last_token_issued_at, ncc_last_token_expires_at
     FROM ncc_org_config WHERE organization_id = $1`,
    [organizationId]
  );
  const { rows: tasRows } = await pool.query(
    `SELECT (ncc_username_encrypted IS NOT NULL) AS has_default,
            ncc_location_domain, ncc_last_auth_at, ncc_last_auth_error,
            ncc_last_token_issued_at, ncc_last_token_expires_at
     FROM tas_settings LIMIT 1`
  );
  const org = orgRows[0];
  const tas = tasRows[0];
  const configuredScope = org?.has_override ? 'organization' : tas?.has_default ? 'tas_settings' : null;
  const active = configuredScope === 'organization' ? org : configuredScope === 'tas_settings' ? tas : null;

  return {
    configured: !!configuredScope,
    scope: configuredScope,
    nccCustomerId: org?.ncc_customer_id || null,
    locationDomain: active?.ncc_location_domain || null,
    lastAuthAt: active?.ncc_last_auth_at || null,
    lastAuthError: active?.ncc_last_auth_error || null,
    lastTokenIssuedAt: active?.ncc_last_token_issued_at || null,
    lastTokenExpiresAt: active?.ncc_last_token_expires_at || null,
  };
}

export async function upsertOrganizationCredentials(organizationId, { username, password }) {
  await pool.query(
    `INSERT INTO ncc_org_config (organization_id, ncc_username_encrypted, ncc_password_encrypted, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (organization_id) DO UPDATE SET
       ncc_username_encrypted = EXCLUDED.ncc_username_encrypted,
       ncc_password_encrypted = EXCLUDED.ncc_password_encrypted,
       -- A new credential set means any cached location/error from the old
       -- one is no longer meaningful — force a fresh auth to re-learn it.
       ncc_location_domain = NULL,
       ncc_last_auth_error = NULL,
       updated_at = now()`,
    [organizationId, encryptSecret(username), encryptSecret(password)]
  );
}

export async function clearOrganizationCredentials(organizationId) {
  await pool.query(
    `UPDATE ncc_org_config SET ncc_username_encrypted = NULL, ncc_password_encrypted = NULL,
       ncc_location_domain = NULL, ncc_last_auth_error = NULL, updated_at = now()
     WHERE organization_id = $1`,
    [organizationId]
  );
}

export async function upsertTasCredentials({ username, password }) {
  await pool.query(
    `UPDATE tas_settings SET ncc_username_encrypted = $1, ncc_password_encrypted = $2,
       ncc_location_domain = NULL, ncc_last_auth_error = NULL, updated_at = now()`,
    [encryptSecret(username), encryptSecret(password)]
  );
}

export async function clearTasCredentials() {
  await pool.query(
    `UPDATE tas_settings SET ncc_username_encrypted = NULL, ncc_password_encrypted = NULL,
       ncc_location_domain = NULL, ncc_last_auth_error = NULL, updated_at = now()`
  );
}

// organizationId is only meaningful (and only used) for scope === 'organization';
// the TAS-wide row has no organization_id to key on.
export async function recordAuthSuccess({ scope, organizationId, locationDomain, issuedAt, expiresAt }) {
  if (scope === 'organization') {
    await pool.query(
      `UPDATE ncc_org_config SET ncc_location_domain = $1, ncc_last_token_issued_at = $2,
         ncc_last_token_expires_at = $3, ncc_last_auth_at = now(), ncc_last_auth_error = NULL
       WHERE organization_id = $4`,
      [locationDomain, issuedAt, expiresAt, organizationId]
    );
  } else {
    await pool.query(
      `UPDATE tas_settings SET ncc_location_domain = $1, ncc_last_token_issued_at = $2,
         ncc_last_token_expires_at = $3, ncc_last_auth_at = now(), ncc_last_auth_error = NULL`,
      [locationDomain, issuedAt, expiresAt]
    );
  }
}

export async function recordAuthFailure({ scope, organizationId, error }) {
  if (scope === 'organization') {
    await pool.query(
      `UPDATE ncc_org_config SET ncc_last_auth_at = now(), ncc_last_auth_error = $1 WHERE organization_id = $2`,
      [error, organizationId]
    );
  } else {
    await pool.query(`UPDATE tas_settings SET ncc_last_auth_at = now(), ncc_last_auth_error = $1`, [error]);
  }
}

// Written back after a successful Create Customer push, or once an
// existing NCC customer is manually matched to this Portal Customer.
// Always lives on ncc_org_config, even when auth itself uses the TAS-wide
// credential tier — see migration comment.
export async function setNccCustomerId(organizationId, nccCustomerId) {
  await pool.query(
    `INSERT INTO ncc_org_config (organization_id, ncc_customer_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (organization_id) DO UPDATE SET ncc_customer_id = EXCLUDED.ncc_customer_id, updated_at = now()`,
    [organizationId, nccCustomerId]
  );
}
