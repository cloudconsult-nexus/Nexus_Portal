import { useEffect, useState } from 'react';
import { Plus, Trash2, RotateCcw, Building2, Search, Pencil, ChevronRight, ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { isGlobalAdmin, isAdmin } from '../lib/roles.js';
import { sortByName, findOrg, buildTree, filterTree, flattenTree, getDescendantIds } from '../lib/orgHierarchy.js';
import {
  PageHeader, Card, Button, Input, Field, Select, Textarea, Checkbox, Modal, ConfirmDialog,
  LoadingBlock, EmptyState, ErrorBanner, Badge,
} from '../components/ui.jsx';
import LogoUpload from '../components/LogoUpload.jsx';
import OrganizationSelector from '../components/OrganizationSelector.jsx';

const DETAIL_FIELDS = ['name', 'account_number', 'phone', 'email', 'address', 'website', 'primary_contact', 'call_messages_url'];
const BRANDING_FIELDS = ['name_override', 'tagline', 'primary_color', 'accent_color', 'description', 'message_html'];

// Read-only display for a saved record — the modal defaults to this and
// only switches to editable fields while editMode is on.
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
      <div className="h-14 w-14 rounded-lg border border-line bg-surface flex items-center justify-center overflow-hidden">
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">Not set</span>}
      </div>
    </div>
  );
}

// Customers are flat — no more hierarchy tree/Move/per-level "Add child"
// (see migrations/013_tas_customer_model.sql). Customer records themselves
// are Global-Admin-only to edit; a Customer Admin/User can still view their
// own single Customer's details read-only (GET /organizations already
// scopes non-Global-Admins to just their own row) — the row-card list below
// preserves that: clicking a row opens the modal read-only for everyone,
// Edit/Delete are only shown to canManage.
export default function Customers() {
  const { user } = useAuth();
  const canManage = isGlobalAdmin(user);
  const canFilterByLevel = isAdmin(user);

  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewOrgId, setViewOrgId] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [editMode, setEditMode] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState(new Set());

  async function loadList() {
    setLoading(true);
    try {
      const data = await api.get(viewOrgId ? `/organizations?organizationId=${viewOrgId}` : '/organizations');
      setOrgs(data.organizations);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadList(); }, [viewOrgId]);

  const tree = filterTree(buildTree(orgs), search);
  const parentIds = new Set(orgs.filter((o) => o.parent_id).map((o) => o.parent_id));

  function toggleCollapsed(id) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // The list row already has every field (GET /organizations is SELECT *),
  // so opening the modal is just populating state from it — no per-row
  // detail fetch needed.
  function openDetail(org, startEditing = false) {
    setSelectedId(org.id);
    setDetail(org);
    setForm(org);
    setEditMode(startEditing);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setForm(null);
    setEditMode(false);
  }

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
      payload.parentId = form.parent_id || null;
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
      setOrgs((prev) => sortByName([...prev, organization]));
      openDetail(organization, true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await api.del(`/organizations/${deleteTarget.id}`);
      setDeleteOpen(false);
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) closeDetail();
      await loadList();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(org) {
    setSaving(true);
    try {
      await api.post(`/organizations/${org.id}/restore`);
      const restored = { ...org, is_deleted: false, deleted_at: null, deleted_by: null };
      setOrgs((prev) => prev.map((o) => (o.id === org.id ? restored : o)));
      if (selectedId === org.id) { setDetail(restored); setForm(restored); }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Each Customer's own People, Calendars, and Schedule."
        actions={canManage && (
          <Button onClick={() => { setNewName(''); setCreateOpen(true); }}>
            <Plus size={14} /> New customer
          </Button>
        )}
      />
      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…" className="pl-8" />
          </div>
          {canFilterByLevel && (
            <div className="w-64">
              <OrganizationSelector value={viewOrgId} onChange={setViewOrgId} allowClear clearLabel="All Customers" placeholder="All Customers" />
            </div>
          )}
          {parentIds.size > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCollapsedIds(collapsedIds.size ? new Set() : new Set(parentIds))}
            >
              {collapsedIds.size ? 'Expand all' : 'Collapse all'}
            </Button>
          )}
        </div>

        {loading ? <LoadingBlock /> : orgs.length === 0 ? (
          <EmptyState title="No customers yet" description={canManage ? 'Create your first Customer to get started.' : undefined} />
        ) : tree.length === 0 ? (
          <EmptyState title="No customers match your search" />
        ) : (
          <div className="space-y-3">
            {flattenTree(tree, collapsedIds).map(({ org, depth, hasChildren }) => (
              <Card
                key={org.id}
                className={`p-4 flex items-center gap-4 cursor-pointer hover:border-signal-amber/40 transition-colors ${org.is_deleted ? 'opacity-60' : ''}`}
                style={{ marginLeft: depth * 28 }}
                onClick={() => openDetail(org)}
              >
                {hasChildren ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleCollapsed(org.id); }}
                    className="text-muted hover:text-ink shrink-0"
                  >
                    {collapsedIds.has(org.id) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <div className="h-10 w-10 rounded-lg bg-surface border border-line flex items-center justify-center shrink-0 overflow-hidden">
                  {org.logo_url ? (
                    <img src={org.logo_url} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <Building2 size={18} className="text-ink" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink truncate">{org.name}</span>
                    {org.account_number && (
                      <span className="text-xs text-muted font-mono bg-surface border border-line rounded px-1.5 py-0.5 shrink-0">{org.account_number}</span>
                    )}
                    {org.is_deleted && <Badge tone="red">Deleted</Badge>}
                  </div>
                  {(org.phone || org.email) && (
                    <p className="text-xs text-muted truncate mt-0.5">{[org.phone, org.email].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {org.is_deleted ? (
                      <Button size="sm" variant="secondary" onClick={() => handleRestore(org)} loading={saving}><RotateCcw size={13} /></Button>
                    ) : (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => openDetail(org, true)}><Pencil size={13} /></Button>
                        <Button size="sm" variant="danger" onClick={() => { setDeleteTarget(org); setDeleteOpen(true); }}><Trash2 size={13} /></Button>
                      </>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!detail}
        onClose={closeDetail}
        title={detail?.name || ''}
        size="lg"
        footer={
          editMode ? (
            <>
              <Button variant="secondary" onClick={handleCancelEdit} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save changes</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={closeDetail}>Close</Button>
              {canManage && !detail?.is_deleted && (
                <Button onClick={() => setEditMode(true)}><Pencil size={14} /> Edit</Button>
              )}
            </>
          )
        }
      >
        {detail && form && (
          <div className="space-y-6">
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
                  <Field label="Parent customer" hint="Optional — nests this Customer under another for display grouping.">
                    <Select value={form.parent_id || ''} onChange={(e) => setForm({ ...form, parent_id: e.target.value || null })}>
                      <option value="">None (top-level)</option>
                      {sortByName(orgs.filter((o) => o.id !== selectedId && !o.is_deleted && !getDescendantIds(orgs, selectedId).has(o.id)))
                        .map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </Select>
                  </Field>
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
                  <ReadOnlyField label="Parent customer" value={detail.parent_id ? findOrg(orgs, detail.parent_id)?.name : null} />
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
          </div>
        )}
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New customer"
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} loading={saving} disabled={!newName.trim()}>Create</Button></>}>
        <Field label="Name"><Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus /></Field>
      </Modal>

      <ConfirmDialog open={deleteOpen} title="Delete customer?" message={`This soft-deletes "${deleteTarget?.name}" and its People/Calendars/Schedule. It can be restored later.`}
        confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteOpen(false)} loading={saving} />
    </div>
  );
}
