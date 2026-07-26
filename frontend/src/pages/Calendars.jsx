import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, CalendarClock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdmin } from '../lib/roles.js';
import { PageHeader, Card, Button, Input, Field, Select, Table, Modal, ConfirmDialog, LoadingBlock, EmptyState, ErrorBanner, Badge } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

const COVERAGE_LABELS = { '24x7': '24×7', business_hours: 'Business hours', after_hours: 'After hours', custom: 'Custom' };
const EMPTY_FORM = { name: '', organizationId: '', description: '', coverageType: '24x7' };

export default function Calendars() {
  const { user } = useAuth();
  const canEdit = isAdmin(user);

  const [calendars, setCalendars] = useState([]);
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
      const data = await api.get('/calendars');
      setCalendars(data.calendars);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, organizationId: user?.organizationId || '' });
    setModalOpen(true);
  }

  function openEdit(cal) {
    setEditing(cal);
    setForm({ name: cal.name, organizationId: cal.organization_id, description: cal.description || '', coverageType: cal.coverage_type });
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.put(`/calendars/${editing.id}`, form);
      } else {
        await api.post('/calendars', form);
      }
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
      await api.del(`/calendars/${deleteTarget.id}`);
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
      <PageHeader title="Calendars" description="On-call calendars, one per coverage area." actions={canEdit && <Button onClick={openCreate}><Plus size={14} /> New calendar</Button>} />
      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}
        {loading ? <LoadingBlock /> : calendars.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No calendars yet" description="Create a calendar to start scheduling on-call coverage." />
        ) : (
          <Card>
            <Table columns={['Name', 'Coverage', 'Description', { label: '' }]}>
              {calendars.map((cal) => (
                <tr key={cal.id} className="hover:bg-surface">
                  <td className="px-4 py-2.5 font-medium text-ink">
                    <Link to={`/schedule?calendarId=${cal.id}`} className="hover:underline">{cal.name}</Link>
                  </td>
                  <td className="px-4 py-2.5"><Badge>{COVERAGE_LABELS[cal.coverage_type]}</Badge></td>
                  <td className="px-4 py-2.5 text-muted">{cal.description || '—'}</td>
                  <td className="px-4 py-2.5">
                    {canEdit && (
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(cal)} className="p-1.5 rounded hover:bg-white text-muted hover:text-ink"><Pencil size={14} /></button>
                        <button onClick={() => setDeleteTarget(cal)} className="p-1.5 rounded hover:bg-white text-muted hover:text-signal-red"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit calendar' : 'New calendar'}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.name || !form.organizationId}>{editing ? 'Save' : 'Create'}</Button></>}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <Field label="Organization"><OrganizationSelector value={form.organizationId} onChange={(id) => setForm({ ...form, organizationId: id })} /></Field>
          <Field label="Coverage type">
            <Select value={form.coverageType} onChange={(e) => setForm({ ...form, coverageType: e.target.value })}>
              {Object.entries(COVERAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Delete calendar?" message={`This permanently deletes "${deleteTarget?.name}" and all of its shifts.`}
        confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={saving} />
    </div>
  );
}
