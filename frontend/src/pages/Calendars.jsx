import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, CalendarClock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdmin } from '../lib/roles.js';
import { PageHeader, Card, Button, Input, Field, Select, Table, Modal, ConfirmDialog, LoadingBlock, EmptyState, ErrorBanner, Badge } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

const COVERAGE_LABELS = { '24x7': '24×7', business_hours: 'Business hours', after_hours: 'After hours', custom: 'Custom' };
const EMPTY_FORM = { name: '', organizationId: '', description: '', coverageType: '24x7', defaultPersonId: '' };

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
  const [viewOrgId, setViewOrgId] = useState(null);
  const [assignablePeople, setAssignablePeople] = useState([]);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get(viewOrgId ? `/calendars?organizationId=${viewOrgId}` : '/calendars');
      setCalendars(data.calendars);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [viewOrgId]);

  // Same "who's eligible for this Customer" pool the shift-creation picker
  // (Schedule.jsx) draws from — primary or additionally-linked, regardless
  // of the caller's own scope. Refetched whenever the modal's Organization
  // changes so the Default contact list (and any already-selected value
  // that's no longer valid for a newly-picked org) stays in sync with it.
  useEffect(() => {
    if (!modalOpen || !form.organizationId) { setAssignablePeople([]); return; }
    api.get(`/people?assignableToOrganizationId=${form.organizationId}`).then((data) => setAssignablePeople(data.people));
  }, [modalOpen, form.organizationId]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, organizationId: user?.organizationId || '' });
    setModalOpen(true);
  }

  function openEdit(cal) {
    setEditing(cal);
    setForm({
      name: cal.name, organizationId: cal.organization_id, description: cal.description || '',
      coverageType: cal.coverage_type, defaultPersonId: cal.default_person_id || '',
    });
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      // '' means "no default contact" in the Select below, but the API's
      // create schema validates defaultPersonId as a UUID when present
      // (z.string().uuid().nullable().optional()) — an empty string fails
      // that, unlike PUT, which special-cases '' itself. Normalize to null
      // here so create and edit behave the same from this one form.
      const payload = { ...form, defaultPersonId: form.defaultPersonId || null };
      if (editing) {
        await api.put(`/calendars/${editing.id}`, payload);
      } else {
        await api.post('/calendars', payload);
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
        {canEdit && (
          <div className="w-64">
            <OrganizationSelector value={viewOrgId} onChange={setViewOrgId} allowClear clearLabel="All Customers" placeholder="All Customers" />
          </div>
        )}
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
          <Field label="Default contact" hint="Standing fallback for the NCC on-call lookup when no shift at all covers the requested moment — distinct from an individual shift's own Default tier. Optional.">
            <Select value={form.defaultPersonId} onChange={(e) => setForm({ ...form, defaultPersonId: e.target.value })} disabled={!form.organizationId}>
              <option value="">— None —</option>
              {assignablePeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Delete calendar?" message={`This permanently deletes "${deleteTarget?.name}" and all of its shifts.`}
        confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={saving} />
    </div>
  );
}
