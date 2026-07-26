import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Radio, AlertCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isGlobalAdmin } from '../lib/roles.js';
import { PageHeader, Card, Button, Input, Field, Select, Textarea, Checkbox, Table, Badge, Modal, ConfirmDialog, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EMPTY_FORM = {
  message: '', organizationId: null, alertType: 'one_time', startAt: '', endAt: '',
  recurrenceDays: [], recurrenceStartTime: '09:00', recurrenceEndTime: '17:00',
  recurrenceStartDate: '', recurrenceEndDate: '', isEnabled: true,
};

export default function StatusAlerts() {
  const { user } = useAuth();
  const canManage = isGlobalAdmin(user);

  const [active, setActive] = useState([]);
  const [all, setAll] = useState(null);
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
      const activeData = await api.get('/status-alerts/active');
      setActive(activeData.activeAlerts);
      if (canManage) {
        const allData = await api.get('/status-alerts');
        setAll(allData.statusAlerts);
      }
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

  function openEdit(alert) {
    setEditing(alert);
    setForm({
      message: alert.message, organizationId: alert.organization_id, alertType: alert.alert_type,
      startAt: alert.start_at ? alert.start_at.slice(0, 16) : '', endAt: alert.end_at ? alert.end_at.slice(0, 16) : '',
      recurrenceDays: alert.recurrence_days || [], recurrenceStartTime: alert.recurrence_start_time?.slice(0, 5) || '09:00',
      recurrenceEndTime: alert.recurrence_end_time?.slice(0, 5) || '17:00',
      recurrenceStartDate: alert.recurrence_start_date || '', recurrenceEndDate: alert.recurrence_end_date || '',
      isEnabled: alert.is_enabled,
    });
    setModalOpen(true);
  }

  function toggleDay(day) {
    setForm((f) => ({ ...f, recurrenceDays: f.recurrenceDays.includes(day) ? f.recurrenceDays.filter((d) => d !== day) : [...f.recurrenceDays, day] }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (editing) await api.put(`/status-alerts/${editing.id}`, form);
      else await api.post('/status-alerts', form);
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
      await api.del(`/status-alerts/${deleteTarget.id}`);
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
      <PageHeader title="Status Alerts" description="Platform and organization banners for planned or ongoing events."
        actions={canManage && <Button onClick={openCreate}><Plus size={14} /> New alert</Button>} />

      <div className="p-8 space-y-6">
        {error && <ErrorBanner message={error} />}

        <div>
          <h3 className="text-sm font-semibold text-ink mb-2">Currently active</h3>
          {loading ? <LoadingBlock /> : active.length === 0 ? (
            <p className="text-sm text-muted">No active alerts right now.</p>
          ) : (
            <div className="space-y-2">
              {active.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-signal-amber/30 bg-signal-amber/5 px-3 py-2 text-sm text-amber-800">
                  <AlertCircle size={15} className="shrink-0" /> {a.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {canManage && (
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">All alerts</h3>
            {!all ? <LoadingBlock /> : all.length === 0 ? (
              <EmptyState icon={Radio} title="No alerts configured" />
            ) : (
              <Card>
                <Table columns={['Message', 'Type', 'Scope', 'Live now', 'Enabled', { label: '' }]}>
                  {all.map((a) => (
                    <tr key={a.id} className="hover:bg-surface">
                      <td className="px-4 py-2.5 text-ink">{a.message}</td>
                      <td className="px-4 py-2.5 text-muted capitalize">{a.alert_type.replace('_', ' ')}</td>
                      <td className="px-4 py-2.5 text-muted">{a.organization_id ? 'Organization' : 'Platform-wide'}</td>
                      <td className="px-4 py-2.5">{a.is_currently_active ? <Badge tone="green">Live</Badge> : <Badge tone="neutral">—</Badge>}</td>
                      <td className="px-4 py-2.5">{a.is_enabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(a)} className="p-1.5 rounded hover:bg-white text-muted hover:text-ink"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteTarget(a)} className="p-1.5 rounded hover:bg-white text-muted hover:text-signal-red"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit alert' : 'New alert'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.message}>{editing ? 'Save' : 'Create'}</Button></>}>
        <div className="space-y-4">
          <Field label="Message"><Textarea rows={2} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} autoFocus /></Field>
          <Field label="Scope" hint="Leave blank for a platform-wide banner">
            <OrganizationSelector value={form.organizationId} onChange={(id) => setForm({ ...form, organizationId: id })} placeholder="Platform-wide" />
          </Field>
          <Field label="Type">
            <Select value={form.alertType} onChange={(e) => setForm({ ...form, alertType: e.target.value })}>
              <option value="one_time">One-time window</option>
              <option value="recurring">Recurring schedule</option>
            </Select>
          </Field>

          {form.alertType === 'one_time' ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Starts"><Input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></Field>
              <Field label="Ends"><Input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></Field>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Days of week">
                <div className="flex gap-1.5">
                  {WEEKDAYS.map((label, i) => (
                    <button key={i} type="button" onClick={() => toggleDay(i)}
                      className={`h-8 w-8 rounded-full text-xs border ${form.recurrenceDays.includes(i) ? 'bg-ink text-white border-ink' : 'border-line text-ink hover:bg-surface'}`}>
                      {label[0]}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Daily start time"><Input type="time" value={form.recurrenceStartTime} onChange={(e) => setForm({ ...form, recurrenceStartTime: e.target.value })} /></Field>
                <Field label="Daily end time"><Input type="time" value={form.recurrenceEndTime} onChange={(e) => setForm({ ...form, recurrenceEndTime: e.target.value })} /></Field>
                <Field label="From date"><Input type="date" value={form.recurrenceStartDate} onChange={(e) => setForm({ ...form, recurrenceStartDate: e.target.value })} /></Field>
                <Field label="Until date"><Input type="date" value={form.recurrenceEndDate} onChange={(e) => setForm({ ...form, recurrenceEndDate: e.target.value })} /></Field>
              </div>
            </div>
          )}

          <Checkbox label="Enabled" checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Delete alert?" message="This removes the alert immediately." confirmLabel="Delete"
        onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={saving} />
    </div>
  );
}
