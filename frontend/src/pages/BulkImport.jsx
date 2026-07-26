import { useState } from 'react';
import { Download, Upload, CheckCircle2, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { PageHeader, Card, Button, Field, Select, Table, Badge, LoadingBlock, ErrorBanner } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

const ENTITY_TYPES = [
  { value: 'organization', label: 'Organizations' },
  { value: 'person', label: 'People' },
  { value: 'calendar', label: 'Calendars' },
  { value: 'assignment', label: 'Schedule assignments' },
];

const ROW_STATUS_TONE = { valid: 'green', invalid: 'red', created: 'green', failed: 'red' };

export default function BulkImport() {
  const [entityType, setEntityType] = useState('person');
  const [action, setAction] = useState('create');
  const [organizationId, setOrganizationId] = useState(null);
  const [file, setFile] = useState(null);
  const [batch, setBatch] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function downloadTemplate() {
    try {
      const csv = await api.getText(`/imports/template/${entityType}`);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entityType}-template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleValidate() {
    if (!file) return;
    setLoading(true);
    setError('');
    setBatch(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('entityType', entityType);
      form.append('action', action);
      if (organizationId) form.append('organizationId', organizationId);
      const result = await api.upload('/imports/validate', form);
      setBatch({ id: result.batchId, status: 'validated', ...result });
      const detail = await api.get(`/imports/${result.batchId}`);
      setRows(detail.rows);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    setLoading(true);
    setError('');
    try {
      await api.post(`/imports/${batch.id}/commit`);
      const detail = await api.get(`/imports/${batch.id}`);
      setBatch(detail.batch);
      setRows(detail.rows);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRollback() {
    setLoading(true);
    setError('');
    try {
      await api.post(`/imports/${batch.id}/rollback`);
      const detail = await api.get(`/imports/${batch.id}`);
      setBatch(detail.batch);
      setRows(detail.rows);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="Bulk Import" description="Upload a CSV to create organizations, people, calendars, or schedule assignments in bulk." />
      <div className="p-8 max-w-3xl space-y-6">
        {error && <ErrorBanner message={error} />}

        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Entity type">
              <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setBatch(null); setRows([]); }}>
                {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            {entityType === 'assignment' && (
              <Field label="Action">
                <Select value={action} onChange={(e) => setAction(e.target.value)}>
                  <option value="create">Create</option>
                  <option value="update">Update</option>
                  <option value="delete">Delete</option>
                </Select>
              </Field>
            )}
            <Field label="Organization (optional scope)">
              <OrganizationSelector value={organizationId} onChange={setOrganizationId} />
            </Field>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={downloadTemplate}><Download size={14} /> Download CSV template</Button>
            <label className="inline-flex items-center gap-1.5 text-sm text-ink cursor-pointer hover:underline">
              <Upload size={14} /> {file ? file.name : 'Choose CSV file…'}
              <input type="file" accept=".csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </div>

          <Button onClick={handleValidate} loading={loading} disabled={!file}>Validate</Button>
        </Card>

        {loading && !batch && <LoadingBlock label="Validating…" />}

        {batch && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">{batch.totalRows ?? rows.length} rows</h3>
                <Badge tone="green">{batch.validRows ?? rows.filter((r) => r.status === 'valid' || r.status === 'created').length} valid</Badge>
                <Badge tone="red">{batch.invalidRows ?? rows.filter((r) => r.status === 'invalid').length} invalid</Badge>
                <Badge tone={batch.status === 'committed' ? 'green' : 'neutral'}>{batch.status}</Badge>
              </div>
              <div className="flex gap-2">
                {(batch.status === 'validated') && (
                  <Button onClick={handleCommit} loading={loading}><CheckCircle2 size={14} /> Commit</Button>
                )}
                {batch.status === 'committed' && (
                  <Button variant="secondary" onClick={handleRollback} loading={loading}><RotateCcw size={14} /> Roll back</Button>
                )}
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              <Table columns={['#', 'Status', 'Data', 'Errors']}>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-xs text-muted">{r.row_number}</td>
                    <td className="px-4 py-2"><Badge tone={ROW_STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge></td>
                    <td className="px-4 py-2 text-xs font-mono text-muted max-w-xs truncate">{JSON.stringify(r.raw_data)}</td>
                    <td className="px-4 py-2 text-xs text-signal-red">{(r.errors || []).join(', ')}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
