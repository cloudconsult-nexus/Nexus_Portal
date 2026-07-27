import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdmin, ROLE_LABELS, ROLE_BADGE_TONE } from '../lib/roles.js';
import { PageHeader, Card, Button, Input, Field, Select, Checkbox, Modal, ConfirmDialog, LoadingBlock, EmptyState, ErrorBanner, Badge } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';
import PhotoUpload from '../components/PhotoUpload.jsx';

const ROLES = ['global_admin', 'customer_admin', 'user'];

const EMPTY_FORM = {
  name: '', organizationId: '', email: '', primaryPhone: '', smsPhone: '', secondaryPhone: '',
  department: '', jobTitle: '', role: 'user', canEditSchedule: false, sendInvite: true,
};

export default function People() {
  const { user } = useAuth();
  const canEdit = isAdmin(user);

  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/people');
      setPeople(data.people);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = people.filter((p) => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.email?.toLowerCase().includes(search.toLowerCase());
    const matchesRole = !roleFilter || p.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  async function openEdit(person) {
    const { person: full } = await api.get(`/people/${person.id}`);
    setEditing(full);
    setForm({
      name: full.name || '', organizationId: full.organization_id || '', email: full.email || '',
      primaryPhone: full.primary_phone || '', smsPhone: full.sms_phone || '', secondaryPhone: full.secondary_phone || '',
      department: full.department || '', jobTitle: full.job_title || '', role: full.role,
      canEditSchedule: full.can_edit_schedule || false, sendInvite: false,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.put(`/people/${editing.id}`, form);
      } else {
        await api.post('/people', form);
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
      await api.del(`/people/${deleteTarget.id}`);
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
      <PageHeader
        title="People"
        description="On-call contacts and platform accounts."
        actions={canEdit && <Button onClick={openCreate}><Plus size={14} /> Add person</Button>}
      />
      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="flex items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people…" className="pl-8" />
          </div>
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="max-w-[10rem]">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </div>

        {loading ? <LoadingBlock /> : filtered.length === 0 ? <EmptyState title="No people found" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <Card
                key={p.id}
                className="p-4 space-y-3 cursor-pointer hover:border-signal-amber/40 transition-colors"
                onClick={() => canEdit && openEdit(p)}
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full overflow-hidden bg-surface border border-line flex items-center justify-center shrink-0">
                    {p.photo_url ? <img src={p.photo_url} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted">{p.name?.[0]}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink truncate">{p.name}</p>
                    <p className="text-xs text-muted truncate">{p.email || '—'}</p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-ink"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteTarget(p)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-signal-red"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={ROLE_BADGE_TONE[p.role]}>{ROLE_LABELS[p.role]}</Badge>
                  {p.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                </div>

                {(p.job_title || p.department) && (
                  <p className="text-xs text-muted truncate">{[p.job_title, p.department].filter(Boolean).join(' · ')}</p>
                )}

                <div className="pt-2 border-t border-line text-xs text-muted">
                  {p.last_active_at ? `Last active ${new Date(p.last_active_at).toLocaleString()}` : 'Never logged in'}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit person' : 'Add person'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} loading={saving} disabled={!form.name || !form.organizationId}>{editing ? 'Save' : 'Create'}</Button></>}>
        <div className="space-y-4">
          {editing && (
            <Field label="Photo">
              <PhotoUpload personId={editing.id} photoUrl={editing.photo_url} onUploaded={(url) => setEditing({ ...editing, photo_url: url })} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <Field label="Organization">
              <OrganizationSelector value={form.organizationId} onChange={(id) => setForm({ ...form, organizationId: id })} />
            </Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            </Field>
            <Field label="Primary phone"><Input value={form.primaryPhone} onChange={(e) => setForm({ ...form, primaryPhone: e.target.value })} /></Field>
            <Field label="SMS phone"><Input value={form.smsPhone} onChange={(e) => setForm({ ...form, smsPhone: e.target.value })} /></Field>
            <Field label="Secondary phone"><Input value={form.secondaryPhone} onChange={(e) => setForm({ ...form, secondaryPhone: e.target.value })} /></Field>
            <Field label="Department"><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field>
            <Field label="Job title"><Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></Field>
          </div>
          {form.role === 'user' && (
            <Checkbox label="Can edit the schedule" checked={form.canEditSchedule} onChange={(e) => setForm({ ...form, canEditSchedule: e.target.checked })} />
          )}
          {!editing && form.email && (
            <Checkbox label="Send an invitation email" checked={form.sendInvite} onChange={(e) => setForm({ ...form, sendInvite: e.target.checked })} />
          )}
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Remove person?" message={`This soft-deletes "${deleteTarget?.name}". They can be restored from the database if needed.`}
        confirmLabel="Remove" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={saving} />
    </div>
  );
}
