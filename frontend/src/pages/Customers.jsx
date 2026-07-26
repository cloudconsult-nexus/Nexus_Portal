import { useEffect, useState } from 'react';
import { Plus, Trash2, RotateCcw, Building2, Search, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isGlobalAdmin } from '../lib/roles.js';
import { filterBySearch, sortByName } from '../lib/orgHierarchy.js';
import {
  PageHeader, Card, Button, Input, Field, Textarea, Checkbox, Modal, ConfirmDialog,
  LoadingBlock, EmptyState, ErrorBanner, Badge,
} from '../components/ui.jsx';
import LogoUpload from '../components/LogoUpload.jsx';

const DETAIL_FIELDS = ['name', 'account_number', 'phone', 'email', 'address', 'website', 'primary_contact', 'call_messages_url'];
const BRANDING_FIELDS = ['name_override', 'tagline', 'primary_color', 'accent_color', 'description', 'message_html'];

// Read-only display for a saved record — the detail panel defaults to this
// and only switches to editable fields while editMode is on.
function ReadOnlyField({ label, value, swatch }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink mb-1">{label}</p>
      <p className="text-sm text-ink flex items-center gap-2">
        {swatch && value && <span className="inline-block h-4 w-4 rounded border border-line shrink-0" style={{ backgroundColor: value }} />}
        {value || <span className="text-muted">—</span>}
      </p>
    </div>
  );
}

function ReadOnlyImage({ label, url }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink mb-1">{label}</p>
      <div className="h-14 w-28 rounded-lg border border-line bg-surface flex items-center justify-center overflow-hidden">
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">Not set</span>}
      </div>
    </div>
  );
}

