import { useEffect, useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { PageHeader, Card, Button, Input, Field, Table, Badge, Modal, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';

const STATUS_TONE = { SUCCESSFUL: 'green', FAILED: 'red', RUNNING: 'amber', ENQUEUED: 'neutral' };

// Global-admin-only: on-demand Cloud SQL backups + restore-to-new-instance,
// via routes/backups.js. Restore never touches the live database — it
// clones to a brand-new instance and hands back its name, which an
// operator then finishes cutting over to manually (see RUNBOOK.md). That's
// deliberate: a single click here provisions infra, it doesn't silently
// replace live data.
export default function Backups() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [destinationName, setDestinationName] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get('/backups');
      setBackups(data.backups);
    } catch (err) {
      if (err.status === 501) setUnavailable(true);
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    setCreating(true);
    setError('');
    try {
      await api.post('/backups', {});
      // The backup completes asynchronously (usually a minute or two) —
      // refresh now so the ENQUEUED/RUNNING row shows up, but it won't be
      // SUCCESSFUL yet.
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function openRestore(backup) {
    setRestoreTarget(backup);
    setDestinationName('');
    setConfirmText('');
    setRestoreResult(null);
  }

  async function handleRestore() {
    setRestoring(true);
    setError('');
    try {
      const data = await api.post(`/backups/${restoreTarget.id}/restore`, { destinationInstanceName: destinationName });
      setRestoreResult(data.operation);
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoring(false);
    }
  }

  const restoreConfirmed = confirmText === destinationName && destinationName.length > 0;

  if (unavailable) {
    return (
      <div>
        <PageHeader title="Backups" description="On-demand database backups and restore." />
        <div className="p-8">
          <EmptyState title="Not available in this environment" description="Backups only work when deployed on Cloud Run with a Cloud SQL instance attached — there's nothing to back up in local development." />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Backups" description="On-demand snapshots of the database, on top of the automatic daily backups Cloud SQL already keeps."
        actions={<Button onClick={handleCreate} loading={creating}><Plus size={14} /> Create backup now</Button>} />

      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}
        {loading ? <LoadingBlock /> : backups.length === 0 ? (
          <EmptyState title="No backups yet" description="Automatic backups run daily even before you create one manually — this list will fill in over time." />
        ) : (
          <Card>
            <Table columns={['Started', 'Type', 'Status', 'Description', { label: '' }]}>
              {backups.map((b) => (
                <tr key={b.id} className="hover:bg-surface">
                  <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">{new Date(b.startTime || b.enqueuedTime).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{b.type === 'ON_DEMAND' ? 'Manual' : 'Automatic'}</td>
                  <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[b.status] || 'neutral'}>{b.status}</Badge></td>
                  <td className="px-4 py-2.5 text-xs text-muted">{b.description || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end">
                      <Button variant="secondary" size="sm" disabled={b.status !== 'SUCCESSFUL'} onClick={() => openRestore(b)}>
                        <RotateCcw size={13} /> Restore
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>

      <Modal
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        title="Restore to a new instance"
        footer={
          !restoreResult && (
            <>
              <Button variant="secondary" onClick={() => setRestoreTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleRestore} loading={restoring} disabled={!restoreConfirmed}>
                Start restore
              </Button>
            </>
          )
        }
      >
        {restoreResult ? (
          <div className="space-y-3 text-sm">
            <ErrorBanner tone="amber" message={`Restore started — Cloud SQL is now cloning to a new instance named "${destinationName}". This takes several minutes and does not affect the live database.`} />
            <p className="text-muted">
              Once the new instance shows as ready (<code className="text-xs bg-surface px-1 py-0.5 rounded">gcloud sql instances describe {destinationName}</code>), an operator
              still needs to deliberately cut the app over to it — this doesn't happen automatically. See RUNBOOK.md's "Database backup & restore" section for the cutover steps.
            </p>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <ErrorBanner tone="amber" message="This provisions a brand-new, billable Cloud SQL instance from this backup. The live database is never touched — but this is not a lightweight action, and there's no undo for the new instance's cost/existence once started." />
            <Field label="New instance name" hint="Lowercase letters, digits, and hyphens only, starting with a letter.">
              <Input value={destinationName} onChange={(e) => setDestinationName(e.target.value)} placeholder="oncall-pro-prod-pg-restored" autoFocus />
            </Field>
            <Field label={`Type "${destinationName}" to confirm`}>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} disabled={!destinationName} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
