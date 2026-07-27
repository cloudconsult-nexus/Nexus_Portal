import { Fragment, useEffect, useState } from 'react';
import { Download, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { exportTableToPdf } from '../lib/pdfExport.js';
import { PageHeader, Card, Button, Input, Field, Select, Table, Badge, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';

const ACTION_TONE = { create: 'green', update: 'blue', delete: 'red', move: 'amber', restore: 'green', role_change: 'amber', set_password: 'amber', login: 'neutral', logout: 'neutral', view: 'neutral' };
const ENTITY_TYPES = ['organization', 'person', 'calendar', 'assignment', 'shift_swap_request', 'status_alert', 'report_mapping', 'import_batch', 'invitation'];

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [filters, setFilters] = useState({ entityType: '', action: '', from: '', to: '' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filters.entityType) params.set('entityType', filters.entityType);
      if (filters.action) params.set('action', filters.action);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const data = await api.get(`/audit-logs?${params.toString()}`);
      setLogs(data.auditLogs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filters.entityType, filters.action, filters.from, filters.to]);

  function handleExport() {
    exportTableToPdf({
      title: 'Audit Log',
      subtitle: new Date().toLocaleString(),
      columns: ['When', 'User', 'Action', 'Entity', 'Name'],
      rows: logs.map((l) => [new Date(l.created_at).toLocaleString(), l.user_email, l.action, l.entity_type, l.entity_name || '']),
      filename: 'audit-log',
    });
  }

  return (
    <div>
      <PageHeader title="Audit Logs" description="Every create, update, delete, move, and role change across the platform."
        actions={<Button variant="secondary" onClick={handleExport} disabled={logs.length === 0}><Download size={14} /> Export PDF</Button>} />

      <div className="p-8 space-y-4">
        <Card className="p-4 grid grid-cols-4 gap-4">
          <Field label="Entity type">
            <Select value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
              <option value="">All</option>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Action">
            <Select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
              <option value="">All</option>
              {['create', 'update', 'delete', 'move', 'restore', 'role_change', 'set_password', 'login', 'logout', 'view'].map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
        </Card>

        {error && <ErrorBanner message={error} />}
        {loading ? <LoadingBlock /> : logs.length === 0 ? <EmptyState title="No matching audit events" /> : (
          <Card>
            <Table columns={['When', 'User', 'Action', 'Entity', 'Name', { label: '' }]}>
              {logs.map((l) => (
                <Fragment key={l.id}>
                  <tr className="hover:bg-surface cursor-pointer" onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                    <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-ink">{l.user_email}</td>
                    <td className="px-4 py-2.5"><Badge tone={ACTION_TONE[l.action] || 'neutral'}>{l.action}</Badge></td>
                    <td className="px-4 py-2.5 text-muted">{l.entity_type}</td>
                    <td className="px-4 py-2.5 text-ink">{l.entity_name || '—'}</td>
                    <td className="px-4 py-2.5 text-muted">{(l.old_values || l.new_values) && (expandedId === l.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}</td>
                  </tr>
                  {expandedId === l.id && (l.old_values || l.new_values) && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 bg-surface">
                        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                          {l.old_values && <div><p className="text-muted mb-1">Before</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(l.old_values, null, 2)}</pre></div>}
                          {l.new_values && <div><p className="text-muted mb-1">After</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(l.new_values, null, 2)}</pre></div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