// Customers are flat — no more hierarchy tree/Move/per-level "Add child"
// (see migrations/013_tas_customer_model.sql). Customer records themselves
// are Global-Admin-only; a Customer Admin manages their own Customer's
// People/Calendars/Schedule, not the Customer record.
export default function Customers() {
  const { user } = useAuth();
  const canManage = isGlobalAdmin(user);

  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function loadList() {
    setLoading(true);
    try {
      const data = await api.get('/organizations');
      setOrgs(data.organizations);
      if (!selectedId && data.organizations[0]) setSelectedId(data.organizations[0].id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadList(); }, []);

  useEffect(() => {
    if (!selectedId) return;
    setEditMode(false);
    api.get(`/organizations/${selectedId}`).then((data) => {
      setDetail(data.organization);
      setForm(data.organization);
    }).catch((err) => setError(err.message));
  }, [selectedId]);

  const filtered = sortByName(filterBySearch(orgs, search));

  function handleCancelEdit() {
    setForm(detail);
    setEditMode(false);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = {};
      [...DETAIL_FIELDS, ...BRANDING_FIELDS, 'contact_edit_requires_approval'].forEach((f) => {
        const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        payload[camel] = form[f] ?? (f === 'contact_edit_requires_approval' ? false : '');
      });
      const { organization } = await api.put(`/organizations/${selectedId}`, payload);
      setDetail(organization);
      setForm(organization);
      setEditMode(false);
      setOrgs((prev) => prev.map((o) => (o.id === organization.id ? organization : o)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    setSaving(true);
    setError('');
    try {
      const { organization } = await api.post('/organizations', { name: newName });
      setNewName('');
      setCreateOpen(false);
      await loadList();
      setSelectedId(organization.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await api.del(`/organizations/${selectedId}`);
      setDeleteOpen(false);
      setSelectedId(null);
      await loadList();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore() {
    setSaving(true);
    try {
      await api.post(`/organizations/${selectedId}/restore`);
      await loadList();
      const data = await api.get(`/organizations/${selectedId}`);
      setDetail(data.organization);
      setForm(data.organization);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Customers" description="Each Customer's own People, Calendars, and Schedule." />
      <div className="flex" style={{ height: 'calc(100vh - 73px)' }}>
        <div className="w-80 shrink-0 border-r border-line flex flex-col">
          <div className="p-3 border-b border-line space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8" />
            </div>
            {canManage && (
              <Button size="sm" className="w-full" onClick={() => { setNewName(''); setCreateOpen(true); }}>
                <Plus size={13} /> New customer
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? <LoadingBlock /> : filtered.length === 0 ? (
              <EmptyState title="No customers yet" description={canManage ? 'Create your first Customer to get started.' : undefined} />
            ) : (
              filtered.map((org) => (
                <button
                  key={org.id}
                  onClick={() => setSelectedId(org.id)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-left hover:bg-surface ${
                    selectedId === org.id ? 'bg-signal-amber/10 text-ink font-medium' : 'text-ink'
                  } ${org.is_deleted ? 'opacity-50' : ''}`}
                >
                  <Building2 size={13} className="text-muted shrink-0" />
                  <span className="truncate">{org.name}</span>
                  {org.is_deleted && <Badge tone="red" className="ml-auto shrink-0">Deleted</Badge>}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {error && <ErrorBanner message={error} className="mb-4" />}
          {!detail || !form ? (
            <EmptyState title="Select a customer" />
          ) : (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">{detail.name}</h2>
                  {detail.is_deleted && <Badge tone="red">Deleted</Badge>}
                </div>
                {canManage && !editMode && (
                  <div className="flex items-center gap-2">
                    {detail.is_deleted ? (
                      <Button variant="secondary" onClick={handleRestore} loading={saving}><RotateCcw size={14} /> Restore</Button>
                    ) : (
                      <>
                        <Button variant="secondary" onClick={() => setEditMode(true)}><Pencil size={14} /> Edit</Button>
                        <Button variant="danger" onClick={() => setDeleteOpen(true)}><Trash2 size={14} /> Delete</Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <Card className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-ink">Details</h3>
                {editMode ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                      <Field label="Account number"><Input value={form.account_number || ''} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></Field>
                      <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                      <Field label="Email"><Input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                      <Field label="Website"><Input value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
                      <Field label="Primary contact"><Input value={form.primary_contact || ''} onChange={(e) => setForm({ ...form, primary_contact: e.target.value })} /></Field>
                    </div>
                    <Field label="Address"><Input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
                    <Field label="Call messages URL"><Input value={form.call_messages_url || ''} onChange={(e) => setForm({ ...form, call_messages_url: e.target.value })} /></Field>
                    <Checkbox
                      label="Contact edits require Global Admin approval"
                      checked={!!form.contact_edit_requires_approval}
                      onChange={(e) => setForm({ ...form, contact_edit_requires_approval: e.target.checked })}
                    />
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <ReadOnlyField label="Name" value={detail.name} />
                      <ReadOnlyField label="Account number" value={detail.account_number} />
                      <ReadOnlyField label="Phone" value={detail.phone} />
                      <ReadOnlyField label="Email" value={detail.email} />
                      <ReadOnlyField label="Website" value={detail.website} />
                      <ReadOnlyField label="Primary contact" value={detail.primary_contact} />
                    </div>
                    <ReadOnlyField label="Address" value={detail.address} />
                    <ReadOnlyField label="Call messages URL" value={detail.call_messages_url} />
                    <ReadOnlyField label="Contact edits require approval" value={detail.contact_edit_requires_approval ? 'Yes' : 'No'} />
                  </>
                )}
              </Card>

              <Card className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-ink">Branding <span className="text-xs font-normal text-muted">(falls back to TAS-wide settings for anything not set here)</span></h3>
                {editMode ? (
                  <>
                    <Field label="Logo">
                      <LogoUpload organizationId={selectedId} imageUrl={form.logo_url} kind="logo"
                        onUploaded={(url) => setForm({ ...form, logo_url: url })} />
                    </Field>
                    <Field label="Favicon">
                      <LogoUpload organizationId={selectedId} imageUrl={form.favicon_url} kind="favicon"
                        onUploaded={(url) => setForm({ ...form, favicon_url: url })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Display name override"><Input value={form.name_override || ''} onChange={(e) => setForm({ ...form, name_override: e.target.value })} /></Field>
                      <Field label="Tagline"><Input value={form.tagline || ''} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></Field>
                      <Field label="Primary color"><Input type="color" value={form.primary_color || '#1B2333'} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} /></Field>
                      <Field label="Accent color"><Input type="color" value={form.accent_color || '#F5A623'} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} /></Field>
                    </div>
                    <Field label="Description"><Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                    <Field label="Message HTML" hint="Shown on public-facing branded pages"><Textarea rows={3} value={form.message_html || ''} onChange={(e) => setForm({ ...form, message_html: e.target.value })} /></Field>
                  </>
                ) : (
                  <>
                    <div className="flex gap-6">
                      <ReadOnlyImage label="Logo" url={detail.logo_url} />
                      <ReadOnlyImage label="Favicon" url={detail.favicon_url} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <ReadOnlyField label="Display name override" value={detail.name_override} />
                      <ReadOnlyField label="Tagline" value={detail.tagline} />
                      <ReadOnlyField label="Primary color" value={detail.primary_color} swatch />
                      <ReadOnlyField label="Accent color" value={detail.accent_color} swatch />
                    </div>
                    <ReadOnlyField label="Description" value={detail.description} />
                    {detail.message_html && (
                      <div>
                        <p className="text-xs font-medium text-ink mb-1">Message HTML</p>
                        <div className="text-sm text-ink border border-line rounded-lg p-3" dangerouslySetInnerHTML={{ __html: detail.message_html }} />
                      </div>
                    )}
                  </>
                )}
              </Card>

              {editMode && (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={handleCancelEdit} disabled={saving}>Cancel</Button>
                  <Button onClick={handleSave} loading={saving}>Save changes</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New customer"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} loading={saving} disabled={!newName.trim()}>Create</Button></>}>
        <Field label="Name"><Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus /></Field>
      </Modal>

      <ConfirmDialog open={deleteOpen} title="Delete customer?" message={`This soft-deletes "${detail?.name}" and its People/Calendars/Schedule. It can be restored later.`}
        confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteOpen(false)} loading={saving} />
    </div>
  );
}
