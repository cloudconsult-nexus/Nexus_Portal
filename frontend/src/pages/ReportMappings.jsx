import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_LABELS } from '../lib/roles.js';
import { PageHeader, Card, Button, Input, Field, Checkbox, Table, Badge, Modal, ConfirmDialog, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';

const ROLES = ['global_admin', 'customer_admin', 'user'];
const EMPTY_FORM = { name: '', description: '', embedUrl: '', ssoEnabled: false, ssoSharedSecret: '', tokenParam: 'token', visibleToRoles: ['global_admin'], sortOrder: 0 };

// Global-admin-only admin screen for the report catalog (routes/reportMappings.js)
// — the embedded-report *consumption* side lives in NexusReports.jsx / OnCallReports.jsx.
export default function ReportMappings() {
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/report-mappings');
      setMappings(data.reportMappings);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(m) {
    setEditing(m);
    setForm({
      name: m.name, description: m.description || '', embedUrl: m.embed_url, ssoEnabled: m.sso_enabled,
      ssoSharedSecret: '', tokenParam: m.token_param, visibleToRoles: m.visible_to_roles, sortOrder: m.sort_order,
    });
    setModalOpen(true);
  }

  function toggleRole(role) {
    setForm((f) => ({ ...f, visibleToRoles: f.visibleToRoles.includes(role) ? f.visibleToRoles.filter((r) => r !== role) : [...f.visibleToRoles, role] }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.ssoSharedSecret) delete payload.ssoSharedSecret;
      if (editing) await api.put(`/report-mappings/${editing.id}`, payload);
      else await api.post('/report-mappings', payload);
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await api.del(`/report-mappings/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Report Mappings" description="Configure which embedded reports appear on the Reports pages, and for whom."
        actions={<Button onClick={openCreate}><Plus size={14} /> Add report</Button>} />
      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}
        {loading ? <LoadingBlock /> : mappings.length === 0 ? <EmptyState title="No reports configured" /> : (
          <Card>
            <Table columns={['Name', 'Visible to', 'SSO', 'Status', { label: '' }]}>
              {mappings.map((m) => (
                <tr key={m.id} className="hover:bg-surface">
                  <td className="px-4 py-2.5 font-medium text-ink">{m.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{m.visible_to_roles.map((r) => ROLE_LABELS[r]).join(', ')}</td>
                  <td className="px-4 py-2.5">{m.sso_enabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="neutral">Off</Badge>}</td>
                  <td className="px-4 py-2.5">{m.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(m)} className="p-1.5 rounded hover:bg-white text-muted hover:text-ink"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteTarget(m)} className="p-1.5 rounded hover:bg-white text-muted hover:text-signal-red"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit report' : 'Add report'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.name || !form.embedUrl}>{editing ? 'Save' : 'Create'}</Button></>}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Embed URL"><Input value={form.embedUrl} onChange={(e) => setForm({ ...form, embedUrl: e.target.value })} placeholder="https://…" /></Field>
          <Checkbox label="Sign requests with SSO token" checked={form.ssoEnabled} onChange={(e) => setForm({ ...form, ssoEnabled: e.target.checked })} />
          {form.ssoEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Shared secret" hint={editing ? 'Leave blank to keep the existing secret' : undefined}>
                <Input type="password" value={form.ssoSharedSecret} onChange={(e) => setForm({ ...form, ssoSharedSecret: e.target.value })} />
              </Field>
              <Field label="Token query param"><Input value={form.tokenParam} onChange={(e) => setForm({ ...form, tokenParam: e.target.value })} /></Field>
            </div>
          )}
          <Field label="Visible to roles">
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button key={r} type="button" onClick={() => toggleRole(r)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${form.visibleToRoles.includes(r) ? 'bg-ink text-white border-ink' : 'border-line text-ink hover:bg-surface'}`}>
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Sort order"><Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Delete report?" message={`This removes "${deleteTarget?.name}" from every role's Reports page.`}
        confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={saving} />
    </div>
  );
}
