import { google } from 'googleapis';

// Wraps the Cloud SQL Admin API (distinct from the app's own Postgres
// connection in db/pool.js, which never touches this — that's a plain `pg`
// connection over the Cloud SQL unix socket). This is only meaningful on
// Cloud Run: project/region/instance are parsed from INSTANCE_CONNECTION_NAME
// (same env var pool.js uses), and auth relies on the Cloud Run service
// account's Application Default Credentials — see infra/iam.tf's
// api_cloudsql_admin grant for the role this needs.
//
// Local dev has no Cloud SQL instance (see README's "Local development"),
// so every export here throws a clear "not available" error when
// INSTANCE_CONNECTION_NAME is unset rather than failing on a confusing auth
// error — routes/backups.js turns that into a 501.

function parseConnectionName() {
  const conn = process.env.INSTANCE_CONNECTION_NAME;
  if (!conn) return null;
  const [project, region, instance] = conn.split(':');
  if (!project || !region || !instance) return null;
  return { project, region, instance };
}

let sqladminClient = null;
async function getClient() {
  // On Cloud Run, ADC comes from the metadata server, which only ever
  // issues tokens for the broad 'cloud-platform' scope for the attached
  // service account — requesting a narrower scope like sqlservice.admin
  // here fails at the auth layer ("client is not authorized to make this
  // request") before the Cloud SQL API is ever called. IAM (see
  // infra/iam.tf's api_cloudsql_editor grant) is what actually restricts
  // what the token can do; the scope is just which token gets minted.
  sqladminClient ??= google.sqladmin({
    version: 'v1beta4',
    auth: new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
  });
  return sqladminClient;
}

export function isConfigured() {
  return parseConnectionName() !== null;
}

// Newest first — the Admin API doesn't guarantee order, so sort explicitly.
export async function listBackups() {
  const target = parseConnectionName();
  if (!target) throw new Error('Cloud SQL not configured (no INSTANCE_CONNECTION_NAME) — this feature only runs on Cloud Run.');
  const sqladmin = await getClient();
  const { data } = await sqladmin.backupRuns.list({ project: target.project, instance: target.instance });
  return (data.items || [])
    .map((b) => ({
      id: b.id,
      status: b.status,
      type: b.type, // AUTOMATED | ON_DEMAND
      startTime: b.startTime,
      endTime: b.endTime,
      enqueuedTime: b.enqueuedTime,
      description: b.description || null,
    }))
    .sort((a, b) => new Date(b.enqueuedTime) - new Date(a.enqueuedTime));
}

export async function createBackup({ description }) {
  const target = parseConnectionName();
  if (!target) throw new Error('Cloud SQL not configured (no INSTANCE_CONNECTION_NAME) — this feature only runs on Cloud Run.');
  const sqladmin = await getClient();
  const { data } = await sqladmin.backupRuns.insert({
    project: target.project,
    instance: target.instance,
    requestBody: { description: description || 'Triggered from OnCall Pro admin UI' },
  });
  return data; // Operation — backup itself completes asynchronously.
}

async function getBackup(backupId) {
  const target = parseConnectionName();
  const sqladmin = await getClient();
  const { data } = await sqladmin.backupRuns.get({ project: target.project, instance: target.instance, id: backupId });
  return data;
}

// Clones the live instance to a brand-new instance at the given backup's
// completion time — deliberately never restores in place onto the running
// instance (RUNBOOK.md's "Database backup & restore" policy: a restore is
// destructive and unrecoverable, so it always lands on a new instance that
// an operator then cuts the app over to deliberately, rather than silently
// replacing live data from a single click).
export async function restoreToNewInstance({ backupId, destinationInstanceName }) {
  const target = parseConnectionName();
  if (!target) throw new Error('Cloud SQL not configured (no INSTANCE_CONNECTION_NAME) — this feature only runs on Cloud Run.');
  const backup = await getBackup(backupId);
  if (!backup.endTime) throw new Error('Backup has not finished yet — wait for it to complete before restoring from it.');

  const sqladmin = await getClient();
  const { data } = await sqladmin.instances.clone({
    project: target.project,
    instance: target.instance,
    requestBody: {
      cloneContext: {
        destinationInstanceName,
        pointInTime: backup.endTime,
      },
    },
  });
  return data; // Operation — the new instance takes several minutes to appear.
}
