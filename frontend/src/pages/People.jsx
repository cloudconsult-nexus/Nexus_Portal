import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isAdmin, isGlobalAdmin, ROLE_LABELS, ROLE_BADGE_TONE } from '../lib/roles.js';
import { PageHeader, Card, Button, Input, Field, Select, Checkbox, Modal, ConfirmDialog, LoadingBlock, EmptyState, ErrorBanner, Badge } from '../components/ui.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';
import PhotoUpload from '../components/PhotoUpload.jsx';

const ROLES = ['global_admin', 'customer_admin', 'user'];

const EMPTY_FORM = {
  name: '', organizationId: '', email: '', primaryPhone: '', smsPhone: '', secondaryPhone: '',
  department: '', jobTitle: '', role: 'user', canEditSchedule: false, sendInvite: true, password: '',
};

// Cheap random password for the "generate" convenience button — the admin
// copies it out of the field to hand to the person directly, it's never
// stored or displayed anywhere after submission.
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function People() {
  const { user } = useAuth();
  const canEdit = isAdmin(user);
  const isGA = isGlobalAdmin(user);

  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [viewOrgId, setViewOrgId] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Create-only: Global Admin can activate the account immediately with a
  // password instead of an email invite.
  const [activationMethod, setActivationMethod] = useState('invite');
  // Edit-only: Global Admin can (re)set an existing person's password —
  // a separate action/endpoint from the main Save, not part of `form`.
  const [resettingPassword, setResettingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordAction, setPasswordAction] = useState({ saving: false, message: '', error: '' });

  // Edit-only: additional (non-primary) organizations this person can also
  // be scheduled under — "full scheduling reach," restricted server-side to
  // the same nested hierarchy tree as their primary organization.
  const [orgLinks, setOrgLinks] = useState([]);
  const [orgCandidates, setOrgCandidates] = useState([]);
  const [addOrgId, setAddOrgId] = useState('');
  const [orgLinkAction, setOrgLinkAction] = useState({ saving: false, error: '' });

  async function load() {
    setLoading(true);
    try {
      const data = await api.get(viewOrgId ? `/people?organizationId=${viewOrgId}` : '/people');
      setPeople(data.people);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [viewOrgId]);

  const filtered = people.filter((p) => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.email?.toLowerCase().includes(search.toLowerCase());
    const matchesRole = !roleFilter || p.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setActivationMethod('invite');
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
    setResettingPassword(false);
    setNewPassword('');
    setPasswordAction({ saving: false, message: '', error: '' });
    setAddOrgId('');
    setOrgLinkAction({ saving: false, error: '' });
    setOrgLinks([]);
    setOrgCandidates([]);
    if (canEdit) {
      const [linksData, candidatesData] = await Promise.all([
        api.get(`/people/${full.id}/organizations`),
        api.get(`/people/${full.id}/organizations/candidates`),
      ]);
      setOrgLinks(linksData.organizations);
      setOrgCandidates(candidatesData.organizations);
    }
    setModalOpen(true);
  }

  async function handleAddOrgLink() {
    if (!addOrgId) return;
    setOrgLinkAction({ saving: true, error: '' });
    try {
      const { organization } = await api.post(`/people/${editing.id}/organizations`, { targetOrganizationId: addOrgId });
      setOrgLinks((prev) => [...prev, organization].sort((a, b) => a.name.localeCompare(b.name)));
      setOrgCandidates((prev) => prev.filter((o) => o.id !== addOrgId));
      setAddOrgId('');
      setOrgLinkAction({ saving: false, error: '' });
      await load();
    } catch (err) {
      setOrgLinkAction({ saving: false, error: err.message });
    }
  }

  async function handleRemoveOrgLink(organizationId) {
    setOrgLinkAction({ saving: true, error: '' });
    try {
      await api.del(`/people/${editing.id}/organizations/${organizationId}`);
      const removed = orgLinks.find((l) => l.organization_id === organizationId);
      setOrgLinks((prev) => prev.filter((l) => l.organization_id !== organizationId));
      if (removed) {
        setOrgCandidates((prev) => [...prev, { id: removed.organization_id, name: removed.name, account_number: removed.account_number }]
          .sort((a, b) => a.name.localeCompare(b.name)));
      }
      setOrgLinkAction({ saving: false, error: '' });
      await load();
    } catch (err) {
      setOrgLinkAction({ saving: false, error: err.message });
    }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (editing) {
        await api.put(`/people/${editing.id}`, payload);
      } else {
        const { emailDelivered } = await api.post('/people', payload);
        if (emailDelivered === false) {
          setNotice(`${form.name} was created, but the invitation email failed to send. Resend it from the Invitations page once email delivery is fixed.`);
        }
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPassword() {
    setPasswordAction({ saving: true, message: '', error: '' });
    try {
      await api.post(`/people/${editing.id}/set-password`, { password: newPassword });
      setPasswordAction({ saving: false, message: 'Password updated — share it with the person directly.', error: '' });
      setNewPassword('');
      setResettingPassword(false);
      await load();
    } catch (err) {
      setPasswordAction({ saving: false, message: '', error: err.message });
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
        {notice && <ErrorBanner message={notice} tone="amber" />}
        <div className="flex items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people…" className="pl-8" />
          </div>
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="max-w-[10rem]">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
          {canEdit && (
            <div className="w-64">
              <OrganizationSelector value={viewOrgId} onChange={setViewOrgId} allowClear clearLabel="All Customers" placeholder="All Customers" />
            </div>
          )}
        </div>

        {loading ? <LoadingBlock /> : filtered.length === 0 ? <EmptyState title="No people found" /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
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
                  {p.additional_org_count > 0 && (
                    <Badge tone="blue">+{p.additional_org_count} org{p.additional_org_count > 1 ? 's' : ''}</Badge>
                  )}
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
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}
          disabled={!form.name || !form.organizationId || (!editing && isGA && activationMethod === 'password' && form.password.length < 8)}>
          {editing ? 'Save' : 'Create'}
        </Button></>}>
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

          {editing && canEdit && (
            <div className="rounded-lg border border-line p-3 space-y-2">
              <span className="text-xs font-medium text-ink">Additional organizations</span>
              <p className="text-xs text-muted -mt-1">
                Also schedulable on calendars in these organizations, alongside their primary one. Limited to the same nested Customer hierarchy.
              </p>
              {orgLinks.length === 0 ? (
                <p className="text-xs text-muted">None yet.</p>
              ) : (
                <ul className="space-y-1">
                  {orgLinks.map((link) => (
                    <li key={link.organization_id} className="flex items-center justify-between text-sm text-ink">
                      <span>{link.name}{link.account_number ? ` (${link.account_number})` : ''}</span>
                      <button type="button" onClick={() => handleRemoveOrgLink(link.organization_id)} className="p-1 rounded hover:bg-surface text-muted hover:text-signal-red">
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {orgCandidates.length > 0 && (
                <div className="flex items-end gap-2">
                  <Field label="Add organization">
                    <Select value={addOrgId} onChange={(e) => setAddOrgId(e.target.value)}>
                      <option value="">Select…</option>
                      {orgCandidates.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </Select>
                  </Field>
                  <Button type="button" size="sm" onClick={handleAddOrgLink} loading={orgLinkAction.saving} disabled={!addOrgId}>Add</Button>
                </div>
              )}
              {orgLinkAction.error && <p className="text-xs text-signal-red">{orgLinkAction.error}</p>}
            </div>
          )}

          {!editing && form.email && (
            isGA ? (
              <div className="space-y-2">
                <span className="block text-xs font-medium text-ink">Account activation</span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
                    <input type="radio" checked={activationMethod === 'invite'}
                      onChange={() => { setActivationMethod('invite'); setForm({ ...form, sendInvite: true, password: '' }); }} />
                    Send an invitation email
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
                    <input type="radio" checked={activationMethod === 'password'}
                      onChange={() => setActivationMethod('password')} />
                    Set a password now
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
                    <input type="radio" checked={activationMethod === 'none'}
                      onChange={() => { setActivationMethod('none'); setForm({ ...form, sendInvite: false, password: '' }); }} />
                    Not yet
                  </label>
                </div>
                {activationMethod === 'password' && (
                  <div className="flex items-end gap-2">
                    <Field label="Password" hint="At least 8 characters — share it with the person directly, it's never shown again.">
                      <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Enter or generate a password" />
                    </Field>
                    <Button type="button" variant="secondary" onClick={() => setForm({ ...form, password: generatePassword() })}>Generate</Button>
                  </div>
                )}
              </div>
            ) : (
              <Checkbox label="Send an invitation email" checked={form.sendInvite} onChange={(e) => setForm({ ...form, sendInvite: e.target.checked })} />
            )
          )}

          {editing && isGA && (
            <div className="rounded-lg border border-line p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink">Password</span>
                {!resettingPassword && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setResettingPassword(true)}>Set new password</Button>
                )}
              </div>
              {resettingPassword && (
                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <Field label="New password" hint="At least 8 characters.">
                      <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter or generate a password" />
                    </Field>
                    <Button type="button" variant="secondary" onClick={() => setNewPassword(generatePassword())}>Generate</Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" onClick={handleSetPassword} loading={passwordAction.saving} disabled={newPassword.length < 8}>Set password</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setResettingPassword(false); setNewPassword(''); }}>Cancel</Button>
                  </div>
                </div>
              )}
              {passwordAction.message && <p className="text-xs text-signal-green">{passwordAction.message}</p>}
              {passwordAction.error && <p className="text-xs text-signal-red">{passwordAction.error}</p>}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Remove person?" message={`This soft-deletes "${deleteTarget?.name}". They can be restored from the database if needed.`}
        confirmLabel="Remove" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={saving} />
    </div>
  );
}
